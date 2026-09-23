// src/lib/services/decentralizationService.js
//
// Decentralization metric (issue #108): what share of node-hosting IPs are in known
// datacenters/cloud providers vs. not. Classified gradually via the free ipwho.is/ip-api.com
// chain (the same one hostLocationService.js already uses for the server's own location) --
// no key, no bulk-download database to maintain, no paid API. A batch of unclassified/stale
// IPs is looked up every DECENTRALIZATION_CONFIG.updateInterval; a classification is cached
// in the DB and reused for DECENTRALIZATION_CONFIG.staleAfterMs before being re-checked,
// since an IP's ASN/org rarely changes.
//
// The candidate node-IP set is read from busiestNodeService's cache rather than fetched
// independently, so this feature adds zero extra calls to stats.runonflux.io.

import { resilientFetch } from './resilientFetch.js';
import { getBusiestNode, getCachedNetworkNodeIps } from './busiestNodeService.js';
import { getAllNodeIpClassifications, upsertNodeIpClassifications } from '../db/database.js';
import { DECENTRALIZATION_CONFIG, DATACENTER_ORG_KEYWORDS } from '../config.js';
import { BREAKDOWN_DIMENSIONS } from '../decentralizationDimensions.js';
import { createLogger } from '../logger.js';

const log = createLogger('decentralizationService');

const LOOKUP_TIMEOUT_MS = 8000;

let statsCache = null;
let statsCacheAt = 0;

/** "1.2.3.4:16127" -> "1.2.3.4" -- the fluxinfo IP field carries the app port. */
function normalizeIp(rawIp) {
    if (typeof rawIp !== 'string' || rawIp.length === 0) return null;
    return rawIp.split(':')[0] || null;
}

/** "AS15169 Google LLC" -> 15169 */
function parseAsn(asField) {
    if (typeof asField !== 'string') return null;
    const match = asField.match(/^AS(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

/** Case-insensitive substring match against the maintained provider keyword list. */
export function isKnownDatacenterOrg(orgOrIsp) {
    if (!orgOrIsp || typeof orgOrIsp !== 'string') return false;
    const lower = orgOrIsp.toLowerCase();
    return DATACENTER_ORG_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * The stored classifications with `isDatacenter` re-derived from the CURRENT keyword list
 * (issue #314). The stored flag was decided once, when the IP was classified, so editing
 * DATACENTER_ORG_KEYWORDS changed nothing already in the table until someone remembered
 * POST /api/admin/reclassify-datacenters -- DataVex's 105 nodes read as independent for
 * exactly that reason (#196). `org` is stored, so deriving costs nothing. This matches how
 * repo categories are re-validated against config at read time.
 */
export async function loadCurrentClassifications() {
    const stored = await getAllNodeIpClassifications();
    return stored.map(row => ({ ...row, isDatacenter: isKnownDatacenterOrg(row.org) }));
}

async function classifyViaIpwhois(ip) {
    const data = await resilientFetch(`https://ipwho.is/${ip}`, {
        timeout: LOOKUP_TIMEOUT_MS,
        breakerKey: 'decentralization-ipwhois'
    });
    if (!data?.success) throw new Error(data?.message || 'ipwho.is returned success=false');
    const conn = data.connection || {};
    return {
        asn: Number.isFinite(conn.asn) ? conn.asn : null,
        org: conn.org || conn.isp || null,
        // Issue #138: already present in ipwho.is's default (non-paid) response, unused
        // until now -- same fields hostLocationService.js already reads for the server's
        // own location lookup.
        country: data.country || null,
        countryCode: data.country_code || null,
        continent: data.continent || null,
        continentCode: data.continent_code || null
    };
}

async function classifyViaIpApi(ip) {
    const data = await resilientFetch(
        // Issue #138: country/continent added to the requested fields -- confirmed live
        // that ip-api.com's free tier returns them (e.g. {"continent":"Oceania",
        // "continentCode":"OC","country":"Australia","countryCode":"AU"}), no key needed.
        `http://ip-api.com/json/${ip}?fields=status,message,as,isp,org,country,countryCode,continent,continentCode,query`,
        { timeout: LOOKUP_TIMEOUT_MS, breakerKey: 'decentralization-ipapi' }
    );
    if (data?.status !== 'success') throw new Error(data?.message || 'ip-api.com lookup failed');
    return {
        asn: parseAsn(data.as),
        org: data.org || data.isp || null,
        country: data.country || null,
        countryCode: data.countryCode || null,
        continent: data.continent || null,
        continentCode: data.continentCode || null
    };
}

/**
 * Classify one IP's ASN/org/country/continent and whether it's a known datacenter/cloud
 * provider. Tries ipwho.is first, falls back to ip-api.com — same two-provider chain
 * hostLocationService.js uses, same reasoning: one provider's outage or rate-limit
 * shouldn't stall classification.
 */
export async function classifyIp(rawIp) {
    const ip = normalizeIp(rawIp);
    if (!ip) throw new Error(`Invalid IP: ${rawIp}`);

    const providers = [['ipwho.is', classifyViaIpwhois], ['ip-api.com', classifyViaIpApi]];
    const errors = [];

    for (const [name, fn] of providers) {
        try {
            const { asn, org, country, countryCode, continent, continentCode } = await fn(ip);
            return { asn, org, isDatacenter: isKnownDatacenterOrg(org), country, countryCode, continent, continentCode };
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
        }
    }

    throw new Error(errors.join('; '));
}

// Issue #120: raised from 3 to fill the card's stretched height now that the coverage-row
// (moved to the header's IPs counter) freed up vertical space -- see DecentralizationCard's
// .datacenters-section flex:1.
const TOP_DATACENTERS_LIMIT = 6;

/**
 * Groups the classified-as-datacenter rows by org, sorted by count. `percent` on each
 * entry is share of ALL classified nodes (not just the datacenter subset), so these
 * entries are directly comparable to and roughly sum toward the card's headline
 * datacenterPercent -- "Hetzner: 24%" reads against the same 100% as "62% datacenter".
 */
function computeTopDatacenters(relevant, limit = TOP_DATACENTERS_LIMIT) {
    const datacenterRows = relevant.filter(row => row.isDatacenter);
    const counts = new Map();
    for (const row of datacenterRows) {
        const key = row.org || 'Unknown';
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const classifiedCount = relevant.length;
    const top = sorted.slice(0, limit).map(([org, count]) => ({
        org,
        count,
        percent: classifiedCount > 0 ? (count / classifiedCount) * 100 : 0
    }));

    return { top, otherProviderCount: Math.max(0, sorted.length - top.length) };
}

/**
 * The candidate IPs and their classifications, fetched once (issue #151).
 *
 * Every breakdown needs the same two things, and each getFull*Breakdown() used to fetch them
 * for itself -- so one snapshot cycle paginated the whole node_ip_classification table up to
 * four times. Callers that need more than one breakdown load this once and pass it in; the
 * getters still load it themselves when called alone, so nothing else had to change.
 */
export async function loadClassificationContext() {
    // Warm the node list first (issue #249). getCachedNetworkNodeIps() returns [] until
    // busiestNodeService's first successful fetch and deliberately never triggers one, so
    // on a freshly restarted process this used to read an empty candidate set: nothing
    // "relevant", classifiedCount 0, and a daily snapshot whose decentralization columns
    // were all null. One null day disqualifies the KPI metric for every window containing
    // it, so a deploy shortly before the snapshot silently cost a whole day.
    //
    // Cheap: getBusiestNode() is TTL-cached, so this is a no-op whenever anything else has
    // fetched recently. Same call runDecentralizationCycle() already makes for the same
    // reason.
    try {
        await getBusiestNode();
    } catch (error) {
        log.warn('Could not warm the network node list: %s', error.message);
    }

    const candidateIps = getCachedNetworkNodeIps();
    const candidateSet = new Set(candidateIps);
    const allClassifications = await loadCurrentClassifications();

    if (candidateIps.length === 0) {
        // Loud on purpose. Everything downstream degrades to null rather than failing, so
        // without this the only trace is a null column noticed weeks later in a report.
        log.warn(
            { storedClassifications: allClassifications.length },
            'No candidate node IPs available -- every breakdown will be empty and the ' +
            'snapshot will record null decentralization columns for this run'
        );
    }

    return {
        candidateIps,
        allClassifications,
        relevant: allClassifications.filter(row => candidateSet.has(row.ip))
    };
}

/**
 * Group classified nodes by one named dimension (country, continent, ...).
 *
 * Pure, and the single implementation behind what used to be two identical functions
 * differing only in field name. A row with no value for the dimension groups under the
 * sentinel rather than being dropped, so the counts still sum to the classified total; its
 * code is deliberately null, since '(unknown)' has no ISO code.
 */
function computeNamedBreakdown(relevant, { nameField, codeField, sentinel }) {
    const counts = new Map();

    for (const row of relevant) {
        const value = row[nameField];
        const key = value || sentinel;
        const code = value ? (row[codeField] || null) : null;
        const existing = counts.get(key);
        if (existing) {
            existing.count++;
        } else {
            counts.set(key, { code, count: 1 });
        }
    }

    return [...counts.entries()].map(([name, { code, count }]) => ({
        [nameField]: name,
        [codeField]: code,
        count
    }));
}

/**
 * Every distinct datacenter org's count, uncapped (unlike topDatacenters, which caps at
 * 3 for the live card), plus the non-datacenter classified count under the reserved
 * '(independent)' sentinel org. Used only by the daily snapshot collector -- the live
 * card's getDecentralizationStats() is unaffected by this function.
 *
 * Not a plain group-by like the named dimensions above: rows split on isDatacenter first,
 * and the whole non-datacenter side collapses into one bucket.
 *
 * @param {object} [context] a context from loadClassificationContext(); loaded here if omitted
 */
export async function getFullDatacenterBreakdown(context) {
    const { relevant } = context ?? await loadClassificationContext();

    const counts = new Map();
    let independentCount = 0;

    for (const row of relevant) {
        if (row.isDatacenter) {
            const key = row.org || BREAKDOWN_DIMENSIONS.datacenter.sentinel;
            counts.set(key, (counts.get(key) || 0) + 1);
        } else {
            independentCount++;
        }
    }

    const breakdown = [...counts.entries()].map(([org, count]) => ({ org, count }));
    if (independentCount > 0) breakdown.push({ org: '(independent)', count: independentCount });
    return breakdown;
}

/**
 * Every distinct country's classified-node count, uncapped -- issue #138.
 * @param {object} [context] a context from loadClassificationContext(); loaded here if omitted
 */
export async function getFullCountryBreakdown(context) {
    const { relevant } = context ?? await loadClassificationContext();
    return computeNamedBreakdown(relevant, BREAKDOWN_DIMENSIONS.country);
}

/**
 * Every distinct continent's classified-node count, uncapped -- issue #138.
 * @param {object} [context] a context from loadClassificationContext(); loaded here if omitted
 */
export async function getFullContinentBreakdown(context) {
    const { relevant } = context ?? await loadClassificationContext();
    return computeNamedBreakdown(relevant, BREAKDOWN_DIMENSIONS.continent);
}


/** Recomputes and caches the stats snapshot from an in-memory classification list. */
function computeAndCacheStats(allClassifications, candidateIps) {
    const candidateSet = new Set(candidateIps);
    const relevant = allClassifications.filter(row => candidateSet.has(row.ip));
    const datacenterCount = relevant.filter(row => row.isDatacenter).length;
    const classifiedCount = relevant.length;
    const totalNodes = candidateIps.length;
    const { top: topDatacenters, otherProviderCount } = computeTopDatacenters(relevant);

    statsCache = {
        totalNodes,
        classifiedCount,
        datacenterCount,
        // Share of the CLASSIFIED subset that's a known datacenter -- null (not 0) with
        // nothing classified yet, so the UI can tell "0% datacenter" apart from "no data".
        datacenterPercent: classifiedCount > 0 ? (datacenterCount / classifiedCount) * 100 : null,
        // Share of all candidate nodes classified so far -- how much to trust datacenterPercent.
        coveragePercent: totalNodes > 0 ? (classifiedCount / totalNodes) * 100 : 0,
        topDatacenters,
        otherProviderCount,
        updatedAt: Date.now()
    };
    statsCacheAt = Date.now();
    return statsCache;
}

/**
 * One scheduler tick: classify up to DECENTRALIZATION_CONFIG.batchSize node IPs that are
 * new or stale, then refresh the cached stats snapshot. Never throws -- a classification
 * failure for one IP just leaves it to retry next cycle; the batch continues past it.
 */
export async function runDecentralizationCycle() {
    // Cheap no-op once busiestNodeService's own hourly cache is warm -- this is how the
    // node-IP list gets seeded/refreshed without a second network call of our own.
    try {
        await getBusiestNode();
    } catch (error) {
        log.warn('Could not warm the network node list this cycle: %s', error.message);
    }

    const candidateIps = getCachedNetworkNodeIps();
    if (candidateIps.length === 0) {
        log.info('No network node IPs cached yet — skipping this cycle');
        return;
    }

    const allClassifications = await loadCurrentClassifications();
    const known = new Map(allClassifications.map(row => [row.ip, row]));
    const staleBefore = Date.now() - DECENTRALIZATION_CONFIG.staleAfterMs;

    const toClassify = [];
    for (const ip of candidateIps) {
        const existing = known.get(ip);
        if (!existing || existing.classifiedAt < staleBefore) toClassify.push(ip);
        if (toClassify.length >= DECENTRALIZATION_CONFIG.batchSize) break;
    }

    const results = [];
    for (const ip of toClassify) {
        try {
            const { asn, org, isDatacenter, country, countryCode, continent, continentCode } = await classifyIp(ip);
            results.push({ ip, asn, org, isDatacenter, country, countryCode, continent, continentCode, classifiedAt: Date.now() });
        } catch (error) {
            log.warn('Classification failed for %s: %s', ip, error.message);
        }
    }

    if (results.length > 0) {
        await upsertNodeIpClassifications(results);
        for (const row of results) {
            known.set(row.ip, {
                ip: row.ip,
                org: row.org,
                isDatacenter: row.isDatacenter,
                country: row.country,
                countryCode: row.countryCode,
                continent: row.continent,
                continentCode: row.continentCode,
                classifiedAt: row.classifiedAt
            });
        }
    }

    computeAndCacheStats([...known.values()], candidateIps);
    log.info(
        { attempted: toClassify.length, classified: results.length, candidates: candidateIps.length },
        'Decentralization batch: %d/%d classified (%d candidate nodes)',
        results.length, toClassify.length, candidateIps.length
    );
}

/**
 * Re-applies the current DATACENTER_ORG_KEYWORDS to every already-classified row and writes
 * back only the ones whose flag changed (issue #196).
 *
 * `is_datacenter` is decided once, at classification time, and read back verbatim -- unlike
 * the repo-category system, which re-validates stored rows against current config on every
 * read. So editing the keyword list does nothing to what's already in the table: a row is
 * only re-derived when it goes stale at staleAfterMs (30 days), at batchSize per cycle across
 * the whole network. This makes a keyword edit take effect immediately instead.
 *
 * Costs nothing externally -- `org` is already stored, so no IP is looked up again. The rows
 * come from getAllNodeIpClassifications(), which carries asn for exactly this reason: they go
 * straight back through upsertNodeIpClassifications(), which writes every column.
 * classifiedAt is deliberately left alone so this doesn't reset the staleness clock.
 */
export async function reclassifyStoredDatacenterFlags() {
    const stored = await getAllNodeIpClassifications();

    const changed = stored
        .map(row => ({ row, isDatacenter: isKnownDatacenterOrg(row.org) }))
        .filter(({ row, isDatacenter }) => isDatacenter !== row.isDatacenter)
        .map(({ row, isDatacenter }) => ({ ...row, isDatacenter }));

    if (changed.length > 0) {
        await upsertNodeIpClassifications(changed);
        // Drop the memoised snapshot so the card reflects the correction on the next read
        // rather than at the next scheduler tick (or restart).
        clearDecentralizationStatsCache();
    }

    log.info(
        { checked: stored.length, changed: changed.length },
        'Reclassified stored datacenter flags: %d of %d row(s) changed',
        changed.length, stored.length
    );

    return { checked: stored.length, changed: changed.length };
}

/**
 * The current decentralization stats, computed on demand if the scheduler hasn't run yet
 * (cold start) rather than returning nothing.
 */
export async function getDecentralizationStats(context) {
    if (statsCache) return statsCache;

    const { allClassifications, candidateIps } = context ?? await loadClassificationContext();
    return computeAndCacheStats(allClassifications, candidateIps);
}

/** Invalidates the memoised snapshot. Used by reclassifyStoredDatacenterFlags() and by tests. */
export function clearDecentralizationStatsCache() {
    statsCache = null;
    statsCacheAt = 0;
}

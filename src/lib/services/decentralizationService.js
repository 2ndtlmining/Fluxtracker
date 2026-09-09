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

async function classifyViaIpwhois(ip) {
    const data = await resilientFetch(`https://ipwho.is/${ip}`, {
        timeout: LOOKUP_TIMEOUT_MS,
        breakerKey: 'decentralization-ipwhois'
    });
    if (!data?.success) throw new Error(data?.message || 'ipwho.is returned success=false');
    const conn = data.connection || {};
    return { asn: Number.isFinite(conn.asn) ? conn.asn : null, org: conn.org || conn.isp || null };
}

async function classifyViaIpApi(ip) {
    const data = await resilientFetch(
        `http://ip-api.com/json/${ip}?fields=status,message,as,isp,org,query`,
        { timeout: LOOKUP_TIMEOUT_MS, breakerKey: 'decentralization-ipapi' }
    );
    if (data?.status !== 'success') throw new Error(data?.message || 'ip-api.com lookup failed');
    return { asn: parseAsn(data.as), org: data.org || data.isp || null };
}

/**
 * Classify one IP's ASN/org and whether it's a known datacenter/cloud provider. Tries
 * ipwho.is first, falls back to ip-api.com — same two-provider chain hostLocationService.js
 * uses, same reasoning: one provider's outage or rate-limit shouldn't stall classification.
 */
export async function classifyIp(rawIp) {
    const ip = normalizeIp(rawIp);
    if (!ip) throw new Error(`Invalid IP: ${rawIp}`);

    const providers = [['ipwho.is', classifyViaIpwhois], ['ip-api.com', classifyViaIpApi]];
    const errors = [];

    for (const [name, fn] of providers) {
        try {
            const { asn, org } = await fn(ip);
            return { asn, org, isDatacenter: isKnownDatacenterOrg(org) };
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
        }
    }

    throw new Error(errors.join('; '));
}

const TOP_DATACENTERS_LIMIT = 3;

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
 * Every distinct datacenter org's count, uncapped (unlike topDatacenters, which caps at
 * 3 for the live card), plus the non-datacenter classified count under the reserved
 * '(independent)' sentinel org. Used only by the daily snapshot collector -- the live
 * card's getDecentralizationStats() is unaffected by this function.
 */
export async function getFullDatacenterBreakdown() {
    const candidateIps = getCachedNetworkNodeIps();
    const candidateSet = new Set(candidateIps);
    const allClassifications = await getAllNodeIpClassifications();
    const relevant = allClassifications.filter(row => candidateSet.has(row.ip));

    const counts = new Map();
    let independentCount = 0;

    for (const row of relevant) {
        if (row.isDatacenter) {
            const key = row.org || 'Unknown';
            counts.set(key, (counts.get(key) || 0) + 1);
        } else {
            independentCount++;
        }
    }

    const breakdown = [...counts.entries()].map(([org, count]) => ({ org, count }));
    if (independentCount > 0) breakdown.push({ org: '(independent)', count: independentCount });
    return breakdown;
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

    const allClassifications = await getAllNodeIpClassifications();
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
            const { asn, org, isDatacenter } = await classifyIp(ip);
            results.push({ ip, asn, org, isDatacenter, classifiedAt: Date.now() });
        } catch (error) {
            log.warn('Classification failed for %s: %s', ip, error.message);
        }
    }

    if (results.length > 0) {
        await upsertNodeIpClassifications(results);
        for (const row of results) {
            known.set(row.ip, { ip: row.ip, org: row.org, isDatacenter: row.isDatacenter, classifiedAt: row.classifiedAt });
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
 * The current decentralization stats, computed on demand if the scheduler hasn't run yet
 * (cold start) rather than returning nothing.
 */
export async function getDecentralizationStats() {
    if (statsCache) return statsCache;

    const candidateIps = getCachedNetworkNodeIps();
    const allClassifications = await getAllNodeIpClassifications();
    return computeAndCacheStats(allClassifications, candidateIps);
}

/** Test hook. */
export function clearDecentralizationStatsCache() {
    statsCache = null;
    statsCacheAt = 0;
}

// src/lib/services/decentralizationService.js
//
// Decentralization metric (issue #108): what share of Flux NODES are hosted in datacenters.
//
// Since #457 everything here is derived from the node list busiestNodeService already fetches
// hourly (stats.runonflux.io/fluxinfo, `geolocation`), so this feature makes no calls of its
// own. It used to look each unique IP up on ipwho.is/ip-api.com, 20 every 5 minutes, and
// decide "datacenter" from a hand-kept keyword list. Two things were wrong with that:
//
//   - The unit was the IP, not the node. Several nodes share one IP (UPnP, ip:port) -- 843
//     IPs ran more than one node when this changed, up to 11 each -- and those are mostly
//     home operators, so one IP running 8 home nodes weighed the same as one Hetzner node.
//     52.9% of IPs read as datacenter where 34.5% of nodes did on the same list.
//   - The keyword list second-guessed nothing and missed a lot (GHOSTnet's 499 nodes).
//
// Now: a node is in a datacenter when its own geolocation says so (`dataCenter`, which
// FluxOS sets from ip-api.com's `hosting` flag), or when its provider is on
// DATACENTER_OVERRIDES. Nodes with no flag are unknown -- left out of the percentage and
// reported as coverage, never counted as independent. PROVIDER_GROUPS join the spellings of
// one company (Hetzner Online GmbH / Hetzner / HETZNER-DC) for display and snapshots.

import { getBusiestNode, getCachedNetworkNodes } from './busiestNodeService.js';
import { PROVIDER_GROUPS, DATACENTER_OVERRIDES } from '../config.js';
import { BREAKDOWN_DIMENSIONS } from '../decentralizationDimensions.js';
import { createLogger } from '../logger.js';

const log = createLogger('decentralizationService');

let statsCache = null;

const lowerMatch = (text, fragments) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return fragments.some(fragment => lower.includes(fragment));
};

/**
 * The display name for a node's host: its PROVIDER_GROUPS name when one matches, otherwise the
 * org as reported (isp when org is empty), or null when the node reports neither.
 */
export function providerName(org, isp) {
    const raw = (org || isp || '').trim();
    if (!raw) return null;
    const group = PROVIDER_GROUPS.find(g => lowerMatch(raw, g.match));
    return group ? group.name : raw;
}

/**
 * True when the node's provider is on DATACENTER_OVERRIDES. Matched on the same name the card
 * shows -- the org, the isp only when the org is empty -- so an override can only ever count
 * nodes under its own row. Issue #494: a reseller on DataVex's network under its own org was
 * not DataVex, but matching the isp too would have counted it.
 */
export function isDatacenterOverride(org, isp) {
    return lowerMatch((org || isp || '').trim(), DATACENTER_OVERRIDES);
}

/**
 * One node, classified. `classified` is false only when there is no flag and no override:
 * such a node is unknown, not independent.
 */
export function classifyNode(node) {
    const override = isDatacenterOverride(node.org, node.isp);
    const flag = node.dataCenter;
    return {
        ip: node.ip,
        org: providerName(node.org, node.isp),
        isDatacenter: override || flag === true,
        classified: override || typeof flag === 'boolean',
        country: node.country,
        countryCode: node.countryCode,
        continent: node.continent,
        continentCode: node.continentCode
    };
}

// Issue #120: raised from 3 to fill the card's stretched height.
const TOP_DATACENTERS_LIMIT = 6;

/**
 * Groups the datacenter nodes by provider, sorted by count. `percent` on each entry is a share
 * of ALL classified nodes (not just the datacenter subset), so "Hetzner: 25%" reads against the
 * same 100% as the headline "46% datacenter".
 */
function computeTopDatacenters(relevant, limit = TOP_DATACENTERS_LIMIT) {
    const counts = new Map();
    for (const row of relevant) {
        if (!row.isDatacenter) continue;
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
 * Every node, classified, from the node list (issue #151: loaded once and passed to each
 * breakdown). `relevant` is the classified subset every figure is computed over.
 */
export async function loadClassificationContext() {
    // Warm the node list first (issue #249). getCachedNetworkNodes() returns [] until
    // busiestNodeService's first successful fetch and never triggers one itself, so on a
    // freshly restarted process this used to read an empty set and record a null day.
    // Cheap: getBusiestNode() is TTL-cached.
    try {
        await getBusiestNode();
    } catch (error) {
        log.warn('Could not warm the network node list: %s', error.message);
    }

    const nodes = getCachedNetworkNodes().map(classifyNode);

    if (nodes.length === 0) {
        // Loud on purpose. Everything downstream degrades to null rather than failing, so
        // without this the only trace is a null column noticed weeks later in a report.
        log.warn('No network nodes available -- every breakdown will be empty and the ' +
            'snapshot will record null decentralization columns for this run');
    }

    return { nodes, relevant: nodes.filter(row => row.classified) };
}

/**
 * Group classified nodes by one named dimension (country, continent, ...). A row with no value
 * groups under the sentinel rather than being dropped, so the counts still sum to the
 * classified total; its code is deliberately null, since '(unknown)' has no ISO code.
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
 * Every datacenter provider's node count, uncapped, plus every non-datacenter classified node
 * under the reserved '(independent)' sentinel. Used by the daily snapshot collector.
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

/** Computes and caches the stats snapshot from a classification context. */
function computeAndCacheStats({ nodes, relevant }) {
    const datacenterCount = relevant.filter(row => row.isDatacenter).length;
    const classifiedCount = relevant.length;
    const totalNodes = nodes.length;
    const { top: topDatacenters, otherProviderCount } = computeTopDatacenters(relevant);

    statsCache = {
        totalNodes,
        classifiedCount,
        datacenterCount,
        // Share of the CLASSIFIED nodes that are in a datacenter -- null (not 0) with nothing
        // classified, so the UI can tell "0% datacenter" apart from "no data".
        datacenterPercent: classifiedCount > 0 ? (datacenterCount / classifiedCount) * 100 : null,
        // Share of all nodes that carry a flag or an override -- how much to trust the above.
        coveragePercent: totalNodes > 0 ? (classifiedCount / totalNodes) * 100 : 0,
        topDatacenters,
        otherProviderCount,
        updatedAt: Date.now()
    };
    return statsCache;
}

/**
 * One scheduler tick: recompute the live card from the node list. No external calls of its
 * own -- getBusiestNode() refreshes the list at most hourly. Never throws.
 */
export async function runDecentralizationCycle() {
    try {
        const context = await loadClassificationContext();
        if (context.nodes.length === 0) {
            log.info('No network nodes cached yet — skipping this cycle');
            return;
        }
        const stats = computeAndCacheStats(context);
        log.info(
            { nodes: stats.totalNodes, classified: stats.classifiedCount, datacenter: stats.datacenterCount },
            'Decentralization: %d of %d classified nodes in datacenters',
            stats.datacenterCount, stats.classifiedCount
        );
    } catch (error) {
        log.warn({ err: error }, 'Decentralization cycle failed');
    }
}

/**
 * The current decentralization stats. Given a context (the daily snapshot passes one), they
 * are computed from it, so the snapshot and its breakdowns describe the same node list;
 * otherwise the last computed stats, or computed on demand on a cold start.
 */
export async function getDecentralizationStats(context) {
    if (context) return computeAndCacheStats(context);
    if (statsCache) return statsCache;
    return computeAndCacheStats(await loadClassificationContext());
}

/** Invalidates the memoised stats. Used by tests. */
export function clearDecentralizationStatsCache() {
    statsCache = null;
}

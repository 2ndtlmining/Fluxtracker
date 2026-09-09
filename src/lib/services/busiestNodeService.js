// src/lib/services/busiestNodeService.js
//
// Busiest Node card (issue #108): the network's busiest node by running-instance count,
// its resolved app names, and CPU/RAM/SSD used vs. that node's own benchmarked capacity.
//
// One combined `fluxinfo` projection (API_ENDPOINTS.API_BUSIEST_NODE) returns per-node
// app names, resources and benchmark data together, so there's no separate fetch to pair
// up by IP. Runs on its own slower refresh (BUSIEST_NODE_CONFIG) rather than sharing
// runningAppsProvider's frequent cache — gaming/crypto/wordpress/cloud don't need the
// extra resources/benchmark/ip fields this card does.

import { API_ENDPOINTS } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, resolveRunningAppName } from './appSpecsCache.js';
import { createLogger } from '../logger.js';

const log = createLogger('busiestNodeService');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour, matches BUSIEST_NODE_CONFIG.updateInterval

let cache = null;
let cacheFetchedAt = 0;
let inFlight = null;
// The full network's node IPs from the same fetch -- decentralizationService reuses this
// rather than making its own call to stats.runonflux.io, so the two features share one
// hourly ~4MB fetch instead of two.
let networkNodeIps = [];

async function fetchBusiestNode() {
    const [body] = await Promise.all([
        resilientFetch(API_ENDPOINTS.API_BUSIEST_NODE, { timeout: 30000, breakerKey: 'busiest-node' }),
        ensureGlobalSpecsCache()
    ]);

    if (body?.status === 'error' && body.data) {
        throw new Error(`API Error: ${body.data.name} - ${body.data.message}`);
    }

    const nodes = body?.data;
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('API_BUSIEST_NODE returned empty or invalid data');
    }

    // Multiple node entries can share one physical IP (a host running several Flux
    // instances on different ports) -- dedup so a heavily multi-instanced host doesn't
    // skew the decentralization stats by counting as several nodes.
    networkNodeIps = [...new Set(
        nodes
            .map(node => node?.geolocation?.ip || (node?.ip || '').split(':')[0] || null)
            .filter(Boolean)
    )];

    let busiestNode = null;
    let busiestCount = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        const appCount = Array.isArray(runningApps) ? runningApps.length : 0;
        if (appCount === 0 || appCount <= busiestCount) continue;

        busiestNode = node;
        busiestCount = appCount;
    }

    if (!busiestNode) {
        throw new Error('No node with running apps found');
    }

    const appNames = [];
    for (const app of busiestNode.apps.runningapps) {
        const containerName = app?.Names?.[0];
        if (!containerName) continue;
        const resolved = resolveRunningAppName(containerName);
        if (resolved) appNames.push(resolved.appName);
    }

    // appsRamLocked is MB; benchmark.bench.ram is GB (same MB-called-GB split this codebase
    // already has elsewhere — see cloudService.js). appsCpusLocked/appsHddLocked already share
    // their benchmark counterpart's unit (cores, GB) as-is.
    const resources = busiestNode.apps.resources || {};
    const bench = busiestNode.benchmark?.bench || {};

    const result = {
        ip: busiestNode.geolocation?.ip || (busiestNode.ip || '').split(':')[0] || null,
        tier: busiestNode.tier || null,
        country: busiestNode.geolocation?.country || null,
        countryCode: busiestNode.geolocation?.countryCode || null,
        appCount: busiestCount,
        appNames,
        resources: {
            cpu: { used: resources.appsCpusLocked || 0, total: bench.cores || 0 },
            ram: { used: (resources.appsRamLocked || 0) / 1000, total: bench.ram || 0 },
            ssd: { used: resources.appsHddLocked || 0, total: bench.ssd || 0 }
        }
    };

    log.info(
        { ip: result.ip, appCount: result.appCount, resolvedNames: appNames.length },
        'Busiest node: %s with %d instances (%d resolved)',
        result.ip,
        result.appCount,
        appNames.length
    );

    return result;
}

/**
 * The current busiest node, refetching if the cache is stale or empty.
 * Concurrent callers within the TTL share one fetch.
 */
export async function getBusiestNode({ ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
    if (!force && cache && Date.now() - cacheFetchedAt < ttlMs) {
        return cache;
    }

    if (inFlight) return inFlight;

    inFlight = fetchBusiestNode()
        .then(result => {
            cache = result;
            cacheFetchedAt = Date.now();
            return result;
        })
        .finally(() => {
            inFlight = null;
        });

    return inFlight;
}

/** Last successful result, or null. Never triggers a network call. */
export function getCachedBusiestNode() {
    return cache;
}

/**
 * The deduped node IPs from the last successful fetch, or [] before the first one lands.
 * Never triggers a network call -- decentralizationService pairs this with its own call to
 * getBusiestNode() (a cheap no-op once the hourly cache is warm) to seed its own fetch.
 */
export function getCachedNetworkNodeIps() {
    return networkNodeIps;
}

/** Test hook — drops the cached result. */
export function clearBusiestNodeCache() {
    cache = null;
    cacheFetchedAt = 0;
    inFlight = null;
    networkNodeIps = [];
}

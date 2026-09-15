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

/**
 * The APP a running container belongs to (issue #190).
 *
 * A compose app runs one container PER COMPONENT on the same node -- ghostddns alone runs
 * ddns, nginx, operator, mysql and ghost -- so runningapps.length is a container count, not
 * an app count. Counting containers reported 13 apps on a node that Flux's own node
 * dashboard shows as 6. Same class of miscount as the FiveM one in issue #163.
 *
 * resolveRunningAppName is authoritative and is tried first: it confirms the app against the
 * spec cache, and it handles the legacy flat-spec case where the container name IS the app
 * name and may itself contain an underscore.
 *
 * The fallback matters for the COUNT. A container whose spec the cache doesn't know (pruned,
 * expired, or simply missing) used to be counted in appCount but dropped from appNames --
 * the card then said 13 while listing 8. Deriving the name from the container instead keeps
 * one number behind both: "flux<component>_<appName>", split at the FIRST underscore because
 * the component always comes first.
 */
export function appNameForContainer(containerName) {
    if (!containerName) return null;

    const resolved = resolveRunningAppName(containerName);
    if (resolved?.appName) return resolved.appName;

    const stripped = String(containerName).replace(/^\//, '').replace(/^flux/, '');
    if (!stripped) return null;

    const underscoreIndex = stripped.indexOf('_');
    return underscoreIndex > 0 ? stripped.slice(underscoreIndex + 1) : stripped;
}

/**
 * Apps running on a node with the number of containers each one runs, in the order their
 * first container appears.
 *
 * The per-app container count is what lets the card account for every running container
 * without printing the same name five times: "ghostddns x5" is both shorter and more
 * informative than five identical pills, and the counts sum to the node's container total.
 *
 * @returns {Array<{name: string, containers: number}>}
 */
function appsOnNode(node) {
    const containers = node?.apps?.runningapps;
    if (!Array.isArray(containers)) return [];

    const counts = new Map();
    for (const container of containers) {
        const name = appNameForContainer(container?.Names?.[0]);
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, containers: count }));
}

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

    // Busiest by CONTAINER count, which is the node's actual workload: a compose app's five
    // components are five running containers competing for that node's CPU, RAM and disk, and
    // the resource bars below the headline measure exactly that. Deliberate choice, revisited
    // in #190 -- ranking by distinct apps was tried and rejected, because a node running ten
    // single-container apps is doing less work than one running six apps across thirteen
    // containers at 93% CPU, and the card exists to show the busiest MACHINE.
    //
    // The count shown is still the app count (see appNameForContainer): what was wrong in #190
    // was calling containers "apps", not ranking by them. The card now reports both.
    //
    // Apps break the tie: same container load, more distinct apps is more varied work. First
    // node seen wins a full tie, so the choice is stable between fetches.
    let busiestNode = null;
    let busiestApps = [];
    let busiestContainers = 0;

    for (const node of nodes) {
        const containers = node?.apps?.runningapps;
        const containerCount = Array.isArray(containers) ? containers.length : 0;
        if (containerCount === 0) continue;

        const apps = appsOnNode(node);
        if (apps.length === 0) continue;

        const better = containerCount > busiestContainers
            || (containerCount === busiestContainers && apps.length > busiestApps.length);
        if (!better) continue;

        busiestNode = node;
        busiestApps = apps;
        busiestContainers = containerCount;
    }

    if (!busiestNode) {
        throw new Error('No node with running apps found');
    }

    const appNames = busiestApps.map(app => app.name);
    const busiestCount = busiestApps.length;

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
        // Containers are the headline: they are what is actually running on the machine, and
        // what the resource bars below measure. appCount says how many distinct APPS those
        // containers belong to -- the distinction #190 was about.
        containerCount: busiestContainers,
        appCount: busiestCount,
        appNames,
        // Per-app container counts. These sum to containerCount, so the card can show every
        // running container ("ghostddns x5") without repeating a name five times.
        apps: busiestApps,
        resources: {
            cpu: { used: resources.appsCpusLocked || 0, total: bench.cores || 0 },
            ram: { used: (resources.appsRamLocked || 0) / 1000, total: bench.ram || 0 },
            ssd: { used: resources.appsHddLocked || 0, total: bench.ssd || 0 }
        }
    };

    log.info(
        { ip: result.ip, appCount: result.appCount, containerCount: result.containerCount },
        'Busiest node: %s with %d apps across %d containers',
        result.ip,
        result.appCount,
        result.containerCount
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

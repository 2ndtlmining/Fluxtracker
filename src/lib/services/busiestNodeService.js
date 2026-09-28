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

import { API_ENDPOINTS, CPU_CONTINENTS, cpuCoresColumn, cpuLockedColumn } from '../config.js';
import { updateCurrentMetrics } from '../db/database.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, resolveRunningAppName } from './appSpecsCache.js';
import { createLogger } from '../logger.js';

const log = createLogger('busiestNodeService');

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour, matches BUSIEST_NODE_CONFIG.updateInterval

let cache = null;
let cacheFetchedAt = 0;
let inFlight = null;
// Every node's hosting data from the same fetch -- decentralizationService's whole source
// (#457), so the two features share one hourly ~4MB fetch instead of two.
let networkNodes = [];
// Nodes per continent from the same fetch (issue #268), counted per node.
let networkNodeContinents = null;

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

    // One row per NODE for decentralization (#457), which counts every node on a shared IP
    // (it used to dedupe to IPs). Only the fields it reads are kept, not the ~4 MB payload.
    networkNodes = nodes.map(node => {
        const geo = node?.geolocation ?? {};
        return {
            ip: geo.ip || (node?.ip || '').split(':')[0] || null,
            org: typeof geo.org === 'string' ? geo.org.trim() : '',
            isp: typeof geo.isp === 'string' ? geo.isp.trim() : '',
            // FluxOS sets this from ip-api.com's `hosting` flag. Absent on nodes without a
            // lookup -- null there, not false: "unknown" is not "independent".
            dataCenter: typeof geo.dataCenter === 'boolean' ? geo.dataCenter : null,
            country: geo.country || null,
            countryCode: geo.countryCode || null,
            continent: geo.continent || null,
            continentCode: geo.continentCode || null
        };
    });

    const continentCounts = {};
    // CPU supply and demand per continent (issue #463): the cores each node benchmarks, and
    // the cores apps have locked on it -- the node's own report, so every app counts.
    const continentCpu = {};
    let located = 0;
    for (const node of nodes) {
        const code = node?.geolocation?.continentCode;
        if (!code) continue;
        continentCounts[code] = (continentCounts[code] ?? 0) + 1;
        const cpu = (continentCpu[code] ??= { cores: 0, locked: 0 });
        cpu.cores += Number(node?.benchmark?.bench?.cores) || 0;
        cpu.locked += Number(node?.apps?.resources?.appsCpusLocked) || 0;
        located++;
    }
    networkNodeContinents = { counts: continentCounts, cpu: continentCpu, located, total: nodes.length };

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
 * One row per node from the last successful fetch (hosting org, datacenter flag, country,
 * continent), or [] before the first one lands. Never triggers a network call (#457).
 */
export function getCachedNetworkNodes() {
    return networkNodes;
}

/** Per continent from the last fetch ({ counts, cpu: {code: {cores, locked}}, located, total }), or null. */
export function getCachedNodeContinents() {
    return networkNodeContinents;
}

/**
 * Services-cycle step (issue #463): store CPU cores and locked cores per continent in
 * current_metrics, so the daily snapshot records them. Reuses the hourly node list (no call
 * of its own once warm). Throws when the list is unavailable, so the cycle records a failure
 * and the stored reading is left alone -- never zeros for a failed fetch. A continent with
 * no nodes is a real 0.
 */
export async function recordContinentCpu() {
    await getBusiestNode();
    const continents = networkNodeContinents;
    if (!continents || continents.located === 0) throw new Error('Node list unavailable -- continent CPU not recorded');

    const row = {};
    for (const { code } of CPU_CONTINENTS) {
        const cpu = continents.cpu?.[code] ?? { cores: 0, locked: 0 };
        row[cpuCoresColumn(code)] = Math.round(cpu.cores * 100) / 100;
        row[cpuLockedColumn(code)] = Math.round(cpu.locked * 100) / 100;
    }
    await updateCurrentMetrics(row);
    return row;
}

/** Test hook — drops the cached result. */
export function clearBusiestNodeCache() {
    cache = null;
    cacheFetchedAt = 0;
    inFlight = null;
    networkNodes = [];
    networkNodeContinents = null;
}

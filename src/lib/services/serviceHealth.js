// Per-step record of the services cycle (issues #431). A leaf module: the scheduler writes
// it, /api/health and the daily snapshot read it, and neither has to import the other.

import { TRACKED_GAMES, CRYPTO_REPOS, CONTINENT_CPU_COLUMNS } from '../config.js';

/** name -> { lastSuccess, consecutiveFailures, lastError } */
const serviceHealth = {};

/** When this process started: a service with no success yet is judged from here. */
const processStart = Date.now();

/**
 * A source that has not refreshed for this long is stale (#431, owner decision 2026-09-29):
 * the daily snapshot records its columns as NULL -- a gap -- instead of the frozen figures.
 */
export const STALE_SOURCE_MS = 6 * 60 * 60 * 1000;

/**
 * The current_metrics columns each services-cycle step writes. Kept beside the record so a
 * stale step maps to exactly its own columns and nothing else in the row.
 */
export const SERVICE_COLUMNS = {
    nodes: ['node_cumulus', 'node_nimbus', 'node_stratus', 'node_total',
        'locked_collateral_cumulus', 'locked_collateral_nimbus', 'locked_collateral_stratus', 'locked_collateral'],
    wallets: ['unique_wallets'],
    appOwners: ['unique_app_owners', 'median_days_left', 'enterprise_apps', 'enterprise_apps_percent'],
    cloud: ['total_cpu_cores', 'used_cpu_cores', 'cpu_utilization_percent',
        'total_ram_gb', 'used_ram_gb', 'ram_utilization_percent',
        'total_storage_gb', 'used_storage_gb', 'storage_utilization_percent',
        'total_apps', 'watchtower_count', 'gitapps_count', 'dockerapps_count', 'gitapps_percent', 'dockerapps_percent',
        'deployments_ordered', 'deployments_running', 'deployment_fill_percent',
        'expired_running_apps', 'expired_running_instances'],
    continentCpu: [...CONTINENT_CPU_COLUMNS],
    gaming: ['gaming_apps_total', 'gaming_instances_total', ...TRACKED_GAMES.map(g => g.dbKey)],
    crypto: ['crypto_nodes_total', ...CRYPTO_REPOS.map(r => r.dbKey)],
    wordpress: ['wordpress_count']
};

/** Fold one cycle's { succeeded, failed } into the record. */
export function recordServiceResults(result, now = Date.now()) {
    for (const name of result?.succeeded ?? []) {
        serviceHealth[name] = { lastSuccess: now, consecutiveFailures: 0, lastError: null };
    }
    for (const { name, error } of result?.failed ?? []) {
        const entry = (serviceHealth[name] ??= { lastSuccess: null, consecutiveFailures: 0, lastError: null });
        entry.consecutiveFailures++;
        entry.lastError = error;
    }
}

/** A copy of the record, for health. */
export function getServiceHealth() {
    return { ...serviceHealth };
}

/**
 * Steps that have not refreshed for `maxAgeMs`: failing now, and last successful longer ago
 * than that (or never, since a process start longer ago than that). A step that is failing
 * but succeeded recently is not stale; a step that has never run yet is not stale either.
 */
export function staleServices(maxAgeMs = STALE_SOURCE_MS, now = Date.now()) {
    return Object.entries(serviceHealth)
        .filter(([, s]) => s.consecutiveFailures > 0 && now - (s.lastSuccess ?? processStart) >= maxAgeMs)
        .map(([name]) => name);
}

/** The current_metrics columns of every stale step -- what the snapshot must not record. */
export function staleColumns(maxAgeMs = STALE_SOURCE_MS, now = Date.now()) {
    return staleServices(maxAgeMs, now).flatMap(name => SERVICE_COLUMNS[name] ?? []);
}

/** Test hook. */
export function __resetServiceHealthForTests() {
    for (const key of Object.keys(serviceHealth)) delete serviceHealth[key];
}

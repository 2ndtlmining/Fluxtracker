// lib/db/snapshotManager.js - SIMPLIFIED VERSION
// No backfill - only creates TODAY's snapshot
// Includes gaming_valheim (fixes 36/37 column mismatch)
// Uses transaction-based revenue
// Runs every 30 minutes

import {
    createDailySnapshot,
    createRepoSnapshots,
    createGameSnapshots,
    getRepoSnapshotCountByDate,
    getCurrentMetrics,
    getSnapshotByDate,
    fillSnapshotNullColumns,
    getRevenueForDateRange,
    createDecentralizationSnapshots,
    updateSnapshotRevenue,
    createDecentralizationCountrySnapshots,
    createDecentralizationContinentSnapshots
} from './database.js';
import { getLatestRepoCounts } from '../services/cloudService.js';
import { getLiveGameBreakdown } from '../services/gamingService.js';
import {
    getDecentralizationStats,
    loadClassificationContext,
    getFullDatacenterBreakdown,
    getFullCountryBreakdown,
    getFullContinentBreakdown
} from '../services/decentralizationService.js';
import { getFluxCloudActivity } from '../services/carouselService.js';
import { shouldAllowRequest, recordSuccess, recordFailure } from './circuitBreaker.js';
import { isBackupEnabled, performBackup } from '../services/backupService.js';
import { SNAPSHOT_CONFIG as SNAP_CFG, METRIC_COLUMNS, TRACKED_GAMES, CRYPTO_REPOS } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('snapshotManager');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    CHECK_INTERVAL_MS: SNAP_CFG.CHECK_INTERVAL_MS,
    GRACE_PERIOD_MINUTES: SNAP_CFG.GRACE_PERIOD_MINUTES,
    MIN_VALID_METRICS: SNAP_CFG.MIN_VALID_METRICS,
    MAX_METRIC_AGE_HOURS: SNAP_CFG.MAX_METRIC_AGE_HOURS,
};

let state = {
    isRunning: false,
    lastCheck: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    intervalId: null,
    repoRetryId: null,       // Track retry timer to prevent unbounded retries
    repoRetryCount: 0,       // Limit retries
};

/**
 * The scheduler state, minus its timer handles (issue #247).
 *
 * BOTH handles have to come out, not just repoRetryId. A Node Timeout is circular, so one
 * reaching res.json() is a 500 -- which is exactly what /api/admin/snapshot-status returned
 * on every running instance, because it serialises this whole object and intervalId was
 * still in it. /api/health escaped only because it cherry-picks four fields by name.
 *
 * Each handle is replaced by the boolean a caller actually wants, matching the shape
 * revenueScheduler.getRevenueSyncSchedulerStatus() already returns.
 */
export function getSnapshotState() {
    const { repoRetryId, intervalId, ...safeState } = state;
    return {
        ...safeState,
        repoRetryPending: !!repoRetryId,
        isSchedulerRunning: !!intervalId
    };
}

/** Epoch seconds or milliseconds -> milliseconds (null for anything else). */
function toEpochMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
}

export async function getSnapshotSystemStatus() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todaySnapshot = await getSnapshotByDate(today);

    // Healthy means a snapshot is actually current, not only that recent attempts did not
    // throw (issue #310): today's row exists, or it is still early enough in the UTC day for
    // today's to be pending and yesterday's is in place. `consecutiveFailures` alone read
    // healthy after every restart, when it is 0 whatever the table holds.
    let current = !!todaySnapshot;
    if (!current) {
        const minutesIntoDay = now.getUTCHours() * 60 + now.getUTCMinutes();
        const pendingWindow = CONFIG.GRACE_PERIOD_MINUTES + (2 * CONFIG.CHECK_INTERVAL_MS) / 60000;
        if (minutesIntoDay <= pendingWindow) {
            const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
            current = !!(await getSnapshotByDate(yesterday));
        }
    }

    const safeState = getSnapshotState();
    return {
        config: CONFIG,
        // One source of truth for what is safe to serialise -- see getSnapshotState().
        state: {
            ...safeState,
            // After a restart the in-memory value is null; today's row says when it last worked.
            // Its `timestamp` column is epoch SECONDS -- normalised so the field is always ms.
            lastSuccess: safeState.lastSuccess ?? toEpochMs(todaySnapshot?.timestamp)
        },
        todaySnapshotExists: !!todaySnapshot,
        todaySnapshotDate: todaySnapshot?.snapshot_date || null,
        isHealthy: state.consecutiveFailures < 3 && current
    };
}

// ============================================
// VALIDATION
// ============================================

function areMetricsPopulated(metrics) {
    if (!metrics) {
        return { valid: false, reason: 'No metrics in database' };
    }
    
    if (!metrics.last_update) {
        return { valid: false, reason: 'No last_update timestamp' };
    }
    
    const metricAge = Date.now() - metrics.last_update;
    const maxAge = CONFIG.MAX_METRIC_AGE_HOURS * 60 * 60 * 1000;
    
    if (metricAge > maxAge) {
        const ageHours = Math.round(metricAge / 1000 / 60 / 60);
        return { valid: false, reason: `Metrics ${ageHours}h old (max ${CONFIG.MAX_METRIC_AGE_HOURS}h)` };
    }
    
    const keyMetrics = [
        metrics.node_total,
        metrics.total_apps,
        metrics.total_cpu_cores,
        metrics.total_ram_gb,
        metrics.total_storage_gb
    ];
    
    const nonZeroCount = keyMetrics.filter(v => v && v > 0).length;
    
    if (nonZeroCount < CONFIG.MIN_VALID_METRICS) {
        return { 
            valid: false, 
            reason: `Only ${nonZeroCount}/${keyMetrics.length} metrics populated (need ${CONFIG.MIN_VALID_METRICS})` 
        };
    }
    
    const ageMinutes = Math.round(metricAge / 1000 / 60);
    return { 
        valid: true, 
        reason: `Valid: ${nonZeroCount}/${keyMetrics.length} metrics, ${ageMinutes}min old` 
    };
}

// ============================================
// SNAPSHOT CREATION
// ============================================

async function shouldTakeSnapshot() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Check if today's snapshot exists
    const existingSnapshot = await getSnapshotByDate(today);
    if (existingSnapshot) {
        return {
            should: false,
            reason: `Snapshot already exists for ${today}`
        };
    }

    // Check grace period after midnight
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const minutesSinceMidnight = currentHour * 60 + currentMinute;

    if (minutesSinceMidnight < CONFIG.GRACE_PERIOD_MINUTES) {
        return {
            should: false,
            reason: `Within grace period (${CONFIG.GRACE_PERIOD_MINUTES} min after midnight)`
        };
    }

    // Validate metrics
    const currentMetrics = await getCurrentMetrics();
    const metricsCheck = areMetricsPopulated(currentMetrics);

    if (!metricsCheck.valid) {
        return {
            should: false,
            reason: `Metrics not ready: ${metricsCheck.reason}`
        };
    }

    return {
        should: true,
        reason: `Ready: ${metricsCheck.reason}`
    };
}

/**
 * The daily_snapshots row, as a pure function of the readings it is given (issue #229).
 *
 * Extracted from takeSnapshot() so the correspondence between METRIC_COLUMNS and what
 * actually reaches the row can be asserted by a test -- see snapshotColumnParity.test.js.
 * Nothing here does IO; every value is passed in.
 */
export function buildSnapshotData({
    snapshotDate,
    now,
    actualRevenue,
    currentMetrics,
    decentralization,
    hasDecentralizationClassifications,
    fluxCloudActivity
}) {
    return {
        snapshot_date: snapshotDate,
        timestamp: Math.floor(now.getTime() / 1000),
        
        // Revenue - FROM TRANSACTIONS
        daily_revenue: actualRevenue,
        flux_price_usd: currentMetrics.flux_price_usd || null,
        
        // Cloud Utilization
        total_cpu_cores: currentMetrics.total_cpu_cores || 0,
        used_cpu_cores: currentMetrics.used_cpu_cores || 0,
        cpu_utilization_percent: currentMetrics.cpu_utilization_percent || 0,
        
        total_ram_gb: currentMetrics.total_ram_gb || 0,
        used_ram_gb: currentMetrics.used_ram_gb || 0,
        ram_utilization_percent: currentMetrics.ram_utilization_percent || 0,
        
        total_storage_gb: currentMetrics.total_storage_gb || 0,
        used_storage_gb: currentMetrics.used_storage_gb || 0,
        storage_utilization_percent: currentMetrics.storage_utilization_percent || 0,
        
        // Apps
        total_apps: currentMetrics.total_apps || 0,
        watchtower_count: currentMetrics.watchtower_count || 0,
        gitapps_count: currentMetrics.gitapps_count || 0,
        dockerapps_count: currentMetrics.dockerapps_count || 0,
        gitapps_percent: currentMetrics.gitapps_percent || 0,
        dockerapps_percent: currentMetrics.dockerapps_percent || 0,
        
        // Gaming and crypto counts are DERIVED FROM CONFIG, not listed literally
        // (issue #229). The literal list silently stopped matching GAMING_REPOS when
        // games were added to config: gaming_rust/terraria/ark/windrose were never
        // written here, and because schemaMigrator creates game columns as
        // `INTEGER DEFAULT 0` the unwritten column landed as 0 rather than NULL -- so
        // the NULL top-up below could never repair it, and those four games recorded a
        // fabricated 0 every day while current_metrics held the real count.
        //
        // `|| 0` matches what the five hardcoded gaming columns always did, so existing
        // history keeps its semantics; only the missing columns change behaviour.
        ...Object.fromEntries(TRACKED_GAMES.map(g => [g.dbKey, currentMetrics[g.dbKey] || 0])),
        gaming_apps_total: currentMetrics.gaming_apps_total || 0,
        // Same-method history for the Gaming card's comparison arrows (issue #163).
        // gaming_apps_total above stays image-only so the existing trend line does not
        // step on the day app-name matching ships.
        gaming_instances_total: currentMetrics.gaming_instances_total ?? null,

        ...Object.fromEntries(CRYPTO_REPOS.map(r => [r.dbKey, currentMetrics[r.dbKey] || 0])),
        crypto_nodes_total: currentMetrics.crypto_nodes_total || 0,

        // Written explicitly rather than left to the NULL top-up (issue #229). The
        // top-up still runs and is still the safety net for a metric that ships
        // mid-day, but it should not be the PRIMARY way a column reaches the row --
        // that is how the gaming columns above went unnoticed. `?? null` because these
        // have no DEFAULT: absent must read back as "not collected", never a 0 the KPI
        // layer would average in as a real reading.
        unique_wallets: currentMetrics.unique_wallets ?? null,
        unique_app_owners: currentMetrics.unique_app_owners ?? null,
        locked_collateral_cumulus: currentMetrics.locked_collateral_cumulus ?? null,
        locked_collateral_nimbus: currentMetrics.locked_collateral_nimbus ?? null,
        locked_collateral_stratus: currentMetrics.locked_collateral_stratus ?? null,
        locked_collateral: currentMetrics.locked_collateral ?? null,

        // WordPress
        wordpress_count: currentMetrics.wordpress_count || 0,
        
        // Nodes
        node_cumulus: currentMetrics.node_cumulus || 0,
        node_nimbus: currentMetrics.node_nimbus || 0,
        node_stratus: currentMetrics.node_stratus || 0,
        node_total: currentMetrics.node_total || 0,

        // Decentralization -- classifiedCount === 0 means "nothing classified yet", so the
        // headline columns stay null (not 0) rather than reading as a real 0% datacenter share.
        decentralization_datacenter_count: hasDecentralizationClassifications
        ? decentralization?.datacenterCount ?? null
        : null,
        decentralization_independent_count:
        hasDecentralizationClassifications && decentralization?.datacenterCount != null
            ? decentralization.classifiedCount - decentralization.datacenterCount
            : null,
        decentralization_datacenter_percent: decentralization?.datacenterPercent ?? null,

        // Flux Cloud activity -- see fluxCloudActivity fetch above for the null posture.
        apps_deployed_today: fluxCloudActivity?.deployedToday.cached
        ? fluxCloudActivity.deployedToday.apps.length
        : null,
        apps_expiring_today: fluxCloudActivity?.expiring24h.cached
        ? fluxCloudActivity.expiring24h.apps.length
        : null,

        sync_status: 'completed'
    };
}

/** Shift a YYYY-MM-DD string by n days in UTC -- local time would drift across a DST change. */
function shiftUtcDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

/**
 * Record the previous day's completed revenue (issue #248).
 *
 * Today's snapshot runs minutes after midnight UTC, so the daily_revenue it stores for TODAY
 * is only what arrived in those first few minutes -- and it is never revisited, because
 * shouldTakeSnapshot() refuses once today's row exists. Across 836 live rows, the 315 written
 * that way held 15,375 FLUX between them against an actual 1,313,595.
 *
 * Yesterday, however, IS complete by now, so this is the moment its figure can be made true.
 *
 * Only ever an update: a day with no row at all is backfillRevenueSnapshots()'s job, and
 * inserting a revenue-only row here would create a snapshot with every other column null.
 * Best-effort, like every other write after the headline row -- a failure here must not cost
 * the snapshot this cycle exists for.
 */
async function finalisePreviousDayRevenue(snapshotDate) {
    const previousDate = shiftUtcDate(snapshotDate, -1);

    try {
        const existing = await getSnapshotByDate(previousDate);
        if (!existing) return;

        const finalRevenue = await getRevenueForDateRange(previousDate, previousDate);
        const updated = await updateSnapshotRevenue(previousDate, finalRevenue);

        if (updated) {
            log.info(
                { date: previousDate, revenue: finalRevenue },
                `Finalised revenue for ${previousDate}: ${finalRevenue.toFixed(2)} FLUX`
            );
        }
    } catch (error) {
        log.warn(`Could not finalise revenue for ${previousDate}: ${error.message}`);
    }
}

async function takeSnapshot() {
    log.info('[SNAPSHOT] Taking snapshot...');
    
    try {
        const now = new Date();
        const snapshotDate = now.toISOString().split('T')[0];
        
        const currentMetrics = await getCurrentMetrics();

        if (!currentMetrics) {
            throw new Error('No current metrics available');
        }

        // Get actual revenue from transactions for TODAY
        const actualRevenue = await getRevenueForDateRange(snapshotDate, snapshotDate);
        
        log.info(`Revenue for ${snapshotDate}: ${actualRevenue.toFixed(2)} FLUX`);

        // One read of node_ip_classification for all four consumers below (issue #151).
        // Each of them used to fetch and filter the table for itself, so a single snapshot
        // cycle paginated the whole table up to four times for identical data. A failure
        // here is not fatal: each consumer still falls back to loading it on its own, and
        // its own try/catch still keeps a failure off the headline row.
        let classificationContext = null;
        try {
            classificationContext = await loadClassificationContext();
        } catch (error) {
            log.warn(`Decentralization classifications unavailable for this snapshot: ${error.message}`);
        }

        let decentralization = null;
        let decentralizationBreakdown = [];
        try {
            decentralization = await getDecentralizationStats(classificationContext);
            decentralizationBreakdown = await getFullDatacenterBreakdown(classificationContext);
        } catch (error) {
            log.warn(`Decentralization data unavailable for this snapshot: ${error.message}`);
        }

        // Issue #138: country/continent breakdown, each in its own try/catch so one failing
        // doesn't stop the other from being attempted (unlike the shared stats+org fetch
        // above, which is pre-existing and left as-is) -- and never blocks the headline row.
        let decentralizationCountryBreakdown = [];
        try {
            decentralizationCountryBreakdown = await getFullCountryBreakdown(classificationContext);
        } catch (error) {
            log.warn(`Decentralization country breakdown unavailable for this snapshot: ${error.message}`);
        }
        let decentralizationContinentBreakdown = [];
        try {
            decentralizationContinentBreakdown = await getFullContinentBreakdown(classificationContext);
        } catch (error) {
            log.warn(`Decentralization continent breakdown unavailable for this snapshot: ${error.message}`);
        }
        const hasDecentralizationClassifications = (decentralization?.classifiedCount ?? 0) > 0;

        // Flux Cloud activity -- best-effort, same posture as decentralization above: a
        // read failure never blocks the headline snapshot row. `cached: false` means the
        // on-demand fetch failed with nothing ever stored, so the count stays null (not a
        // fabricated 0 that would misreport as "nothing deployed/expiring that day").
        let fluxCloudActivity = null;
        try {
            fluxCloudActivity = await getFluxCloudActivity();
        } catch (error) {
            log.warn(`Flux Cloud activity unavailable for this snapshot: ${error.message}`);
        }

        const snapshotData = buildSnapshotData({
            snapshotDate,
            now,
            actualRevenue,
            currentMetrics,
            decentralization,
            hasDecentralizationClassifications,
            fluxCloudActivity
        });

        await createDailySnapshot(snapshotData);

        // Today's figure above is a partial by definition; yesterday's can now be made
        // final (issue #248). After the headline write, never before it.
        await finalisePreviousDayRevenue(snapshotDate);

        // Per-provider breakdown -- best-effort, same posture as the repo-snapshot write
        // immediately below: never blocks the headline daily_snapshots row.
        if (decentralizationBreakdown.length > 0) {
            try {
                await createDecentralizationSnapshots(snapshotDate, decentralizationBreakdown);
            } catch (error) {
                log.warn(`Decentralization snapshot write failed: ${error.message}`);
            }
        }

        // Per-country/continent breakdown (issue #138) -- same best-effort posture, each
        // independent so one failing doesn't block the other or the org breakdown above.
        if (decentralizationCountryBreakdown.length > 0) {
            try {
                await createDecentralizationCountrySnapshots(snapshotDate, decentralizationCountryBreakdown);
            } catch (error) {
                log.warn(`Decentralization country snapshot write failed: ${error.message}`);
            }
        }
        if (decentralizationContinentBreakdown.length > 0) {
            try {
                await createDecentralizationContinentSnapshots(snapshotDate, decentralizationContinentBreakdown);
            } catch (error) {
                log.warn(`Decentralization continent snapshot write failed: ${error.message}`);
            }
        }

        // Per-game counts (issue #163) -- the history the Gaming section's comparison arrows
        // read. Isolated in its own try/catch: this is a nice-to-have trend, and a failure
        // here must not cost us the daily snapshot that everything else depends on.
        try {
            const breakdown = await getLiveGameBreakdown();
            if (breakdown.games.length > 0) {
                const saved = await createGameSnapshots(snapshotDate, breakdown.games);
                log.info(`Games: ${saved} tracked, ${breakdown.total} instances`);
            } else {
                // Writing zero rows beats writing zeros: an empty day is visibly absent from
                // the history rather than reading as "no games ran".
                log.warn('Game snapshot skipped - no games resolved, likely partial API data');
            }
        } catch (error) {
            log.warn(`Game snapshot write failed: ${error.message}`);
        }

        // Save per-repo Docker image counts
        const repoCounts = getLatestRepoCounts();
        const repoKeyCount = repoCounts ? Object.keys(repoCounts).length : 0;
        if (repoKeyCount >= 10) {
            const saved = await createRepoSnapshots(snapshotDate, repoCounts);
            log.info(`Docker repos: ${saved} unique images tracked`);
            state.repoRetryCount = 0;
        } else if (repoKeyCount > 0) {
            log.warn(`Skipping repo snapshot - only ${repoKeyCount} images (expected 10+), likely partial API data`);
        } else {
            scheduleRepoRetry('takeSnapshot');
        }

        state.lastSuccess = Date.now();
        state.consecutiveFailures = 0;

        log.info(`[SNAPSHOT] Snapshot created for ${snapshotDate}`);
        log.info(`Revenue: ${snapshotData.daily_revenue.toFixed(2)} FLUX`);
        log.info(`Nodes: ${snapshotData.node_total}, Apps: ${snapshotData.total_apps}`);

        // Fire-and-forget backup after successful snapshot
        if (isBackupEnabled()) {
            performBackup().then(result => {
                if (result.success) log.info(`Backup: ${result.tables.daily_snapshots} daily + ${result.tables.repo_snapshots} repo + ${result.tables.flux_price_history} price rows`);
                else log.warn(`Backup failed: ${result.error}`);
            }).catch(err => log.warn(`Backup error: ${err.message}`));
        }

        return {
            success: true,
            snapshotDate,
            data: snapshotData
        };
        
    } catch (error) {
        log.error({ err: error }, '[SNAPSHOT] Snapshot failed');
        state.consecutiveFailures++;
        
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================
// MAIN CHECK
// ============================================

const MAX_REPO_RETRIES = SNAP_CFG.MAX_REPO_RETRIES;

function scheduleRepoRetry(source) {
    if (state.repoRetryCount >= MAX_REPO_RETRIES) {
        log.warn(`Repo snapshot: gave up after ${MAX_REPO_RETRIES} retries (from ${source})`);
        return;
    }
    state.repoRetryCount++;
    log.info(`Repo counts not available yet, retry ${state.repoRetryCount}/${MAX_REPO_RETRIES} in 2 minutes (from ${source})`);
    if (state.repoRetryId) clearTimeout(state.repoRetryId);
    state.repoRetryId = setTimeout(() => {
        state.repoRetryId = null;
        runCheck();
    }, 2 * 60 * 1000);
}

async function runCheck() {
    const now = new Date();
    state.lastCheck = Date.now();

    log.info(`[SNAPSHOT] Snapshot check at ${now.toISOString()}`);

    if (state.isRunning) {
        log.info('[SNAPSHOT] Previous check still running, skipping...');
        return;
    }

    // Check circuit breaker before hitting DB
    if (!shouldAllowRequest()) {
        log.info('[CIRCUIT-BREAKER] Circuit breaker OPEN -- skipping snapshot check');
        return;
    }

    try {
        state.isRunning = true;

        const check = await shouldTakeSnapshot();

        if (!check.should) {
            recordSuccess(); // DB was reachable even if no snapshot needed
            log.info(`[SNAPSHOT] ${check.reason}`);

            // Daily snapshot exists, but check if repo snapshots are missing
            const today = new Date().toISOString().split('T')[0];

            // ...and whether it is missing any column that current_metrics can now answer.
            // A metric that ships mid-day finds today's row already written, and this branch
            // is the only chance to record it -- shouldTakeSnapshot() will refuse the day
            // from here on, so without this the column stays NULL for that day forever and
            // has to be written by hand (unique_wallets needed exactly that, #201).
            // Only NULL columns are touched; a reading already taken is never restated.
            try {
                const metrics = await getCurrentMetrics();
                if (metrics) {
                    const patch = {};
                    for (const column of METRIC_COLUMNS) patch[column] = metrics[column];
                    const filled = await fillSnapshotNullColumns(today, patch);
                    if (filled.length > 0) {
                        log.info(`Filled ${filled.length} missing column(s) on today's snapshot: ${filled.join(', ')}`);
                    }
                }
            } catch (error) {
                // Never let a top-up failure affect the snapshot check itself.
                log.warn({ err: error }, "Could not top up NULL columns on today's snapshot");
            }

            const repoCount = await getRepoSnapshotCountByDate(today);
            if (repoCount === 0) {
                const repoCounts = getLatestRepoCounts();
                const repoKeyCount = repoCounts ? Object.keys(repoCounts).length : 0;
                if (repoKeyCount >= 10) {
                    const saved = await createRepoSnapshots(today, repoCounts);
                    log.info(`Repo snapshots missing - created: ${saved} Docker images tracked for ${today}`);
                    state.repoRetryCount = 0;
                } else if (repoKeyCount > 0) {
                    log.warn(`Repo snapshots missing - only ${repoKeyCount} images available (expected 10+), skipping`);
                } else {
                    scheduleRepoRetry('runCheck');
                }
            }

            return;
        }

        log.info(`[SNAPSHOT] ${check.reason} - taking snapshot...`);
        const result = await takeSnapshot();

        if (result.success) {
            recordSuccess();
        } else {
            log.error(`[SNAPSHOT] Snapshot failed: ${result.error}`);
            recordFailure();

            if (state.consecutiveFailures >= 3) {
                log.error(`[ALERT] ${state.consecutiveFailures} consecutive failures!`);
            }
        }

    } catch (error) {
        log.error({ err: error }, '[SNAPSHOT] Check error');
        state.consecutiveFailures++;
        recordFailure();
    } finally {
        state.isRunning = false;
    }
}

// ============================================
// PUBLIC API
// ============================================

export function startSnapshotChecker() {
    if (state.intervalId) {
        log.warn('[SNAPSHOT] Snapshot checker already running');
        return;
    }
    
    log.info('[SNAPSHOT] Starting snapshot checker...');
    log.info(`Check interval: ${CONFIG.CHECK_INTERVAL_MS / 1000 / 60} minutes`);
    log.info(`Grace period: ${CONFIG.GRACE_PERIOD_MINUTES} minutes after midnight`);
    
    // Run immediately on startup
    runCheck();
    
    // Then every 30 minutes
    state.intervalId = setInterval(runCheck, CONFIG.CHECK_INTERVAL_MS);
    
    log.info('[SNAPSHOT] Snapshot checker started');
}

export function stopSnapshotChecker() {
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }
    if (state.repoRetryId) {
        clearTimeout(state.repoRetryId);
        state.repoRetryId = null;
    }
    log.info('[SNAPSHOT] Snapshot checker stopped');
}

export async function takeManualSnapshot() {
    log.info('[SNAPSHOT] Manual snapshot triggered...');

    const check = await shouldTakeSnapshot();

    if (!check.should) {
        return {
            success: false,
            skipped: true,
            reason: check.reason
        };
    }

    return await takeSnapshot();
}

/**
 * Take a repo-only snapshot for today, independent of daily snapshot.
 * Useful for first-time population or testing.
 */
export async function takeRepoSnapshot() {
    const snapshotDate = new Date().toISOString().split('T')[0];
    const repoCounts = getLatestRepoCounts();
    const repoKeyCount = repoCounts ? Object.keys(repoCounts).length : 0;

    if (repoKeyCount === 0) {
        return {
            success: false,
            reason: 'No repo count data available yet - cloud stats may not have run'
        };
    }

    if (repoKeyCount < 10) {
        return {
            success: false,
            reason: `Only ${repoKeyCount} images available (expected 10+) - likely partial API data`
        };
    }

    const count = await createRepoSnapshots(snapshotDate, repoCounts);
    log.info(`Repo snapshot: ${count} unique Docker images tracked for ${snapshotDate}`);

    return {
        success: true,
        snapshotDate,
        repoCount: count
    };
}
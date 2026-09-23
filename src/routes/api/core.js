// Core, always-on endpoints: health checks, the consolidated header stats endpoint, and
// plain DB stats. Mounted at '/api' in server.js (these don't share a common sub-prefix).
import express from 'express';
import os from 'os';

import {
    getCurrentMetrics,
    getDatabaseStats,
    getLastNSnapshots,
    getSyncStatus,
    isDbReady,
    probeDb
} from '../../lib/db/database.js';

import { getCircuitState } from '../../lib/db/circuitBreaker.js';
import { getActiveInstanceName, getActiveInstanceSince } from '../../lib/db/supabaseClient.js';
import { APP_VERSION, SYNC_INTERVALS } from '../../lib/config.js';
import { summarizeHealth } from '../../lib/healthSummary.js';
import { getRevenueSyncSchedulerStatus } from '../../lib/services/revenueScheduler.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';
import { getSnapshotSystemStatus } from '../../lib/db/snapshotManager.js';
import { fetchCurrentBlockHeight, getLastGoodPrice } from '../../lib/services/revenueService.js';
import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { getHostLocation } from '../../lib/services/hostLocationService.js';
import { getArcaneCodename } from '../../lib/services/arcaneCodenameService.js';
import { getPriceHistoryStatus } from '../../lib/services/priceHistoryService.js';
import { getBackupStatus } from '../../lib/services/backupService.js';
import { getKpiSchedulerState } from '../../lib/services/kpiScheduler.js';

const router = express.Router();

// Above Header.svelte's 30s poll, deliberately (issue #221). At exactly 30s the entry
// expires just before the next poll arrives -- the timestamp is written AFTER the ~1.5-2s
// of handler work -- so roughly every second poll missed and paid the full fan-out. 90s
// means at most one miss per 90s however many people are watching, and the header's
// freshest fields (block height, uptime) move on a slower scale than that anyway.
const headerCache = createCache(90_000); // 90s

// Liveness probe — always 200 if process is running (Docker HEALTHCHECK target)
router.get('/health/live', (_req, res) => {
    res.json({ status: 'alive', timestamp: Date.now(), uptime: process.uptime() });
});

// Readiness probe — actively pings DB, 200 if reachable, 503 if not
router.get('/health/ready', async (_req, res) => {
    const reachable = await probeDb();
    const circuit = getCircuitState();
    const status = reachable ? 'ready' : 'degraded';
    const code = reachable ? 200 : 503;

    res.status(code).json({
        status,
        timestamp: Date.now(),
        db: {
            reachable,
            initialized: isDbReady(),
            circuit: circuit.state,
            failureCount: circuit.failureCount,
            activeInstance: getActiveInstanceName()
        }
    });
});

// Combined health check — honest about DB status
router.get('/health', async (req, res) => {
    const reachable = await probeDb();
    const circuit = getCircuitState();
    let snapshotInfo;
    try {
        const snapshotStatus = await getSnapshotSystemStatus();
        snapshotInfo = {
            healthy: snapshotStatus.isHealthy,
            todaySnapshotExists: snapshotStatus.todaySnapshotExists,
            consecutiveFailures: snapshotStatus.state.consecutiveFailures,
            lastCheck: snapshotStatus.state.lastCheck,
            lastSuccess: snapshotStatus.state.lastSuccess
        };
    } catch {
        snapshotInfo = { error: 'Unable to get snapshot status' };
    }

    const backupStatus = getBackupStatus();

    let priceHistoryInfo;
    try {
        priceHistoryInfo = await getPriceHistoryStatus();
    } catch {
        priceHistoryInfo = { error: 'Unable to get price history status' };
    }

    const cachedPrice = getLastGoodPrice();
    const livePriceInfo = cachedPrice
        ? {
            price: cachedPrice.price,
            ageMinutes: Math.round(cachedPrice.ageMs / 60000),
            // Past six hours the fallback stops being served, so a NULL-USD gap can reopen.
            fallbackUsable: cachedPrice.ageMs <= 6 * 60 * 60 * 1000
        }
        : { price: null, ageMinutes: null, fallbackUsable: false };

    // Issue #201. Reports whether the wallet count has ever been taken and how stale it is,
    // rather than whether it is non-zero -- the service refuses to write a 0, so "missing"
    // is the only failure shape there is.
    let walletsInfo;
    try {
        const walletSync = await getSyncStatus('wallets');
        const metrics = await getCurrentMetrics();
        const lastMs = walletSync?.last_sync ? Number(walletSync.last_sync) : null;
        walletsInfo = {
            uniqueWallets: metrics?.unique_wallets ?? null,
            uniqueAppOwners: metrics?.unique_app_owners ?? null,
            lastSyncStatus: walletSync?.status ?? null,
            ageHours: lastMs ? Math.round((Date.now() - lastMs) / 3600000) : null
        };
    } catch {
        walletsInfo = { error: 'Unable to get unique wallet status' };
    }

    // Revenue sync: the scheduler's in-memory lastRun, or -- after a restart, before its
    // first pass -- the stored receipt, but only if that receipt recorded a completion.
    let revenueSyncInfo;
    try {
        const scheduler = getRevenueSyncSchedulerStatus();
        const receipt = reachable ? await getSyncStatus('revenue') : null;
        const receiptMs = receipt?.status === 'completed' ? Number(receipt.last_sync) || null : null;
        revenueSyncInfo = {
            lastCompleted: Math.max(scheduler.lastRun ?? 0, receiptMs ?? 0) || null,
            consecutiveFailures: scheduler.consecutiveFailures
        };
    } catch {
        revenueSyncInfo = { lastCompleted: null, consecutiveFailures: 0, error: 'Unable to get revenue sync status' };
    }

    const activeInstance = getActiveInstanceName();
    const summary = summarizeHealth({
        dbReachable: reachable,
        activeInstance,
        backup: { enabled: backupStatus.enabled, isHealthy: backupStatus.isHealthy, partial: backupStatus.partial },
        snapshot: { healthy: snapshotInfo.healthy },
        priceHistory: { healthy: priceHistoryInfo.healthy },
        revenueSync: {
            lastSyncMs: revenueSyncInfo.lastCompleted,
            intervalMs: SYNC_INTERVALS.REVENUE,
            consecutiveFailures: revenueSyncInfo.consecutiveFailures
        }
    });

    // Overall verdict folds every sub-check in (issue #310): 503 only when the database is
    // down; `degraded` + `problems` otherwise. See healthSummary.js for why degraded is a 200.
    res.status(summary.httpStatus).json({
        status: summary.status,
        problems: summary.problems,
        timestamp: Date.now(),
        uptime: process.uptime(),
        db: {
            status: reachable ? 'connected' : 'unreachable',
            circuit: circuit.state,
            activeInstance,
            activeSince: getActiveInstanceSince()
        },
        revenueSync: revenueSyncInfo,
        snapshot: snapshotInfo,
        backup: {
            enabled: backupStatus.enabled,
            healthy: backupStatus.isHealthy,
            lastBackup: backupStatus.lastBackup,
            partial: backupStatus.partial,
            ageHours: backupStatus.ageHours
        },
        priceHistory: priceHistoryInfo,
        // Live price (issue #183): how old the last price this process actually fetched is.
        // When every source misses a pass, transactions are priced from this instead of
        // being stored NULL -- so its age is what says whether that safety net is still
        // valid. Without it, a price outage was only visible as missing cells in the
        // transaction log hours later.
        livePrice: livePriceInfo,
        kpiScheduler: getKpiSchedulerState(),
        uniqueWallets: walletsInfo
    });
});

// Consolidated header stats endpoint (replaces separate /api/health + /api/stats calls from header)
router.get('/header', async (req, res) => {
    return withDbFallback(headerCache, 'header', res, async () => {
        // getTxidCount() used to run here too (issue #221). It is the same exact count over
        // revenue_transactions that getDatabaseStats() already performs -- two full counts
        // of a 23k-row table per cache miss, for one number.
        const [metrics, stats, lastSnapshots, syncStatus, snapshotStatus, dbReachable, decentralizationStats] = await Promise.all([
            getCurrentMetrics(),
            getDatabaseStats(),
            getLastNSnapshots(1),
            getSyncStatus('revenue'),
            getSnapshotSystemStatus(),
            probeDb(),
            // Issue #120: header's live IPs counter. Rides getDecentralizationStats()'s own
            // in-memory cache (decentralizationService.js) -- no new fetch, no new endpoint.
            getDecentralizationStats().catch(() => null)
        ]);

        // Block height and ArcaneOS codename in parallel (external API calls).
        //
        // The codename lookup used to sit inline here as a bare fetch of the whole
        // network's fluxinfo document -- 3.76 MB, ~1.28s, parsed to pull one string that
        // changes about monthly, on every cache miss (issue #221). It now has its own
        // 6-hour cache with in-flight dedup, behind resilientFetch with a timeout and a
        // breaker like every other outbound GET in this repo.
        let blockHeight = null;
        let arcaneOsCodename = null;
        try {
            const [bh, codename] = await Promise.all([
                fetchCurrentBlockHeight().catch(() => null),
                getArcaneCodename().catch(() => null)
            ]);
            blockHeight = bh;
            arcaneOsCodename = codename;
        } catch (_) {}

        // Never blocks the header — resolves to null (or a stale value) on failure
        const hostLocation = await getHostLocation().catch(() => null);

        return {
            network: {
                fluxPriceUsd: metrics?.flux_price_usd || null,
                blockHeight,
                totalNodes: metrics?.node_total || 0,
                totalApps: metrics?.total_apps || 0,
                arcaneOsCodename,
                // Issue #120: unique-IP classification progress, shown next to uptime in
                // Header.svelte's Row 2. Deliberately a different denominator than totalNodes
                // above (node-instance count) -- see decentralizationService.js's own comment
                // on classifiedCount/totalNodes and the card's tooltip that explains the split.
                decentralizationCoverage: {
                    classified: decentralizationStats?.classifiedCount ?? 0,
                    total: decentralizationStats?.totalNodes ?? 0
                }
            },
            tracker: {
                uptime: process.uptime(),
                snapshots: stats?.snapshots || 0,
                lastSnapshotDate: lastSnapshots?.[0]?.snapshot_date || null,
                snapshotHealthy: snapshotStatus?.isHealthy ?? true,
                transactions: stats?.transactions || 0,
                lastSyncBlock: syncStatus?.last_sync_block || null
            },
            host: {
                platform: os.platform(),
                nodeVersion: process.version,
                cpuCores: os.cpus().length,
                totalMemMB: Math.round(os.totalmem() / 1048576),
                usedMemMB: Math.round((os.totalmem() - os.freemem()) / 1048576),
                memPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
                // Where this instance is running. On Flux the app moves between nodes, so
                // this changes on redeploy. Cached for 6h and null if the lookup fails.
                location: hostLocation
                    ? {
                        city: hostLocation.city,
                        region: hostLocation.region,
                        country: hostLocation.country,
                        countryCode: hostLocation.countryCode
                    }
                    : null
            },
            appVersion: APP_VERSION,
            dbStatus: dbReachable ? 'online' : 'offline'
        };
    });
});

// Database stats
router.get('/stats', async (req, res) => {
    try {
        const stats = await getDatabaseStats();

        // Get the last snapshot date
        const lastSnapshot = await getLastNSnapshots(1);
        const lastSnapshotDate = lastSnapshot.length > 0 ? lastSnapshot[0].snapshot_date : null;

        res.json({
            ...stats,
            lastSnapshotDate
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

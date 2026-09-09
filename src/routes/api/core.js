// Core, always-on endpoints: health checks, the consolidated header stats endpoint, and
// plain DB stats. Mounted at '/api' in server.js (these don't share a common sub-prefix).
import express from 'express';
import os from 'os';

import {
    getCurrentMetrics,
    getDatabaseStats,
    getLastNSnapshots,
    getSyncStatus,
    getTxidCount,
    isDbReady,
    probeDb
} from '../../lib/db/database.js';

import { getCircuitState } from '../../lib/db/circuitBreaker.js';
import { getActiveInstanceName } from '../../lib/db/supabaseClient.js';
import { API_ENDPOINTS, APP_VERSION } from '../../lib/config.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';
import { getSnapshotSystemStatus } from '../../lib/db/snapshotManager.js';
import { fetchCurrentBlockHeight } from '../../lib/services/revenueService.js';
import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { getHostLocation } from '../../lib/services/hostLocationService.js';
import { getPriceHistoryStatus } from '../../lib/services/priceHistoryService.js';
import { getBackupStatus } from '../../lib/services/backupService.js';
import { getKpiSchedulerState } from '../../lib/services/kpiScheduler.js';

const router = express.Router();

const headerCache = createCache(30_000); // 30s

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

    res.json({
        status: reachable ? 'ok' : 'degraded',
        timestamp: Date.now(),
        uptime: process.uptime(),
        db: {
            status: reachable ? 'connected' : 'unreachable',
            circuit: circuit.state,
            activeInstance: getActiveInstanceName()
        },
        snapshot: snapshotInfo,
        backup: {
            enabled: backupStatus.enabled,
            healthy: backupStatus.isHealthy,
            lastBackup: backupStatus.lastBackup,
            ageHours: backupStatus.ageHours
        },
        priceHistory: priceHistoryInfo,
        kpiScheduler: getKpiSchedulerState()
    });
});

// Consolidated header stats endpoint (replaces separate /api/health + /api/stats calls from header)
router.get('/header', async (req, res) => {
    return withDbFallback(headerCache, 'header', res, async () => {
        const [metrics, stats, lastSnapshots, syncStatus, txCount, snapshotStatus, dbReachable, decentralizationStats] = await Promise.all([
            getCurrentMetrics(),
            getDatabaseStats(),
            getLastNSnapshots(1),
            getSyncStatus('revenue'),
            getTxidCount(),
            getSnapshotSystemStatus(),
            probeDb(),
            // Issue #120: header's live IPs counter. Rides getDecentralizationStats()'s own
            // in-memory cache (decentralizationService.js) -- no new fetch, no new endpoint.
            getDecentralizationStats().catch(() => null)
        ]);

        // Fetch block height and ArcaneOS codename in parallel (external API calls)
        let blockHeight = null;
        let arcaneOsCodename = null;
        try {
            const [bh, codename] = await Promise.all([
                fetchCurrentBlockHeight().catch(() => null),
                fetch(API_ENDPOINTS.FLUXINFO)
                    .then(r => r.json())
                    .then(data => {
                        const node = data?.data?.find(n => n?.flux?.arcaneHumanVersion);
                        return node?.flux?.arcaneHumanVersion || null;
                    })
                    .catch(() => null)
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
                transactions: txCount || 0,
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

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { CSP_DIRECTIVES } from './lib/security/contentSecurityPolicy.js';
import {
    getCurrentMetrics,
    getLastNSnapshots,
    getSnapshotsInRange,
    getSnapshotByDate,
    getTransactionsByDate,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getRevenueFromAddressesForDateRange,
    getDatabaseStats,
    getTxidCount,
    getTransactionsPaginated,
    getAppAnalytics,
    getDailyRevenueFromTransactions,
    getDailyRevenueInRange,
    getDailyRevenueUSDFromTransactions,
    getDailyRevenueUSDInRange,
    resetRevenueSyncBlock,
    getSyncStatus,
    clearRevenueData,
    getDistinctRepos,
    getRepoHistory,
    getLatestRepoSnapshot,
    createRepoSnapshots,
    getTopReposByCategory,
    getCategoryTotal,
    getCategoryHistory,
    getReposByCategory,
    backfillRepoCategories,
    recategorizeAllRepos,
    ensureInitialized,
    isDbReady,
    probeDb,
    getDecentralizationSnapshotHistory
} from './lib/db/database.js';

import { shouldAllowRequest, recordSuccess, recordFailure, getCircuitState } from './lib/db/circuitBreaker.js';
import { switchToFailover, getActiveInstanceName, hasFailover } from './lib/db/supabaseClient.js';

import { getDisplayName, groupReposByCanonicalName, categorizeImage, CATEGORY_CONFIG, APP_VERSION, API_ENDPOINTS, FLUX_TEAM_ADDRESSES } from './lib/config.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('server');

// Import the NEW snapshot manager
import {
    startSnapshotChecker,
    stopSnapshotChecker,
    getSnapshotSystemStatus,
    takeManualSnapshot,
    takeRepoSnapshot
} from './lib/db/snapshotManager.js';

// Import the revenue scheduler (wraps your existing revenueService.js)
import {
    startRevenueSync,
    stopRevenueSync,
    getRevenueSyncSchedulerStatus
} from './lib/services/revenueScheduler.js';

// Import revenue service for manual trigger
import {
    fetchRevenueStats,
    calculateMonthlyRevenue,
    calculatePreviousMonthRevenue,
    getMonthlyPaymentCount,
    getPreviousMonthPaymentCount,
    calculateYesterdayRevenue,
    getYesterdayPaymentCount,
    clearPermanentlyFailedTxids,
    backfillAppTypes,
    backfillAppNames,
    auditRecentTransactions,
    getRevenueSyncState,
    fetchCurrentBlockHeight
} from './lib/services/revenueService.js';

// Import testAllServices
import { startServiceTests, getServiceTestSchedulerStatus, startCarouselUpdates,stopCarouselUpdates, getCarouselSchedulerStatus, startDecentralizationUpdates, stopDecentralizationUpdates, getDecentralizationSchedulerStatus } from './lib/services/servicesScheduler.js';
import { getDecentralizationStats } from './lib/services/decentralizationService.js';
import { testAllServices } from './lib/services/test-allServices.js';

// Import backfill functions
import { backfillRevenueSnapshots } from './lib/db/run-backfill.js';
import { backfillNullUsdAmounts, getPriceHistoryStatus, syncPriceHistory } from './lib/services/priceHistoryService.js';

import { fetchCarouselData, getCachedCarouselData, getCachedDeployedApps, getCachedExpiringApps, getFluxCloudActivity } from './lib/services/carouselService.js';
import { getBusiestNode } from './lib/services/busiestNodeService.js';
import { getHostLocation, getHostLocationError } from './lib/services/hostLocationService.js';
import { buildKpiReport, sendToDiscord, isValidDiscordWebhook } from './lib/services/kpiService.js';
import { startKpiScheduler, stopKpiScheduler, getKpiSchedulerState } from './lib/services/kpiScheduler.js';
import { TIMEFRAMES } from './lib/kpi/periods.js';
import { consumeRateLimit, refundTarget, LIMITS } from './lib/kpi/rateLimiter.js';

import { isBackupEnabled, getBackupStatus, performBackup, listBackups, restoreFromBackup } from './lib/services/backupService.js';

import os from 'os';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// RESPONSE CACHE — stale-while-revalidate
// ============================================
function createCache(ttlMs) {
    const store = new Map();
    return {
        get(key) {
            const entry = store.get(key);
            if (entry && Date.now() - entry.time < ttlMs) return entry.data;
            return null;
        },
        getStale(key) {
            const entry = store.get(key);
            return entry ? entry.data : null;
        },
        set(key, data) {
            store.set(key, { data, time: Date.now() });
        }
    };
}

// ============================================
// CATEGORY GROUPING
// ============================================
// repo_snapshots stores one row per Docker image, but a game usually ships as several
// images (Minecraft Java + Bedrock, three Valheim images, two Rust images). Users think
// of those as one game, so the category cards group on the canonical name. Pull the whole
// category before grouping — slicing first would drop instances from the merged totals.
const CATEGORY_FETCH_LIMIT = 200;

// Largest page /api/transactions/paginated will serve. The CSV export pages at this size.
const MAX_PAGE_SIZE = 5000;

const headerCache = createCache(30_000);      // 30s
const metricsCache = createCache(60_000);     // 60s
const revenueCache = createCache(300_000);    // 5 min
const analyticsCache = createCache(300_000);  // 5 min
const categoryCache = createCache(300_000);   // 5 min

// ============================================
// DB FALLBACK HELPER — circuit breaker + stale cache
// ============================================
async function withDbFallback(cache, cacheKey, res, fetchFn) {
    // 1. Return fresh cache if available
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // 2. If circuit is open, return stale cache or 503
    if (!shouldAllowRequest()) {
        const stale = cache.getStale(cacheKey);
        if (stale) return res.status(503).json({ ...stale, _stale: true, _circuitOpen: true });
        return res.status(503).json({ error: 'Database unavailable', _circuitOpen: true });
    }

    // 3. Fetch from DB
    try {
        const data = await fetchFn();
        recordSuccess();
        cache.set(cacheKey, data);
        return res.json(data);
    } catch (error) {
        recordFailure();
        const stale = cache.getStale(cacheKey);
        if (stale) return res.status(503).json({ ...stale, _stale: true });
        return res.status(503).json({ error: error.message });
    }
}

// ============================================
// LOGGING CONFIGURATION
// ============================================
const LOGGING_CONFIG = {
    enableRequestLogging: true,           // Master switch for request logging
    logHealthChecks: false,               // Don't spam logs with health checks
    logStatsEndpoints: false,             // Don't log /api/stats calls
    logMetricsEndpoints: false,           // Don't log /api/metrics/current calls
    logComparisonEndpoints: false,        // Don't log /api/analytics/comparison calls
    logHistoryEndpoints: true,            // Log history endpoint calls
    logAdminEndpoints: true,              // Always log admin actions
    logErrorsOnly: false,                 // Only log errors (overrides above)
};

// ============================================
// CORS CONFIGURATION - CRITICAL FOR DOMAIN ACCESS
// ============================================
// Dev origins ship as an in-code default so local development works with zero setup.
// Production IPs/domains are never committed to source (this is a public repo) -- they
// come from CORS_ALLOWED_ORIGINS, a comma-separated env var, so each deployment supplies
// its own without touching code. See issue #121.
const DEV_ORIGINS = [
    'http://localhost:5173',   // Development
    'http://localhost:37000',  // Development (if using port 37000 locally)
    'http://127.0.0.1:5173'    // Development
];

function parseAllowedOrigins(envValue) {
    if (!envValue) return [];
    return envValue.split(',').map(origin => origin.trim()).filter(Boolean);
}

const productionOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
if (productionOrigins.length === 0) {
    console.warn('[CORS] CORS_ALLOWED_ORIGINS is not set — only local dev origins are allowed. Set it in production (see .env.example).');
}

const corsOptions = {
    origin: [...DEV_ORIGINS, ...productionOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600 // Cache preflight requests for 10 minutes
};

// ============================================
// SECURITY HEADERS (helmet) - issue #125
// ============================================
// This secures the Express API's own JSON responses. It does NOT reach the actual dashboard
// pages the browser renders -- those are served by the separate SvelteKit/adapter-node
// process (see README's "Two processes are required" note), which sets the same policy by
// hand in hooks.server.js since that process has no Express/helmet to hook into. Both pull
// CSP_DIRECTIVES from the same shared module so the two can't drift apart.
app.use(helmet({
    contentSecurityPolicy: { directives: CSP_DIRECTIVES }
}));

// Apply CORS middleware
app.use(cors(corsOptions));

// Add OPTIONS handler for preflight requests
app.options('{*path}', cors(corsOptions));

// Middleware
app.use(express.json());

// Smart request logging with filters
app.use((req, res, next) => {
    if (!LOGGING_CONFIG.enableRequestLogging) {
        return next();
    }

    // Skip logging based on configuration
    const path = req.path.toLowerCase();

    if (LOGGING_CONFIG.logErrorsOnly) {
        // Only log on response if there's an error
        const originalSend = res.send;
        res.send = function(data) {
            if (res.statusCode >= 400) {
                log.info({ method: req.method, path: req.path, status: res.statusCode }, 'request error');
            }
            return originalSend.call(this, data);
        };
        return next();
    }

    // Skip specific endpoints based on config
    if (!LOGGING_CONFIG.logHealthChecks && (path.includes('/health') || path.includes('/header'))) return next();
    if (!LOGGING_CONFIG.logStatsEndpoints && path.includes('/stats')) return next();
    if (!LOGGING_CONFIG.logMetricsEndpoints && path.includes('/metrics')) return next();
    if (!LOGGING_CONFIG.logComparisonEndpoints && path.includes('/comparison')) return next();

    // Log the request
    log.info({ method: req.method, path: req.path }, 'request');
    next();
});

// Liveness probe — always 200 if process is running (Docker HEALTHCHECK target)
app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'alive', timestamp: Date.now(), uptime: process.uptime() });
});

// Readiness probe — actively pings DB, 200 if reachable, 503 if not
app.get('/api/health/ready', async (_req, res) => {
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
app.get('/api/health', async (req, res) => {
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
app.get('/api/header', async (req, res) => {
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

// NEW: Snapshot system status endpoint
app.get('/api/admin/snapshot-status', async (req, res) => {
    try {
        const status = await getSnapshotSystemStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Manual revenue sync trigger endpoint
app.post('/api/admin/revenue-sync', async (req, res) => {
    try {
        log.info('manual revenue sync triggered via API');

        // Trigger the revenue sync
        await fetchRevenueStats();

        // Get transaction count after sync
        const txCount = await getTxidCount();

        res.json({
            success: true,
            message: 'Revenue sync completed',
            transactionCount: txCount
        });
    } catch (error) {
        log.error({ err: error }, 'manual revenue sync failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear all revenue data and reset sync — triggers a full resync on next cycle
app.post('/api/admin/clear-revenue-data', async (req, res) => {
    try {
        const deleted = await clearRevenueData();
        log.info({ deleted }, 'cleared revenue transactions — full resync will run on next cycle');
        res.json({ success: true, deleted, message: `Cleared ${deleted} transactions. Resync will start on next cycle.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset revenue sync block to trigger full history re-scan from genesis on next sync
app.post('/api/admin/reset-revenue-sync', async (req, res) => {
    try {
        await resetRevenueSyncBlock();
        const verified = await getSyncStatus('revenue');
        const didReset = verified?.last_sync_block === null;
        log.info({ lastSyncBlock: verified?.last_sync_block }, 'revenue sync block reset');
        res.json({
            success: didReset,
            last_sync_block: verified?.last_sync_block ?? null,
            message: didReset
                ? 'Reset successful. Full history scan from block 0 will run on next sync cycle.'
                : 'Reset may not have applied — last_sync_block is still set.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Backfill app_type (git/docker) for existing transactions
app.post('/api/admin/backfill-app-types', async (req, res) => {
    try {
        log.info('app_type backfill triggered via API');
        const result = await backfillAppTypes();
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'app_type backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Backfill app_name for transactions where it is NULL (re-fetches raw txs to extract OP_RETURN hash)
app.post('/api/admin/backfill-app-names', async (req, res) => {
    try {
        const batchSize = Math.min(parseInt(req.body?.batchSize) || 500, 2000);
        log.info({ batchSize }, 'app_name backfill triggered via API');
        const result = await backfillAppNames(batchSize);
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'app_name backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Audit recent transactions for missed entries
app.post('/api/admin/audit-transactions', async (req, res) => {
    try {
        log.info('transaction audit triggered via API');
        const result = await auditRecentTransactions();
        res.json(result);
    } catch (error) {
        log.error({ err: error }, 'transaction audit failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Backfill USD amounts for transactions that have NULL amount_usd using historical prices
app.post('/api/admin/backfill-usd', async (req, res) => {
    try {
        log.info('USD backfill triggered via API');
        const result = await backfillNullUsdAmounts();
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'USD backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// KPI REPORT
// ============================================

/** Never log a full webhook URL — it is a bearer credential. */
function maskWebhook(url) {
    const match = /webhooks\/(\d+)\//.exec(url || '');
    return match ? `webhook:${match[1]}` : 'webhook:unknown';
}

function clientKeyFor(req) {
    // trust proxy is not enabled, so req.ip is the direct peer. X-Forwarded-For is taken as
    // a hint only — it is spoofable, so it narrows abuse but is not a security boundary.
    const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * GET /api/kpi/availability
 * Which timeframes can actually be reported on right now, so the modal can disable the
 * rest up front instead of failing after submit. The same check runs on POST.
 */
app.get('/api/kpi/availability', async (_req, res) => {
    try {
        const results = await Promise.all(TIMEFRAMES.map(async timeframe => {
            const report = await buildKpiReport(timeframe);
            const { dataset } = report;
            return {
                timeframe,
                available: !dataset.empty,
                currentLabel: report.currentLabel,
                comparisonLabel: report.comparisonLabel,
                current: report.current,
                comparison: report.comparison,
                availableMetrics: dataset.availableMetrics,
                totalMetrics: dataset.totalMetrics
            };
        }));
        res.json({ timeframes: results, limits: LIMITS });
    } catch (error) {
        log.error({ err: error }, 'KPI availability check failed');
        res.status(500).json({ error: 'Could not check KPI availability' });
    }
});

/**
 * GET /api/kpi/preview?timeframe=weekly
 * The computed numbers, without sending anything. Powers the in-modal preview.
 */
app.get('/api/kpi/preview', async (req, res) => {
    const timeframe = String(req.query.timeframe || '').toLowerCase();

    if (!TIMEFRAMES.includes(timeframe)) {
        return res.status(400).json({ error: `timeframe must be one of: ${TIMEFRAMES.join(', ')}` });
    }

    try {
        const report = await buildKpiReport(timeframe);
        res.json(report);
    } catch (error) {
        log.error({ err: error, timeframe }, 'KPI preview failed');
        res.status(500).json({ error: 'Could not build the KPI report' });
    }
});

/**
 * POST /api/kpi-report
 * body: { timeframe, medium: 'discord', target: '<webhook url>' }
 */
app.post('/api/kpi-report', async (req, res) => {
    const { timeframe, medium, target, website } = req.body || {};

    // Honeypot: a real browser leaves this hidden field empty
    if (website) {
        log.warn({ client: clientKeyFor(req) }, 'KPI honeypot triggered');
        return res.status(400).json({ error: 'Request rejected.' });
    }

    if (!TIMEFRAMES.includes(timeframe)) {
        return res.status(400).json({ error: `timeframe must be one of: ${TIMEFRAMES.join(', ')}` });
    }

    if (medium !== 'discord') {
        // Email delivery is designed for but not yet configured — see README.
        return res.status(400).json({ error: 'Only Discord delivery is available right now.' });
    }

    if (!isValidDiscordWebhook(target)) {
        return res.status(400).json({
            error: 'Enter a valid Discord webhook URL (https://discord.com/api/webhooks/...).'
        });
    }

    const clientKey = clientKeyFor(req);
    const targetKey = `discord:${target.trim()}`;

    // Claimed up front, not after the send: checking here and recording after the outbound
    // POST left a window where two parallel requests both passed before either was counted.
    const limit = consumeRateLimit(clientKey, targetKey);
    if (!limit.allowed) {
        res.set('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: limit.reason, retryAfterSeconds: limit.retryAfterSeconds });
    }

    try {
        const report = await buildKpiReport(timeframe);

        if (report.dataset.empty) {
            // Nothing was delivered, so the destination keeps its slot
            refundTarget(targetKey);
            return res.status(422).json({
                error: `Not enough historical data for a ${timeframe} report yet ` +
                       `(${report.currentLabel} vs ${report.comparisonLabel}). Choose a shorter timeframe.`,
                insufficientData: true
            });
        }

        const result = await sendToDiscord(target.trim(), report);

        const incomplete = report.dataset.totalMetrics - report.dataset.availableMetrics;
        log.info(
            { timeframe, medium, target: maskWebhook(target), incomplete, activityDelivered: result.activityDelivered !== false },
            'KPI report delivered'
        );

        res.json({
            success: true,
            timeframe,
            currentLabel: report.currentLabel,
            comparisonLabel: report.comparisonLabel,
            metricsReported: report.dataset.availableMetrics,
            metricsTotal: report.dataset.totalMetrics,
            // The daily report is two messages (report + Flux Cloud Activity); a failure
            // of the second one is surfaced as a warning rather than an error, because
            // the main report did arrive and a retry would duplicate it.
            activityDelivered: result.activityDelivered !== false,
            ...(result.activityError ? { warning: `The main report was delivered, but the Flux Cloud Activity message failed: ${result.activityError}` } : {})
        });

    } catch (error) {
        // The report never arrived, so don't hold the destination's slot against it — a
        // mistyped webhook should be correctable straight away, not in five minutes.
        refundTarget(targetKey);
        log.error({ err: error, timeframe, target: maskWebhook(target) }, 'KPI report failed');
        // sendToDiscord throws user-safe messages; anything else stays generic
        res.status(502).json({ error: error.message || 'Could not send the KPI report.' });
    }
});

// Where this server thinks it is running, and how it worked that out.
// The lookup is made by the Node process, so the reported IP is the server's own public
// egress address — never the viewer's. Use this to confirm the header on a Flux node.
app.get('/api/admin/host-location', async (_req, res) => {
    try {
        const location = await getHostLocation();
        res.json({
            location,
            resolvedFrom: 'server-side lookup (the Node process calls the geo API, not the browser)',
            error: getHostLocationError(),
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Price history coverage — read-only diagnostic for "why is USD revenue empty?"
app.get('/api/admin/price-history-status', async (_req, res) => {
    try {
        res.json(await getPriceHistoryStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Force a gap-filling price history sync, bypassing the failed-source cooldown
app.post('/api/admin/sync-price-history', async (_req, res) => {
    try {
        log.info('Price history sync triggered via API');
        const result = await syncPriceHistory({ force: true });
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'Price history sync failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revenue sync status endpoint (used by footer)
app.get('/api/admin/revenue-status', async (req, res) => {
    try {
        const schedulerStatus = getRevenueSyncSchedulerStatus();
        const syncState = getRevenueSyncState();
        const txCount = await getTxidCount();
        const syncStatus = await getSyncStatus('revenue');

        // Fetch current block height (cached internally, fast)
        let currentBlock = null;
        try {
            currentBlock = await fetchCurrentBlockHeight();
        } catch (_) { /* non-critical */ }

        res.json({
            ...schedulerStatus,
            transactionCount: txCount,
            lastSyncBlock: syncStatus?.last_sync_block || null,
            currentBlock,
            isSyncing: syncState.isRunning,
            lastCompleted: syncState.lastCompleted
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/revenue/:period
 * Returns revenue for the specified period with comparison to previous period
 * Periods: daily, weekly, monthly, quarterly, yearly
 */
app.get('/api/revenue/:period', async (req, res) => {
    try {
        const period = req.params.period.toLowerCase();
        const currentMetrics = await getCurrentMetrics();
        const fluxPrice = currentMetrics?.flux_price_usd || 0;

        let currentRevenue, currentPayments, previousRevenue, previousPayments;
        let currentStart, currentEnd, previousStart, previousEnd;

        const now = new Date();

        switch(period) {
            case 'daily':
                // Today
                currentStart = currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Yesterday
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                previousStart = previousEnd = yesterday.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'weekly':
                // This week (Monday to Sunday)
                const currentWeekStart = new Date(now);
                const dayOfWeek = currentWeekStart.getDay();
                const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust Sunday (0) to be 6 days from Monday
                currentWeekStart.setDate(currentWeekStart.getDate() - daysToMonday);
                currentStart = currentWeekStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last week (Monday to Sunday)
                const lastWeekStart = new Date(currentWeekStart);
                lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                previousStart = lastWeekStart.toISOString().split('T')[0];
                const lastWeekEnd = new Date(lastWeekStart);
                lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
                previousEnd = lastWeekEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'monthly':
                // This month
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                currentStart = firstDayOfMonth.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last month
                const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                previousStart = firstDayOfLastMonth.toISOString().split('T')[0];
                const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
                previousEnd = lastDayOfLastMonth.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'quarterly':
                // This quarter
                const currentQuarter = Math.floor(now.getMonth() / 3);
                const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
                currentStart = quarterStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last quarter
                const lastQuarterStart = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
                if (currentQuarter === 0) {
                    // If Q1, go to Q4 of last year
                    lastQuarterStart.setFullYear(now.getFullYear() - 1);
                    lastQuarterStart.setMonth(9); // October (Q4 starts)
                }
                previousStart = lastQuarterStart.toISOString().split('T')[0];
                const lastQuarterEnd = new Date(lastQuarterStart.getFullYear(), lastQuarterStart.getMonth() + 3, 0);
                previousEnd = lastQuarterEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'yearly':
                // This year
                const yearStart = new Date(now.getFullYear(), 0, 1);
                currentStart = yearStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last year
                const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
                previousStart = lastYearStart.toISOString().split('T')[0];
                const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
                previousEnd = lastYearEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            default:
                return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly, quarterly, or yearly' });
        }

        // Calculate change percentage
        let changePercent = 0;
        let trend = 'neutral';

        if (previousRevenue > 0) {
            changePercent = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
            trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';
        }

        const currentUsd = currentRevenue * fluxPrice;

        // Self-funded share: revenue paid by Flux team addresses. Reported alongside the
        // headline total, never subtracted from it — the total stays the primary number.
        const selfFunded = await getRevenueFromAddressesForDateRange(
            currentStart, currentEnd, FLUX_TEAM_ADDRESSES
        );
        const selfFundedPercent = currentRevenue > 0
            ? (selfFunded.revenue / currentRevenue) * 100
            : 0;

        res.json({
            period: period,
            current: {
                start: currentStart,
                end: currentEnd,
                revenue: currentRevenue,
                payments: currentPayments,
                usd: currentUsd
            },
            previous: {
                start: previousStart,
                end: previousEnd,
                revenue: previousRevenue,
                payments: previousPayments
            },
            comparison: {
                change: changePercent,
                trend: trend
            },
            // Formatted for frontend
            payments: {
                count: currentPayments,
                previous: previousPayments
            },
            usd: {
                amount: currentUsd
            },
            flux: {
                amount: currentRevenue,
                previous: previousRevenue,
                change: changePercent,
                trend: trend
            },
            selfFunded: {
                flux: selfFunded.revenue,
                usd: selfFunded.revenue * fluxPrice,
                payments: selfFunded.payments,
                percent: Math.round(selfFundedPercent * 10) / 10
            },
            timestamp: Date.now()
        });

    } catch (error) {
        log.error({ err: error, period: req.params.period }, 'revenue endpoint error');
        res.status(500).json({
            error: 'Failed to fetch revenue',
            details: error.message
        });
    }
});


// NEW: Manual test services trigger endpoint
app.post('/api/admin/test-services', async (req, res) => {
    try {
        log.info('manual test services triggered via API');

        // Check if tests are already running
        const status = getServiceTestSchedulerStatus();

        if (status.isTestInProgress) {
            log.warn('tests already in progress, skipping');
            return res.json({
                success: false,
                alreadyRunning: true,
                message: 'Tests are already running',
                status
            });
        }

        // Trigger the test services, revenue sync, and carousel update in parallel
        await Promise.all([
            testAllServices(),
            fetchRevenueStats(),
            fetchCarouselData()
        ]);

        res.json({
            success: true,
            message: 'All services tested and revenue synced successfully',
            status: getServiceTestSchedulerStatus()
        });
    } catch (error) {
        log.error({ err: error }, 'manual test services failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// NEW: Test services status endpoint
app.get('/api/admin/test-status', (req, res) => {
    try {
        const status = getServiceTestSchedulerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// NEW: Backfill snapshots endpoint
app.post('/api/admin/backfill', async (req, res) => {
    try {
        log.info('backfill triggered via API');

        // Calculate dynamic date range
        const toDate = new Date();
        toDate.setDate(toDate.getDate() - 1); // Yesterday
        const toDateStr = toDate.toISOString().split('T')[0];

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 365); // 365 days ago
        const fromDateStr = fromDate.toISOString().split('T')[0];

        log.info({ from: fromDateStr, to: toDateStr }, 'backfilling date range');

        // Run the backfill
        const result = await backfillRevenueSnapshots(fromDateStr, toDateStr);

        log.info({ created: result.created, skipped: result.skipped }, 'backfill complete');

        res.json({
            success: true,
            message: 'Backfill completed successfully',
            created: result.created,
            skipped: result.skipped,
            dateRange: {
                from: fromDateStr,
                to: toDateStr
            }
        });
    } catch (error) {
        log.error({ err: error }, 'backfill failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Database stats
app.get('/api/stats', async (req, res) => {
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

// Current metrics
app.get('/api/metrics/current', async (req, res) => {
    return withDbFallback(metricsCache, 'current', res, async () => {
        const metrics = await getCurrentMetrics();
        if (!metrics) throw new Error('No metrics found');

        const today = new Date().toISOString().split('T')[0];
        const paymentCount = await getPaymentCountForDateRange(today, today);

        return {
            lastUpdate: metrics.last_update,
            revenue: {
                current: metrics.current_revenue,
                fluxPriceUsd: metrics.flux_price_usd,
                usdValue: metrics.flux_price_usd ? metrics.current_revenue * metrics.flux_price_usd : null,
                paymentCount: paymentCount
            },
            cloud: {
                cpu: { total: metrics.total_cpu_cores, used: metrics.used_cpu_cores, utilization: metrics.cpu_utilization_percent },
                ram: { total: metrics.total_ram_gb, used: metrics.used_ram_gb, utilization: metrics.ram_utilization_percent },
                storage: { total: metrics.total_storage_gb, used: metrics.used_storage_gb, utilization: metrics.storage_utilization_percent }
            },
            apps: {
                total: metrics.total_apps,
                watchtower: metrics.watchtower_count,
                gitapps: metrics.gitapps_count || 0,
                dockerapps: metrics.dockerapps_count || 0,
                gitapps_percent: metrics.gitapps_percent || 0,
                dockerapps_percent: metrics.dockerapps_percent || 0
            },
            gaming: { total: metrics.gaming_apps_total, palworld: metrics.gaming_palworld, enshrouded: metrics.gaming_enshrouded, minecraft: metrics.gaming_minecraft },
            crypto: { total: metrics.crypto_nodes_total, presearch: metrics.crypto_presearch, kaspa: metrics.crypto_kaspa, alephium: metrics.crypto_alephium },
            wordpress: { count: metrics.wordpress_count },
            nodes: { cumulus: metrics.node_cumulus, nimbus: metrics.node_nimbus, stratus: metrics.node_stratus, total: metrics.node_total }
        };
    });
});

// Enhanced endpoint with full snapshot data for charts
app.get('/api/history/snapshots/full', async (req, res) => {
    try {
        const { limit, start_date, end_date } = req.query;

        // Get snapshots using existing function
        const snapshots = (start_date && end_date)
            ? await getSnapshotsInRange(start_date, end_date)
            : await getLastNSnapshots(parseInt(limit) || 30);

        // Return FULL snapshot data (not summarized)
        res.json({
            count: snapshots.length,
            data: snapshots
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Endpoint to get daily revenue from transactions (not snapshots)
app.get('/api/history/revenue/daily', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `daily:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const revenueData = (start_date && end_date)
            ? await getDailyRevenueInRange(start_date, end_date)
            : await getDailyRevenueFromTransactions(parseInt(limit) || 30);
        return { count: revenueData.length, data: revenueData };
    });
});

// Endpoint to get daily revenue in USD from transactions
app.get('/api/history/revenue/daily-usd', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `daily-usd:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const revenueData = (start_date && end_date)
            ? await getDailyRevenueUSDInRange(start_date, end_date)
            : await getDailyRevenueUSDFromTransactions(parseInt(limit) || 30);
        return { count: revenueData.length, data: revenueData };
    });
});

// Historical snapshots
app.get('/api/history/snapshots', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `snapshots:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const snapshots = (start_date && end_date)
            ? await getSnapshotsInRange(start_date, end_date)
            : await getLastNSnapshots(parseInt(limit) || 30);

        return {
            count: snapshots.length,
            data: snapshots.map(s => ({
                date: s.snapshot_date,
                revenue: s.daily_revenue,
                nodes: { total: s.node_total, cumulus: s.node_cumulus, nimbus: s.node_nimbus },
                apps: {
                    total: s.total_apps,
                    gaming: s.gaming_apps_total,
                    crypto: s.crypto_nodes_total,
                    gitapps: s.gitapps_count || 0,
                    dockerapps: s.dockerapps_count || 0
                }
            }))
        };
    });
});

// Docker repo history endpoints
app.get('/api/history/repos/list', async (req, res) => {
    try {
        const repos = await getDistinctRepos();
        res.json({ count: repos.length, data: repos });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history/repos/history', async (req, res) => {
    try {
        const { image, limit } = req.query;
        if (!image) {
            return res.status(400).json({ error: 'image query parameter is required' });
        }
        const history = await getRepoHistory(image, parseInt(limit) || 90);
        res.json({ count: history.length, data: history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history/repos/latest', async (req, res) => {
    try {
        const repos = await getLatestRepoSnapshot();
        res.json({ count: repos.length, data: repos });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CATEGORY-BASED ENDPOINTS (from repo_snapshots)
// ============================================

// Top repos for a category (used by CategoryCard)
app.get('/api/metrics/category/:category/top', async (req, res) => {
    const { category } = req.params;
    const limit = parseInt(req.query.limit) || 3;
    const days = parseInt(req.query.days) || 7;

    if (!CATEGORY_CONFIG[category]) {
        return res.status(400).json({ error: `Unknown category: ${category}` });
    }

    const cacheKey = `${category}:${limit}:${days}`;

    return withDbFallback(categoryCache, cacheKey, res, async () => {
        // Pull the whole category, not just `limit` rows: variants of one game (Minecraft
        // Java + Bedrock, the several Valheim/Rust images) are separate rows here and get
        // merged below, so slicing before grouping would drop instances from the totals.
        const { date, repos: storedRepos } = await getTopReposByCategory(category, CATEGORY_FETCH_LIMIT);
        if (!date) {
            return { category, date: null, total: 0, previousTotal: 0, repos: [], previousRepos: [], days };
        }

        // Re-check the category against current config rather than trusting the value
        // stored at write time. Category config is hand-edited, and without this an image
        // that has since been excluded (the *-server-website frontends) keeps showing up
        // on the card until someone remembers to POST /api/admin/recategorize-repos.
        const repos = storedRepos.filter(r => categorizeImage(r.image_name) === category);
        const excluded = storedRepos.length - repos.length;

        let total = await getCategoryTotal(category, date);
        if (excluded > 0) {
            // Stored total still counts the now-excluded images, so recompute from the rows
            total = repos.reduce((sum, r) => sum + r.instance_count, 0);
            log.info(
                { category, excluded },
                '%s: %d stored image(s) no longer match the category — run /api/admin/recategorize-repos to update history',
                category,
                excluded
            );
        }

        // Get comparison data from N days ago (based on query param)
        const prevDate = new Date(date);
        prevDate.setDate(prevDate.getDate() - days);
        const prevDateStr = prevDate.toISOString().split('T')[0];
        const previousTotal = await getCategoryTotal(category, prevDateStr);

        const grouped = groupReposByCanonicalName(repos).slice(0, limit);

        // Previous counts for the same groups — sum every image in the group
        const previousRepos = [];
        for (const group of grouped) {
            let prevCount = 0;
            for (const image of group.images) {
                try {
                    const history = await getRepoHistory(image, Math.max(days + 7, 90));
                    const match = history.find(h => h.snapshot_date === prevDateStr);
                    if (match) prevCount += match.instance_count;
                } catch { /* missing history for one variant shouldn't zero the group */ }
            }
            previousRepos.push({ image_name: group.image_name, instance_count: prevCount });
        }

        return {
            category,
            date,
            total,
            previousTotal,
            repos: grouped.map(g => ({
                image_name: g.image_name,
                instance_count: g.instance_count,
                displayName: g.displayName,
                images: g.images
            })),
            previousRepos,
            days
        };
    });
});

// Category history (aggregated daily totals, used by charts)
app.get('/api/history/category/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const limit = parseInt(req.query.limit) || 90;

        if (!CATEGORY_CONFIG[category]) {
            return res.status(400).json({ error: `Unknown category: ${category}` });
        }

        const history = await getCategoryHistory(category, limit);
        res.json({ count: history.length, data: history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List repos in a category (for chart dropdown)
app.get('/api/history/category/:category/repos', async (req, res) => {
    try {
        const { category } = req.params;
        if (!CATEGORY_CONFIG[category]) {
            return res.status(400).json({ error: `Unknown category: ${category}` });
        }

        const repos = await getReposByCategory(category);

        // Deduplicate by displayName — multiple images can map to the same game/app
        // (e.g. mbround18/valheim, littlestache/valheim-flux both → "Valheim")
        const seen = new Map();
        for (const r of repos) {
            const displayName = getDisplayName(r.image_name);
            if (!seen.has(displayName)) {
                seen.set(displayName, { image_name: r.image_name, displayName });
            }
        }
        const deduplicated = [...seen.values()];

        res.json({ count: deduplicated.length, data: deduplicated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: backfill repo categories (only NULL rows)
app.post('/api/admin/backfill-repo-categories', async (req, res) => {
    try {
        const count = await backfillRepoCategories();
        res.json({ success: true, message: `Processed ${count} distinct images` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: full re-categorize (reset ALL categories then re-apply keywords)
app.post('/api/admin/recategorize-repos', async (req, res) => {
    try {
        const { resetCount, categorized } = await recategorizeAllRepos();
        res.json({
            success: true,
            message: `Reset ${resetCount} images, categorized ${Object.values(categorized).reduce((a,b) => a+b, 0)}`,
            categorized
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// IMPORTANT: Specific routes MUST come BEFORE parameterized routes
// Transaction summary - MUST be before /api/transactions/:date
app.get('/api/transactions/summary', async (req, res) => {
    try {
        log.info('fetching transaction summary');
        const today = new Date().toISOString().split('T')[0];
        const sevenDays = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
        const thirtyDays = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

        res.json({
            totalTransactions: await getTxidCount(),
            revenue: {
                today: await getRevenueForDateRange(today, today),
                last7Days: await getRevenueForDateRange(sevenDays, today),
                last30Days: await getRevenueForDateRange(thirtyDays, today)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Paginated transactions with search - MUST be before /api/transactions/:date
app.get('/api/transactions/paginated', async (req, res) => {
    try {
        log.info('starting transaction pagination');
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        // Cap kept deliberately — the CSV export pages through this endpoint rather than
        // asking for everything at once. It used to request all ~21k rows in one call and
        // silently receive only the first 1000.
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), MAX_PAGE_SIZE);
        const search = req.query.search || '';
        const appName = req.query.appName || null;

        const result = await getTransactionsPaginated(page, limit, search, appName);

        res.json({
            transactions: result.transactions,
            total: result.total,
            page: page,
            limit: limit,
            totalPages: Math.ceil(result.total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// App Revenue Analytics - grouped by app_name
app.get('/api/analytics/apps', async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const search = req.query.search || '';
    const cacheKey = `apps:${page}:${limit}:${search}`;

    return withDbFallback(analyticsCache, cacheKey, res, async () => {
        const result = await getAppAnalytics(page, limit, search);
        return {
            apps: result.apps,
            total: result.total,
            page,
            limit,
            totalPages: Math.ceil(result.total / limit)
        };
    });
});

// Transactions by date - MUST come AFTER specific routes
app.get('/api/transactions/:date', async (req, res) => {
    try {
        log.info('fetching transactions by date');
        const transactions = await getTransactionsByDate(req.params.date);

        res.json({
            date: req.params.date,
            count: transactions.length,
            transactions: transactions.map(tx => ({
                txid: tx.txid,
                shortTxid: tx.txid.substring(0, 16) + '...',
                amount: tx.amount,
                blockHeight: tx.block_height,
                date: tx.date
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Gaming category
app.get('/api/categories/gaming', async (req, res) => {
    try {
        log.info('fetching gaming category');
        const current = await getCurrentMetrics();
        const snapshots = await getLastNSnapshots(parseInt(req.query.days) || 30);

        res.json({
            current: {
                total: current.gaming_apps_total,
                palworld: current.gaming_palworld,
                minecraft: current.gaming_minecraft
            },
            history: snapshots.reverse().map(s => ({
                date: s.snapshot_date,
                total: s.gaming_apps_total
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crypto category
app.get('/api/categories/crypto', async (req, res) => {
    try {
        log.info('fetching crypto category');
        const current = await getCurrentMetrics();
        res.json({
            current: {
                total: current.crypto_nodes_total,
                presearch: current.crypto_presearch,
                kadena: current.crypto_kadena,
                kaspa: current.crypto_kaspa
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Nodes category
app.get('/api/categories/nodes', async (req, res) => {
    try {
        log.info('fetching node category');
        const current = await getCurrentMetrics();
        res.json({
            current: {
                total: current.node_total,
                cumulus: current.node_cumulus,
                nimbus: current.node_nimbus,
                stratus: current.node_stratus
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analytics comparison endpoint
// CORRECTED Analytics comparison endpoint
// This version TRANSFORMS getCurrentMetrics() to match the structure your frontend expects
// Replace the endpoint starting at line ~547 in server.js with this code

app.get('/api/analytics/comparison/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days);

        if (isNaN(days) || days < 1) {
            return res.status(400).json({ error: 'Invalid days parameter' });
        }

        const rawCurrent = await getCurrentMetrics();
        if (!rawCurrent) {
            return res.status(404).json({ error: 'No current metrics found' });
        }

        // CRITICAL: Transform raw database columns into nested structure
        // This matches what the OLD endpoint returned from snapshot.js
        const current = {
            nodes: {
                total: rawCurrent.node_total,
                cumulus: rawCurrent.node_cumulus,
                nimbus: rawCurrent.node_nimbus,
                stratus: rawCurrent.node_stratus
            },
            apps: {
                total: rawCurrent.total_apps,
                gitapps: rawCurrent.gitapps_count || 0,
                dockerapps: rawCurrent.dockerapps_count || 0
            },
            gaming: {
                total: rawCurrent.gaming_apps_total,
                minecraft: rawCurrent.gaming_minecraft,
                palworld: rawCurrent.gaming_palworld,
                enshrouded: rawCurrent.gaming_enshrouded
            },
            crypto: {
                total: rawCurrent.crypto_nodes_total,
                presearch: rawCurrent.crypto_presearch,
                kaspa: rawCurrent.crypto_kaspa,
                alephium: rawCurrent.crypto_alephium
            },
            cloud: {
                cpu: { utilization: rawCurrent.cpu_utilization_percent },
                ram: { utilization: rawCurrent.ram_utilization_percent },
                storage: { utilization: rawCurrent.storage_utilization_percent }
            },
            wordpress: {
                count: rawCurrent.wordpress_count
            }
        };

        // Get dates for comparison
        const today = new Date().toISOString().split('T')[0];
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        log.info({ today, targetDate: targetDateStr, days }, 'comparison request');

        // Calculate changes
        const calculateChange = (current, past) => {
            if (!past || past === 0) return { change: 0, trend: 'neutral' };
            const change = ((current - past) / past) * 100;
            return {
                change: Math.round(change * 100) / 100,
                trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
            };
        };

        // REVENUE: compare period totals, not single days.
        // Revenue is a flow, so "vs 30 days" has to mean the last 30 days against the 30
        // before that. Comparing today against the one day 30 days ago made every period
        // report today's number, which is what issue #48 reported.
        const shiftDays = (dateStr, n) => {
            const d = new Date(`${dateStr}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().split('T')[0];
        };

        const currentStart = shiftDays(today, -(days - 1));
        const previousEnd = shiftDays(currentStart, -1);
        const previousStart = shiftDays(previousEnd, -(days - 1));

        const currentRevenue = await getRevenueForDateRange(currentStart, today);
        const comparisonRevenue = await getRevenueForDateRange(previousStart, previousEnd);

        let revenueComparison;
        if (comparisonRevenue > 0) {
            revenueComparison = calculateChange(currentRevenue, comparisonRevenue);
        } else {
            revenueComparison = {
                change: 0,
                trend: 'neutral',
                note: `No revenue data for ${previousStart}..${previousEnd}`
            };
        }

        revenueComparison.current = currentRevenue;
        revenueComparison.previous = comparisonRevenue;
        revenueComparison.currentRange = { start: currentStart, end: today };
        revenueComparison.previousRange = { start: previousStart, end: previousEnd };

        // For other metrics, we need snapshot data
        const pastSnapshot = await getSnapshotByDate(targetDateStr);

        // Build response
        const response = {
            period: days,
            currentDate: today,
            comparisonDate: targetDateStr,
            changes: {
                revenue: revenueComparison
            }
        };

        // Add other metrics only if snapshot exists
        if (pastSnapshot) {
            log.info({ targetDate: targetDateStr }, 'found snapshot for comparison');

            // Node comparisons with individual breakdowns
            const nodeChange = calculateChange(current.nodes?.total || 0, pastSnapshot.node_total);
            const cumulusChange = (current.nodes?.cumulus || 0) - (pastSnapshot.node_cumulus || 0);
            const nimbusChange = (current.nodes?.nimbus || 0) - (pastSnapshot.node_nimbus || 0);
            const stratusChange = (current.nodes?.stratus || 0) - (pastSnapshot.node_stratus || 0);

            response.changes.nodes = {
                ...nodeChange,
                difference: (current.nodes?.total || 0) - (pastSnapshot.node_total || 0),
                cumulusChange: cumulusChange,
                cumulusTrend: cumulusChange > 0 ? 'up' : cumulusChange < 0 ? 'down' : 'neutral',
                nimbusChange: nimbusChange,
                nimbusTrend: nimbusChange > 0 ? 'up' : nimbusChange < 0 ? 'down' : 'neutral',
                stratusChange: stratusChange,
                stratusTrend: stratusChange > 0 ? 'up' : stratusChange < 0 ? 'down' : 'neutral'
            };

            response.changes.apps = {
                ...calculateChange(current.apps?.total || 0, pastSnapshot.total_apps),
                difference: (current.apps?.total || 0) - (pastSnapshot.total_apps || 0),
                gitChange: (current.apps?.gitapps || 0) - (pastSnapshot.gitapps_count || 0),
                gitTrend: (current.apps?.gitapps || 0) > (pastSnapshot.gitapps_count || 0) ? 'up' :
                         (current.apps?.gitapps || 0) < (pastSnapshot.gitapps_count || 0) ? 'down' : 'neutral',
                dockerChange: (current.apps?.dockerapps || 0) - (pastSnapshot.dockerapps_count || 0),
                dockerTrend: (current.apps?.dockerapps || 0) > (pastSnapshot.dockerapps_count || 0) ? 'up' :
                            (current.apps?.dockerapps || 0) < (pastSnapshot.dockerapps_count || 0) ? 'down' : 'neutral'
            };

            // CLOUD COMPARISONS - Now using transformed data
            response.changes.cpu = calculateChange(current.cloud?.cpu?.utilization || 0, pastSnapshot.cpu_utilization_percent);
            response.changes.ram = calculateChange(current.cloud?.ram?.utilization || 0, pastSnapshot.ram_utilization_percent);
            response.changes.storage = calculateChange(current.cloud?.storage?.utilization || 0, pastSnapshot.storage_utilization_percent);

            // Decentralization (issue #108 Phase 3): "current" reads live from
            // decentralizationService rather than rawCurrent/current_metrics, since that's
            // where the always-fresh reading actually lives -- same reasoning /api/decentralization
            // already uses.
            const liveDecentralization = await getDecentralizationStats();
            response.changes.decentralization = calculateChange(
                liveDecentralization.datacenterPercent ?? 0,
                pastSnapshot.decentralization_datacenter_percent
            );

            // Apps deployed/expiring (item 3 of the decentralization follow-ups): "current"
            // reads live from carouselService, same reasoning as decentralization above --
            // an uncached live read (`cached: false`) is treated as 0 for the comparison
            // rather than blocking the rest of the response, matching liveDecentralization's
            // `?? 0` fallback just above.
            const liveActivity = await getFluxCloudActivity();
            response.changes.appsDeployed = calculateChange(
                liveActivity.deployedToday.cached ? liveActivity.deployedToday.apps.length : 0,
                pastSnapshot.apps_deployed_today
            );
            response.changes.appsExpiring = calculateChange(
                liveActivity.expiring24h.cached ? liveActivity.expiring24h.apps.length : 0,
                pastSnapshot.apps_expiring_today
            );

            // Gaming comparisons with individual breakdowns
            response.changes.gaming = {
                ...calculateChange(current.gaming?.total || 0, pastSnapshot.gaming_apps_total),
                difference: (current.gaming?.total || 0) - (pastSnapshot.gaming_apps_total || 0),
                minecraftChange: (current.gaming?.minecraft || 0) - (pastSnapshot.gaming_minecraft || 0),
                minecraftTrend: (current.gaming?.minecraft || 0) > (pastSnapshot.gaming_minecraft || 0) ? 'up' :
                               (current.gaming?.minecraft || 0) < (pastSnapshot.gaming_minecraft || 0) ? 'down' : 'neutral',
                palworldChange: (current.gaming?.palworld || 0) - (pastSnapshot.gaming_palworld || 0),
                palworldTrend: (current.gaming?.palworld || 0) > (pastSnapshot.gaming_palworld || 0) ? 'up' :
                              (current.gaming?.palworld || 0) < (pastSnapshot.gaming_palworld || 0) ? 'down' : 'neutral',
                enshroudedChange: (current.gaming?.enshrouded || 0) - (pastSnapshot.gaming_enshrouded || 0),
                enshroudedTrend: (current.gaming?.enshrouded || 0) > (pastSnapshot.gaming_enshrouded || 0) ? 'up' :
                                (current.gaming?.enshrouded || 0) < (pastSnapshot.gaming_enshrouded || 0) ? 'down' : 'neutral'
            };

            // Crypto comparisons with individual breakdowns
            response.changes.crypto = {
                ...calculateChange(current.crypto?.total || 0, pastSnapshot.crypto_nodes_total),
                difference: (current.crypto?.total || 0) - (pastSnapshot.crypto_nodes_total || 0),
                presearchChange: (current.crypto?.presearch || 0) - (pastSnapshot.crypto_presearch || 0),
                presearchTrend: (current.crypto?.presearch || 0) > (pastSnapshot.crypto_presearch || 0) ? 'up' :
                               (current.crypto?.presearch || 0) < (pastSnapshot.crypto_presearch || 0) ? 'down' : 'neutral',
                kaspaChange: (current.crypto?.kaspa || 0) - (pastSnapshot.crypto_kaspa || 0),
                kaspaTrend: (current.crypto?.kaspa || 0) > (pastSnapshot.crypto_kaspa || 0) ? 'up' :
                           (current.crypto?.kaspa || 0) < (pastSnapshot.crypto_kaspa || 0) ? 'down' : 'neutral',
                alephiumChange: (current.crypto?.alephium || 0) - (pastSnapshot.crypto_alephium || 0),
                alephiumTrend: (current.crypto?.alephium || 0) > (pastSnapshot.crypto_alephium || 0) ? 'up' :
                              (current.crypto?.alephium || 0) < (pastSnapshot.crypto_alephium || 0) ? 'down' : 'neutral'
            };

            response.changes.wordpress = {
                ...calculateChange(current.wordpress?.count || 0, pastSnapshot.wordpress_count),
                difference: (current.wordpress?.count || 0) - (pastSnapshot.wordpress_count || 0)
            };

        } else {
            log.warn({ targetDate: targetDateStr, days }, 'no snapshot found for comparison');
            log.info('revenue comparison still available using transaction data');

            response.partialData = true;
            response.message = `Snapshot data not available for ${targetDateStr}, but revenue comparison is available from transaction history.`;

            // Calculate Git/Docker comparison even without past snapshot (compare against 0)
            response.changes.apps = {
                change: 0,
                difference: 0,
                trend: 'neutral',
                gitChange: current.apps?.gitapps || 0,
                gitTrend: (current.apps?.gitapps || 0) > 0 ? 'up' : 'neutral',
                dockerChange: current.apps?.dockerapps || 0,
                dockerTrend: (current.apps?.dockerapps || 0) > 0 ? 'up' : 'neutral'
            };

        }

        res.json(response);

    } catch (error) {
        log.error({ err: error }, 'comparison endpoint error');
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

// UPDATED: Manual snapshot trigger using new system
app.post('/api/admin/snapshot', async (req, res) => {
    try {
        log.info('manual snapshot triggered via API');
        const result = await takeManualSnapshot();

        if (result.success) {
            res.json({
                success: true,
                snapshot_date: result.snapshotDate,
                revenue: result.data.daily_revenue,
                nodes: result.data.node_total,
                apps: result.data.total_apps
            });
        } else {
            res.status(400).json({
                success: false,
                reason: result.reason,
                skipped: result.skipped || false,
                validationFailed: result.validationFailed || false,
                lockFailed: result.lockFailed || false
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Manual repo-only snapshot (works even if today's daily snapshot already exists)
app.post('/api/admin/repo-snapshot', async (req, res) => {
    try {
        log.info('manual repo snapshot triggered via API');
        const result = await takeRepoSnapshot();
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/carousel/stats', (req, res) => {
    try {
        const result = getCachedCarouselData();  // ✅ New function

        res.json({
            stats: result.stats || [],  // ✅ New field name
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error({ err: error }, 'carousel API error');

        res.status(500).json({
            error: 'Failed to fetch carousel stats',
            message: error.message,
            stats: [],
            cached: false
        });
    }
});

// Busiest Node card (issue #108) — on-demand fetch-if-stale, same pattern as the carousel
// endpoints above, just on its own (slower) TTL.
app.get('/api/busiest-node', async (req, res) => {
    try {
        const node = await getBusiestNode();
        res.json({ node, timestamp: new Date().toISOString() });
    } catch (error) {
        log.error({ err: error }, 'busiest node API error');
        res.status(500).json({
            error: 'Failed to fetch busiest node',
            message: error.message,
            node: null
        });
    }
});

// Decentralization metric (issue #108) — the scheduler (servicesScheduler.js) refreshes
// this in the background every 5 minutes; this just returns the cached snapshot instantly.
app.get('/api/decentralization', async (req, res) => {
    try {
        const stats = await getDecentralizationStats();
        res.json({ ...stats, timestamp: new Date().toISOString() });
    } catch (error) {
        log.error({ err: error }, 'decentralization stats API error');
        res.status(500).json({
            error: 'Failed to fetch decentralization stats',
            message: error.message
        });
    }
});

// Decentralization historical data (issue #108 Phase 3) -- backs the CSV export in
// DecentralizationCard.svelte. `days` mirrors Chart.svelte's own timeframe options.
app.get('/api/decentralization/history', async (req, res) => {
    try {
        const days = Math.max(1, parseInt(req.query.days) || 90);
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

        const [breakdown, snapshots] = await Promise.all([
            getDecentralizationSnapshotHistory(startDate, endDate),
            getSnapshotsInRange(startDate, endDate)
        ]);

        const headline = snapshots
            .filter(s => s.decentralization_datacenter_percent != null)
            .map(s => ({
                date: s.snapshot_date,
                datacenterCount: s.decentralization_datacenter_count,
                independentCount: s.decentralization_independent_count,
                datacenterPercent: s.decentralization_datacenter_percent,
                totalNodes: s.node_total
            }));

        res.json({
            history: breakdown.map(r => ({ date: r.snapshot_date, org: r.org, count: r.node_count })),
            headline
        });
    } catch (error) {
        log.error({ err: error }, 'decentralization history API error');
        res.status(500).json({ error: 'Failed to fetch decentralization history', message: error.message });
    }
});

// Carousel endpoint for latest deployed apps
app.get('/api/carousel/deployed', async (req, res) => {
    try {
        const result = await getCachedDeployedApps();

        res.json({
            stats: result.stats || [],
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error({ err: error }, 'deployed apps API error');

        res.status(500).json({
            error: 'Failed to fetch deployed apps',
            message: error.message,
            stats: [],
            cached: false
        });
    }
});

// Carousel endpoint for expiring soon apps
app.get('/api/carousel/expiring', async (req, res) => {
    try {
        const result = await getCachedExpiringApps();
        res.json({
            stats: result.stats || [],
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log.error({ err: error }, 'expiring apps API error');
        res.status(500).json({ error: 'Failed to fetch expiring apps', message: error.message, stats: [], cached: false });
    }
});

// Deduped deployed/expiring counts for the Total App Instances card (item 3 of the
// decentralization follow-ups) -- same getFluxCloudActivity() the KPI report and the
// daily snapshot collector use, so this card's numbers can never disagree with theirs.
app.get('/api/apps/activity', async (req, res) => {
    try {
        const activity = await getFluxCloudActivity();
        res.json({
            deployedToday: {
                cached: activity.deployedToday.cached,
                count: activity.deployedToday.cached ? activity.deployedToday.apps.length : null
            },
            expiring24h: {
                cached: activity.expiring24h.cached,
                count: activity.expiring24h.cached ? activity.expiring24h.apps.length : null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log.error({ err: error }, 'apps activity API error');
        res.status(500).json({ error: 'Failed to fetch apps activity', message: error.message });
    }
});

// ============================================
// FAILOVER ADMIN ENDPOINT
// ============================================
app.post('/api/admin/failover', (req, res) => {
    if (!hasFailover()) {
        return res.status(400).json({
            success: false,
            reason: 'No failover instance configured. Set SUPABASE_FAILOVER_URL and SUPABASE_FAILOVER_KEY.'
        });
    }
    const result = switchToFailover();
    res.json(result);
});

app.get('/api/admin/failover-status', (_req, res) => {
    res.json({
        activeInstance: getActiveInstanceName(),
        failoverConfigured: hasFailover(),
        circuit: getCircuitState()
    });
});

// ============================================
// BACKUP ENDPOINTS
// ============================================

app.get('/api/admin/backup-status', (_req, res) => {
    res.json(getBackupStatus());
});

app.post('/api/admin/backup', async (_req, res) => {
    if (!isBackupEnabled()) {
        return res.status(400).json({ enabled: false, error: 'Backup not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.' });
    }
    const result = await performBackup();
    res.status(result.success ? 200 : 500).json(result);
});

app.get('/api/admin/backups', async (_req, res) => {
    const result = await listBackups();
    res.status(result.success ? 200 : 500).json(result);
});

app.post('/api/admin/restore', async (req, res) => {
    const { date } = req.body || {};
    if (!date) {
        return res.status(400).json({ success: false, error: 'Missing "date" in request body (YYYY-MM-DD)' });
    }
    const result = await restoreFromBackup(date);
    res.status(result.success ? 200 : 500).json(result);
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ============================================
// START SERVER — Express starts immediately, DB init is non-blocking
// ============================================
function startSchedulers() {
    // Start the revenue sync scheduler (runs every 5 minutes)
    try {
        startRevenueSync();
        log.info('revenue sync scheduler initialized (interval: 5 minutes)');
    } catch (error) {
        log.error({ err: error }, 'could not initialize sync');
    }
    // Start the test scheduler (runs every hour)
    try {
        log.info('service test scheduler initialized (interval: 1 hour)');
        startServiceTests();
    } catch (error) {
        log.error({ err: error }, 'could not initialize test scheduler');
    }

    // Start the carousel updates
    try {
        log.info('carousel update scheduler initialized');
        startCarouselUpdates();
    } catch (error) {
        log.error({ err: error }, 'could not initialize carousel');
    }

    // Start the snapshot checker (runs every 30 minutes)
    try {
        log.info('snapshot checker initialized (interval: 30 min, grace: 5 min after midnight)');
        startSnapshotChecker();
    } catch (error) {
        log.error({ err: error }, 'could not initialize snapshot checker');
    }

    // Start the decentralization classification batches (issue #108, runs every 5 minutes)
    try {
        log.info('decentralization scheduler initialized');
        startDecentralizationUpdates();
    } catch (error) {
        log.error({ err: error }, 'could not initialize decentralization scheduler');
    }

    // Run failed txid cleanup daily
    setInterval(async () => {
        try {
            const cleared = await clearPermanentlyFailedTxids();
            if (cleared > 0) log.info({ cleared }, 'cleared permanently failed txids');
        } catch {}
    }, 24 * 60 * 60 * 1000);
}

app.listen(PORT, '0.0.0.0', async () => {
    log.info({ port: PORT, host: '0.0.0.0' }, 'Flux Dashboard API started');

    // Initialize database with retry (non-crashing) — creates schema
    const dbOk = await ensureInitialized();

    // Bootstrap from R2 if SQLite mode (after DB init so schema exists)
    if (dbOk && (process.env.DB_TYPE || '').toLowerCase() === 'sqlite') {
        const { runBootstrap } = await import('./lib/services/bootstrapService.js');
        await runBootstrap();
    }

    if (dbOk) {
        log.info('database ready — starting all schedulers');
        startSchedulers();
        startKpiScheduler();
    } else {
        log.warn('database not reachable — server is running in DEGRADED mode (stale cache or 503, schedulers deferred)');

        // Keep retrying DB init in the background (with concurrency guard)
        let initRetryRunning = false;
        const retryInterval = setInterval(async () => {
            if (initRetryRunning) return;
            initRetryRunning = true;
            try {
                log.info('retrying database connection...');
                const ok = await ensureInitialized();
                if (ok) {
                    clearInterval(retryInterval);
                    log.info('database connected — starting schedulers now');
                    startSchedulers();
                    startKpiScheduler();
                }
            } finally {
                initRetryRunning = false;
            }
        }, 60_000); // retry every 60s
    }

    log.info({
        requestLogging: LOGGING_CONFIG.enableRequestLogging,
        healthChecks: LOGGING_CONFIG.logHealthChecks,
        statsEndpoints: LOGGING_CONFIG.logStatsEndpoints,
        metricsEndpoints: LOGGING_CONFIG.logMetricsEndpoints,
        comparisonEndpoints: LOGGING_CONFIG.logComparisonEndpoints,
        errorsOnly: LOGGING_CONFIG.logErrorsOnly
    }, 'logging configuration');
});

// Graceful shutdown — stop all schedulers
function shutdownGracefully(signal) {
    log.info({ signal }, 'shutting down gracefully');
    stopCarouselUpdates();
    stopRevenueSync();
    stopSnapshotChecker();
    stopKpiScheduler();
    stopDecentralizationUpdates();
    process.exit(0);
}

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));

export default app;
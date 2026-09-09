import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { CSP_DIRECTIVES } from './lib/security/contentSecurityPolicy.js';

import { ensureInitialized } from './lib/db/database.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('server');

// Import the NEW snapshot manager
import { startSnapshotChecker, stopSnapshotChecker } from './lib/db/snapshotManager.js';

// Import the revenue scheduler (wraps your existing revenueService.js)
import { startRevenueSync, stopRevenueSync } from './lib/services/revenueScheduler.js';

// Import revenue service for the daily failed-txid cleanup
import { clearPermanentlyFailedTxids } from './lib/services/revenueService.js';

// Import testAllServices scheduler wiring
import {
    startServiceTests,
    startCarouselUpdates,
    stopCarouselUpdates,
    startDecentralizationUpdates,
    stopDecentralizationUpdates
} from './lib/services/servicesScheduler.js';

import { startKpiScheduler, stopKpiScheduler } from './lib/services/kpiScheduler.js';

import coreRouter from './routes/api/core.js';
import dashboardRouter from './routes/api/dashboard.js';
import kpiRouter from './routes/api/kpi.js';
import revenueRouter from './routes/api/revenue.js';
import historyRouter from './routes/api/history.js';
import analyticsRouter from './routes/api/analytics.js';
import adminRouter from './routes/api/admin.js';

const app = express();
const PORT = process.env.PORT || 3000;

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

// ============================================
// ROUTERS (src/routes/api/*) — see issue #123
// ============================================
app.use('/api', coreRouter);
app.use('/api', dashboardRouter);
app.use('/api', kpiRouter);
app.use('/api', revenueRouter);
app.use('/api/history', historyRouter);
app.use('/api', analyticsRouter);
app.use('/api/admin', adminRouter);

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

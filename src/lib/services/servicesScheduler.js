// flux-performance-dashboard/src/lib/services/servicesScheduler.js

import { testAllServices } from './test-allServices.js';
import { fetchCarouselData, fetchLatestDeployedApps, fetchExpiringApps } from './carouselService.js';  // UPDATED: Use new function name
import { runDecentralizationCycle } from './decentralizationService.js';
import { CLOUD_CONFIG, GAMING_CONFIG, WORDPRESS_CONFIG, CAROUSEL_CONFIG, DECENTRALIZATION_CONFIG } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('servicesScheduler');

// Configuration — driven by config.js instead of a hardcoded hour.
// A cycle refreshes every service, so it has to run at the shortest interval any of them
// declares; anything slower makes that service's stated interval a lie. These used to be
// hardcoded to 1h, which is why dashboard numbers could be an hour stale (issue #50).
const SERVICE_INTERVALS = [
    CLOUD_CONFIG.updateInterval,
    GAMING_CONFIG.updateInterval,
    WORDPRESS_CONFIG.updateInterval
].filter(ms => typeof ms === 'number' && ms > 0);

const TEST_INTERVAL_MS = SERVICE_INTERVALS.length > 0
    ? Math.min(...SERVICE_INTERVALS)
    : 5 * 60 * 1000;

const CAROUSEL_INTERVAL_MS = CAROUSEL_CONFIG.updateInterval;
const DECENTRALIZATION_INTERVAL_MS = DECENTRALIZATION_CONFIG.updateInterval;

// State tracking
let intervalId = null;
let carouselIntervalId = null;
let decentralizationIntervalId = null;
let isRunning = false;
let isCarouselRunning = false;
let isDecentralizationRunning = false;
let lastRun = null;
let lastCarouselRun = null;
let lastDecentralizationRun = null;
let consecutiveFailures = 0;
// Per step of the cycle (#431): { lastSuccess, consecutiveFailures, lastError }. testAllServices
// isolates each step and never throws, so without this a service could fail every cycle while
// the scheduler reported healthy.
const serviceHealth = {};
let consecutiveCarouselFailures = 0;
let consecutiveDecentralizationFailures = 0;

/**
 * Run a test cycle
 */
async function runTests() {
    const now = new Date();
    log.info('Test sync scheduled run at %s', now.toISOString());

    // Prevent concurrent runs
    if (isRunning) {
        log.info('Previous test still running, skipping...');
        return;
    }
    
    try {
        isRunning = true;
        
        const result = await testAllServices();
        recordServiceResults(result);

        lastRun = Date.now();
        // A cycle in which EVERY step failed is a failed cycle (#431); a partial failure is
        // tracked per service instead.
        if (result && result.succeeded?.length === 0 && result.failed?.length > 0) {
            consecutiveFailures++;
        } else {
            consecutiveFailures = 0;
        }

        log.info('Tests completed');

    } catch (error) {
        log.error({ err: error }, 'Test sync failed');
        consecutiveFailures++;

        if (consecutiveFailures >= 3) {
            log.error('ALERT: %d consecutive test failures!', consecutiveFailures);
        }
    } finally {
        isRunning = false;
    }
}

/** Fold one cycle's { succeeded, failed } into the per-service record (#431). */
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

/**
 * Run carousel update
 */
// Exported for tests only (mirrors kpiScheduler.js's runSchedulerTick pattern) --
// startCarouselUpdates()'s setInterval never fires in tests.
export async function runCarouselUpdate() {
    const now = new Date();
    log.info('Carousel sync scheduled run at %s', now.toISOString());

    // Prevent concurrent runs
    if (isCarouselRunning) {
        log.info('Previous carousel update still running, skipping...');
        return;
    }
    
    try {
        isCarouselRunning = true;

        // UPDATED: Fetch all carousel data (apps + benchmarks)
        const carouselStats = await fetchCarouselData();

        // Proactively refresh the deployed/expiring caches on this same 10-minute cycle
        // (CAROUSEL_CONFIG.updateInterval), well inside their 20-minute freshnessThreshold --
        // so the on-demand refetch inside getCachedDeployedApps()/getCachedExpiringApps()
        // (server.js's /api/carousel/* routes) almost never fires from a live client request.
        // That on-demand path is still there as a fallback; this just makes it rare instead
        // of routine, since it was the header's client-side poll (issue #126) landing on a
        // cold cache and racing the ~15s upstream fetch it triggers. Independent try/catch per
        // table, same pattern as backupService -- one failing must not skip the other or the
        // benchmark fetch above.
        try {
            await fetchLatestDeployedApps();
        } catch (error) {
            log.error({ err: error }, 'Proactive deployed-apps cache refresh failed');
        }
        try {
            await fetchExpiringApps();
        } catch (error) {
            log.error({ err: error }, 'Proactive expiring-apps cache refresh failed');
        }

        lastCarouselRun = Date.now();
        consecutiveCarouselFailures = 0;

        log.info('Carousel updated with %d stats', carouselStats.length);

    } catch (error) {
        log.error({ err: error }, 'Carousel sync failed');
        consecutiveCarouselFailures++;

        if (consecutiveCarouselFailures >= 3) {
            log.error('ALERT: %d consecutive carousel failures!', consecutiveCarouselFailures);
        }
    } finally {
        isCarouselRunning = false;
    }
}

/**
 * Run one decentralization classification batch (issue #108)
 */
async function runDecentralizationUpdate() {
    log.info('Decentralization classification scheduled run at %s', new Date().toISOString());

    // Prevent concurrent runs
    if (isDecentralizationRunning) {
        log.info('Previous decentralization batch still running, skipping...');
        return;
    }

    try {
        isDecentralizationRunning = true;

        await runDecentralizationCycle();

        lastDecentralizationRun = Date.now();
        consecutiveDecentralizationFailures = 0;

    } catch (error) {
        log.error({ err: error }, 'Decentralization batch failed');
        consecutiveDecentralizationFailures++;

        if (consecutiveDecentralizationFailures >= 3) {
            log.error('ALERT: %d consecutive decentralization batch failures!', consecutiveDecentralizationFailures);
        }
    } finally {
        isDecentralizationRunning = false;
    }
}

/**
 * Start the automatic test scheduling (runs every hour)
 */
export function startServiceTests() {
    if (intervalId) {
        log.warn('Test sync already running');
        return;
    }

    log.info('Starting automatic service tests...');
    log.info('Test interval: %d minutes', TEST_INTERVAL_MS / 1000 / 60);
    
    // Run immediately on startup
    runTests();
    
    // Then run every hour
    intervalId = setInterval(runTests, TEST_INTERVAL_MS);
    
    log.info('Service test scheduler started');
}

/**
 * Start the automatic carousel updates (runs every hour)
 */
export function startCarouselUpdates() {
    if (carouselIntervalId) {
        log.warn('Carousel sync already running');
        return;
    }

    log.info('Starting automatic carousel updates...');
    log.info('Carousel interval: %d minutes', CAROUSEL_INTERVAL_MS / 1000 / 60);
    
    // Run immediately on startup
    runCarouselUpdate();
    
    // Then run every hour
    carouselIntervalId = setInterval(runCarouselUpdate, CAROUSEL_INTERVAL_MS);
    
    log.info('Carousel update scheduler started');
}

/**
 * Start the automatic decentralization classification (issue #108, runs every 5 minutes)
 */
export function startDecentralizationUpdates() {
    if (decentralizationIntervalId) {
        log.warn('Decentralization scheduler already running');
        return;
    }

    log.info('Starting automatic decentralization classification...');
    log.info('Decentralization interval: %d minutes', DECENTRALIZATION_INTERVAL_MS / 1000 / 60);

    // Run immediately on startup
    runDecentralizationUpdate();

    decentralizationIntervalId = setInterval(runDecentralizationUpdate, DECENTRALIZATION_INTERVAL_MS);

    log.info('Decentralization scheduler started');
}

/**
 * Stop the automatic decentralization classification
 */
export function stopDecentralizationUpdates() {
    if (decentralizationIntervalId) {
        clearInterval(decentralizationIntervalId);
        decentralizationIntervalId = null;
        log.info('Decentralization scheduler stopped');
    }
}

/**
 * Stop the automatic carousel updates
 */
export function stopCarouselUpdates() {
    if (carouselIntervalId) {
        clearInterval(carouselIntervalId);
        carouselIntervalId = null;
        log.info('Carousel update scheduler stopped');
    }
}

/**
 * Get test status (for health checks)
 */
export function getServiceTestSchedulerStatus() {
    return {
        isSchedulerRunning: !!intervalId,
        isTestInProgress: isRunning,
        intervalMs: TEST_INTERVAL_MS,
        lastRun,
        consecutiveFailures,
        isHealthy: consecutiveFailures < 3 && Object.values(serviceHealth).every(s => s.consecutiveFailures < 3),
        services: { ...serviceHealth }
    };
}
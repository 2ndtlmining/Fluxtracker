// flux-performance-dashboard/src/lib/services/servicesScheduler.js

import { testAllServices } from './test-allServices.js';
import { fetchCarouselData } from './carouselService.js';  // UPDATED: Use new function name
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
        
        // Call the testAllServices function
        await testAllServices();
        
        lastRun = Date.now();
        consecutiveFailures = 0;
        
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

/**
 * Run carousel update
 */
async function runCarouselUpdate() {
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
 * Get decentralization scheduler status (for health checks)
 */
export function getDecentralizationSchedulerStatus() {
    return {
        isSchedulerRunning: !!decentralizationIntervalId,
        isBatchInProgress: isDecentralizationRunning,
        intervalMs: DECENTRALIZATION_INTERVAL_MS,
        lastRun: lastDecentralizationRun,
        consecutiveFailures: consecutiveDecentralizationFailures,
        isHealthy: consecutiveDecentralizationFailures < 3
    };
}

/**
 * Stop the automatic test scheduling
 */
export function stopServiceTests() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        log.info('Service test scheduler stopped');
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
        isHealthy: consecutiveFailures < 3
    };
}

/**
 * Get carousel status (for health checks)
 */
export function getCarouselSchedulerStatus() {
    return {
        isSchedulerRunning: !!carouselIntervalId,
        isUpdateInProgress: isCarouselRunning,
        intervalMs: CAROUSEL_INTERVAL_MS,
        lastRun: lastCarouselRun,
        consecutiveFailures: consecutiveCarouselFailures,
        isHealthy: consecutiveCarouselFailures < 3
    };
}
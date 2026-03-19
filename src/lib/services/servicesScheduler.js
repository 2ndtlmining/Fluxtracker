// flux-performance-dashboard/src/lib/services/servicesScheduler.js

import { testAllServices } from './test-allServices.js';
import { fetchCarouselData } from './carouselService.js';  // UPDATED: Use new function name
import { createLogger } from '../logger.js';

const log = createLogger('servicesScheduler');

// Configuration
const TEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CAROUSEL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour (same as other services)

// State tracking
let intervalId = null;
let carouselIntervalId = null;
let isRunning = false;
let isCarouselRunning = false;
let lastRun = null;
let lastCarouselRun = null;
let consecutiveFailures = 0;
let consecutiveCarouselFailures = 0;

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
        lastRun: lastCarouselRun,
        consecutiveFailures: consecutiveCarouselFailures,
        isHealthy: consecutiveCarouselFailures < 3
    };
}
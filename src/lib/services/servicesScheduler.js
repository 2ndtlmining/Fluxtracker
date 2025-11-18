// flux-performance-dashboard/src/lib/services/servicesScheduler.js

import { testAllServices } from './test-allServices.js';
import { fetchTopApps } from './carouselService.js';

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
    console.log(`\n⏰ Test sync scheduled run at ${now.toISOString()}`);
    
    // Prevent concurrent runs
    if (isRunning) {
        console.log('⏭️  Previous test still running, skipping...');
        return;
    }
    
    try {
        isRunning = true;
        
        // Call the testAllServices function
        await testAllServices();
        
        lastRun = Date.now();
        consecutiveFailures = 0;
        
        console.log('✅ Tests completed\n');
        
    } catch (error) {
        console.error('❌ Test sync failed:', error.message);
        consecutiveFailures++;
        
        if (consecutiveFailures >= 3) {
            console.error(`🚨 ALERT: ${consecutiveFailures} consecutive test failures!`);
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
    console.log(`\n⏰ Carousel sync scheduled run at ${now.toISOString()}`);
    
    // Prevent concurrent runs
    if (isCarouselRunning) {
        console.log('⏭️  Previous carousel update still running, skipping...');
        return;
    }
    
    try {
        isCarouselRunning = true;
        
        // Fetch top apps for carousel
        const topApps = await fetchTopApps();
        
        lastCarouselRun = Date.now();
        consecutiveCarouselFailures = 0;
        
        console.log(`✅ Carousel updated with ${topApps.length} apps\n`);
        
    } catch (error) {
        console.error('❌ Carousel sync failed:', error.message);
        consecutiveCarouselFailures++;
        
        if (consecutiveCarouselFailures >= 3) {
            console.error(`🚨 ALERT: ${consecutiveCarouselFailures} consecutive carousel failures!`);
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
        console.warn('⚠️  Test sync already running');
        return;
    }
    
    console.log('🚀 Starting automatic service tests...');
    console.log(`   Test interval: ${TEST_INTERVAL_MS / 1000 / 60} minutes`);
    
    // Run immediately on startup
    runTests();
    
    // Then run every hour
    intervalId = setInterval(runTests, TEST_INTERVAL_MS);
    
    console.log('✅ Service test scheduler started');
}

/**
 * Start the automatic carousel updates (runs every hour)
 */
export function startCarouselUpdates() {
    if (carouselIntervalId) {
        console.warn('⚠️  Carousel sync already running');
        return;
    }
    
    console.log('🎠 Starting automatic carousel updates...');
    console.log(`   Carousel interval: ${CAROUSEL_INTERVAL_MS / 1000 / 60} minutes`);
    
    // Run immediately on startup
    runCarouselUpdate();
    
    // Then run every hour
    carouselIntervalId = setInterval(runCarouselUpdate, CAROUSEL_INTERVAL_MS);
    
    console.log('✅ Carousel update scheduler started');
}

/**
 * Stop the automatic test scheduling
 */
export function stopServiceTests() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('🛑 Service test scheduler stopped');
    }
}

/**
 * Stop the automatic carousel updates
 */
export function stopCarouselUpdates() {
    if (carouselIntervalId) {
        clearInterval(carouselIntervalId);
        carouselIntervalId = null;
        console.log('🛑 Carousel update scheduler stopped');
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
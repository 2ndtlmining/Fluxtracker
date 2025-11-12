// flux-performance-dashboard/src/lib/services/servicesScheduler.js

import { testAllServices } from './test-allServices.js';

// Configuration
const TEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// State tracking
let intervalId = null;
let isRunning = false;
let lastRun = null;
let consecutiveFailures = 0;

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
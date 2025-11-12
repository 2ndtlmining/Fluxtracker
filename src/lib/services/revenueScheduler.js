/**
 * REVENUE SERVICE AUTO-SCHEDULER
 * 
 * This module wraps your existing revenueService.js and adds automatic scheduling.
 * No changes to your existing revenue logic - just adds the 5-minute timer.
 */

import { fetchRevenueStats } from './revenueService.js';


// Configuration
const SYNC_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes

// State tracking
let intervalId = null;
let isRunning = false;
let lastRun = null;
let consecutiveFailures = 0;

/**
 * Run a sync cycle
 */
async function runSync() {
    const now = new Date();
    console.log(`\n⏰ Revenue sync scheduled run at ${now.toISOString()}`);
    
    // Prevent concurrent runs
    if (isRunning) {
        console.log('⏭️  Previous sync still running, skipping...');
        return;
    }
    
    try {
        isRunning = true;
        
        // Call your existing fetchRevenueStats function
        await fetchRevenueStats();
        
        lastRun = Date.now();
        consecutiveFailures = 0;
        
        console.log('✅ Revenue sync completed\n');
        
    } catch (error) {
        console.error('❌ Revenue sync failed:', error.message);
        consecutiveFailures++;
        
        if (consecutiveFailures >= 3) {
            console.error(`🚨 ALERT: ${consecutiveFailures} consecutive revenue sync failures!`);
        }
    } finally {
        isRunning = false;
    }
}

/**
 * Start the automatic revenue sync (runs every 5 minutes)
 */
export function startRevenueSync() {
    if (intervalId) {
        console.warn('⚠️  Revenue sync already running');
        return;
    }
    
    console.log('🚀 Starting automatic revenue sync...');
    console.log(`   Sync interval: ${SYNC_INTERVAL_MS / 1000 / 60} minutes`);
    
    // Run immediately on startup
    runSync();
    
    // Then run every 5 minutes
    intervalId = setInterval(runSync, SYNC_INTERVAL_MS);
    
    console.log('✅ Revenue sync scheduler started');
}

/**
 * Stop the automatic revenue sync
 */
export function stopRevenueSync() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log('🛑 Revenue sync scheduler stopped');
    }
}

/**
 * Get sync status (for health checks)
 */
export function getRevenueSyncSchedulerStatus() {
    return {
        isSchedulerRunning: !!intervalId,
        isSyncInProgress: isRunning,
        lastRun,
        consecutiveFailures,
        isHealthy: consecutiveFailures < 3
    };
}
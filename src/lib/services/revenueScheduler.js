/**
 * REVENUE SERVICE AUTO-SCHEDULER
 * 
 * This module wraps your existing revenueService.js and adds automatic scheduling.
 * No changes to your existing revenue logic - just adds the 5-minute timer.
 */

import { fetchRevenueStats, auditRecentTransactions } from './revenueService.js';
import { backfillNullUsdAmounts } from './priceHistoryService.js';


// Configuration
const SYNC_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const AUDIT_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after startup
const AUDIT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// State tracking
let intervalId = null;
let auditTimeoutId = null;
let auditIntervalId = null;
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
 * Run a daily audit to catch any missed transactions
 */
async function runAudit() {
    if (isRunning) {
        console.log('Sync in progress — deferring audit');
        return;
    }

    try {
        isRunning = true;
        const result = await auditRecentTransactions();
        console.log(`Daily audit result: ${result.recovered} recovered, ${result.missingFound} missing found`);

        // Backfill any transactions still missing USD values using historical prices
        const backfill = await backfillNullUsdAmounts();
        if (backfill.updated > 0) {
            console.log(`USD backfill: ${backfill.updated} updated, ${backfill.skipped} skipped`);
        }
    } catch (error) {
        console.error('Daily audit failed:', error.message);
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

    // Schedule daily audit: first run 10 min after startup, then every 24h
    auditTimeoutId = setTimeout(() => {
        runAudit();
        auditIntervalId = setInterval(runAudit, AUDIT_INTERVAL_MS);
    }, AUDIT_INITIAL_DELAY_MS);

    console.log('✅ Revenue sync scheduler started (daily audit scheduled)');
}

/**
 * Stop the automatic revenue sync
 */
export function stopRevenueSync() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    if (auditTimeoutId) {
        clearTimeout(auditTimeoutId);
        auditTimeoutId = null;
    }
    if (auditIntervalId) {
        clearInterval(auditIntervalId);
        auditIntervalId = null;
    }
    console.log('Revenue sync scheduler stopped');
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
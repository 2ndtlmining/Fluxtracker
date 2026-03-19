/**
 * REVENUE SERVICE AUTO-SCHEDULER
 * 
 * This module wraps your existing revenueService.js and adds automatic scheduling.
 * No changes to your existing revenue logic - just adds the 5-minute timer.
 */

import { fetchRevenueStats, auditRecentTransactions } from './revenueService.js';
import { backfillNullUsdAmounts } from './priceHistoryService.js';
import { shouldAllowRequest, recordSuccess, recordFailure } from '../db/circuitBreaker.js';
import { createLogger } from '../logger.js';

const log = createLogger('revenueScheduler');


// Configuration
const SYNC_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const AUDIT_INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after startup
const AUDIT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// State tracking
let intervalId = null;
let auditTimeoutId = null;
let auditIntervalId = null;
let isRunning = false;
let auditPending = false;
let lastRun = null;
let consecutiveFailures = 0;

/**
 * Run a sync cycle
 */
async function runSync() {
    const now = new Date();
    log.info('Revenue sync scheduled run at %s', now.toISOString());

    // Prevent concurrent runs
    if (isRunning) {
        log.info('Previous sync still running, skipping...');
        return;
    }

    // Check circuit breaker before hitting DB
    if (!shouldAllowRequest()) {
        log.info('Circuit breaker OPEN - skipping revenue sync');
        return;
    }

    try {
        isRunning = true;

        // Call your existing fetchRevenueStats function
        await fetchRevenueStats();

        lastRun = Date.now();
        consecutiveFailures = 0;
        recordSuccess();

        log.info('Revenue sync completed');

    } catch (error) {
        log.error({ err: error }, 'Revenue sync failed');
        consecutiveFailures++;
        recordFailure();

        if (consecutiveFailures >= 3) {
            log.error('ALERT: %d consecutive revenue sync failures!', consecutiveFailures);
        }
    } finally {
        isRunning = false;

        // If an audit was deferred while sync was running, run it now
        if (auditPending) {
            auditPending = false;
            log.info('Running deferred audit (was queued during sync)...');
            runAudit();
        }
    }
}

/**
 * Run a daily audit to catch any missed transactions
 */
async function runAudit() {
    if (!shouldAllowRequest()) {
        log.info('Circuit breaker OPEN - skipping audit');
        return;
    }

    if (isRunning) {
        log.info('Sync in progress - queuing audit to run after sync completes');
        auditPending = true;
        return;
    }

    try {
        isRunning = true;
        const result = await auditRecentTransactions();
        log.info({ recovered: result.recovered, missingFound: result.missingFound }, 'Daily audit result');

        // Backfill any transactions still missing USD values using historical prices
        const backfill = await backfillNullUsdAmounts();
        if (backfill.updated > 0) {
            log.info({ updated: backfill.updated, skipped: backfill.skipped }, 'USD backfill');
        }
        recordSuccess();
    } catch (error) {
        log.error({ err: error }, 'Daily audit failed');
        recordFailure();
    } finally {
        isRunning = false;
    }
}

/**
 * Start the automatic revenue sync (runs every 5 minutes)
 */
export function startRevenueSync() {
    if (intervalId) {
        log.warn('Revenue sync already running');
        return;
    }

    log.info('Starting automatic revenue sync...');
    log.info('Sync interval: %d minutes', SYNC_INTERVAL_MS / 1000 / 60);

    // Run immediately on startup
    runSync();

    // Then run every 5 minutes
    intervalId = setInterval(runSync, SYNC_INTERVAL_MS);

    // Schedule daily audit: first run 10 min after startup, then every 24h
    auditTimeoutId = setTimeout(() => {
        runAudit();
        auditIntervalId = setInterval(runAudit, AUDIT_INTERVAL_MS);
    }, AUDIT_INITIAL_DELAY_MS);

    log.info('Revenue sync scheduler started (daily audit scheduled)');
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
    log.info('Revenue sync scheduler stopped');
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
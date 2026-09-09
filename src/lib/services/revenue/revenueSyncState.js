import {
    getFailedTxidCount,
    clearAbandonedFailedTxids
} from '../../db/database.js';

// ============================================
// STATE TRACKING
// ============================================
export let revenueSyncState = {
    isRunning: false,
    lastStarted: null,
    lastCompleted: null,
    currentBlock: null,
    lastError: null
};

// ============================================
// FAILED TRANSACTION TRACKING (DB-backed)
// ============================================
// Failed txids are now persisted to the failed_txids table in the database.
// This ensures they survive process restarts and are retried every sync cycle.
// See database.js for CRUD functions: upsertFailedTxid, getUnresolvedFailedTxids,
// resolveFailedTxid, getFailedTxidCount, isFailedTxid

/**
 * Get failed transaction statistics (compatible wrapper for existing call sites)
 */
export async function getFailedTxStats() {
    return { totalFailed: await getFailedTxidCount() };
}

/**
 * Clear old resolved failed txids (compatible wrapper — called daily by server.js)
 */
export async function clearPermanentlyFailedTxids() {
    return await clearAbandonedFailedTxids(30);
}

/**
 * Get current revenue sync state
 */
export function getRevenueSyncState() {
    return { ...revenueSyncState };
}

/**
 * Set revenue sync state
 */
export function setRevenueSyncRunning(isRunning, currentBlock = null) {
    revenueSyncState.isRunning = isRunning;

    if (isRunning) {
        revenueSyncState.lastStarted = Date.now();
        revenueSyncState.currentBlock = currentBlock;
    } else {
        revenueSyncState.lastCompleted = Date.now();
        revenueSyncState.currentBlock = null;
    }
}

/**
 * Set revenue sync error
 */
export function setRevenueSyncError(error) {
    revenueSyncState.lastError = {
        message: error.message,
        timestamp: Date.now()
    };
}

/**
 * Check if revenue sync is currently running
 */
export function isRevenueSyncRunning() {
    return revenueSyncState.isRunning;
}

/**
 * Get time since last revenue sync completion
 */
export function getTimeSinceLastSync() {
    if (!revenueSyncState.lastCompleted) {
        return null;
    }
    return Date.now() - revenueSyncState.lastCompleted;
}

/**
 * Get detailed sync status for monitoring
 */
export function getRevenueSyncStatus() {
    return {
        state: { ...revenueSyncState },
        timeSinceLastSync: getTimeSinceLastSync(),
        isHealthy: !revenueSyncState.isRunning &&
                   revenueSyncState.lastCompleted !== null &&
                   getTimeSinceLastSync() < 5 * 60 * 1000
    };
}

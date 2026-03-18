// Database adapter router — selects Supabase or SQLite based on DB_TYPE env var.
// All consumers keep importing from this file — zero changes needed downstream.

// Load .env BEFORE reading DB_TYPE — ES module imports are hoisted,
// so server.js's dotenv.config() hasn't run yet when this file evaluates.
import dotenv from 'dotenv';
if (!process.env.DB_TYPE) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();

const adapter = dbType === 'sqlite'
    ? await import('./adapters/sqliteAdapter.js')
    : await import('./adapters/supabaseAdapter.js');

console.log(`Database adapter: ${dbType}`);

// Re-export every function from the chosen adapter
export const {
    // Initialization
    isDbReady,
    probeDb,
    initDatabase,
    ensureInitialized,
    // Current metrics
    getCurrentMetrics,
    updateCurrentMetrics,
    // Daily snapshots
    createDailySnapshot,
    getSnapshotByDate,
    getLastNSnapshots,
    getSnapshotsInRange,
    getAllSnapshots,
    deleteOldSnapshots,
    // Revenue transactions
    insertTransaction,
    insertTransactionsBatch,
    getUndeterminedAppNames,
    updateAppTypeForAppName,
    getTxidsWithoutAppName,
    countTxidsWithoutAppName,
    updateAppNameForTxid,
    getTransactionsByDate,
    getTransactionsByBlockRange,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getRevenueForBlockRange,
    getLastSyncedBlock,
    getTxidCount,
    getTransactionsPaginated,
    getAppAnalytics,
    getDailyRevenueFromTransactions,
    getDailyRevenueInRange,
    getDailyRevenueUSDFromTransactions,
    getDailyRevenueUSDInRange,
    deleteOldTransactions,
    getTransactionsWithNullUsd,
    updateTransactionUsdBatch,
    // Failed txid tracking
    upsertFailedTxid,
    getUnresolvedFailedTxids,
    resolveFailedTxid,
    getFailedTxidCount,
    clearAbandonedFailedTxids,
    isFailedTxid,
    // Sync status
    getSyncStatus,
    updateSyncStatus,
    resetRevenueSyncBlock,
    clearRevenueData,
    setNextSync,
    // Price history
    insertPriceHistoryBatch,
    getPriceForDate,
    getPricesForDateRange,
    getLatestPriceDate,
    getOldestPriceDate,
    getPriceHistoryCount,
    // Utility
    getDatabaseStats,
    closeDatabase,
    // Repo snapshots
    createRepoSnapshots,
    getRepoSnapshotCountByDate,
    getRepoHistory,
    getDistinctRepos,
    getLatestRepoSnapshot,
    // Category queries
    getTopReposByCategory,
    getCategoryTotal,
    getCategoryHistory,
    getReposByCategory,
    backfillRepoCategories,
    recategorizeAllRepos,
    // Backup export/import
    exportAllPriceHistory,
    upsertPriceHistory,
    exportAllDailySnapshots,
    exportAllRepoSnapshots,
    upsertDailySnapshots,
    upsertRepoSnapshots,
} = adapter;

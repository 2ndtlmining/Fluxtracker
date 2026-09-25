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

import { createLogger } from '../logger.js';
const log = createLogger('database');

import { instrumentAdapter } from './dbCallTracker.js';

// Instrumented so the database circuit breaker can tell a database failure from an
// upstream-API one (issue #219). Wrapping here covers every function in one place, and
// covers any function added later for free.
const adapter = instrumentAdapter(dbType === 'sqlite'
    ? await import('./adapters/sqliteAdapter.js')
    : await import('./adapters/supabaseAdapter.js'));

log.info(`Database adapter: ${dbType}`);

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
    updateSnapshotRevenue,
    getSnapshotByDate,
    setSnapshotWalletCount,
    setSnapshotGameColumns,
    fillSnapshotNullColumns,
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
    getRevenueFromAddressesForDateRange,
    getRevenueForBlockRange,
    getLastSyncedBlock,
    getTxidCount,
    createGameSnapshots,
    getGameSnapshotsByDate,
    getGameSnapshotHistory,
    getTransactionsPaginated,
    getAppAnalytics,
    getDailyRevenueFromTransactions,
    getDailyRevenueInRange,
    getDailyRevenueUSDFromTransactions,
    getDailyRevenueUSDInRange,
    // Team Funded historical trend (issue #146)
    getDailyRevenueFromAddressesInRange,
    getDailyRevenueUSDFromAddressesInRange,
    // Payer base (issue #267) -- aggregates only
    getMonthlyPayerStats,
    getAppRevenueConcentration,
    deleteOldTransactions,
    getTransactionsWithNullUsd,
    getOldestTransactionDate,
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
    exportAllGameSnapshots,
    upsertGameSnapshots,
    upsertDailySnapshots,
    upsertRepoSnapshots,
    // Node IP classification (issue #108)
    getAllNodeIpClassifications,
    upsertNodeIpClassifications,
    // Decentralization snapshots (historical -- issue #108 Phase 3)
    createDecentralizationDimensionSnapshots,
    getDecentralizationDimensionSnapshotHistory,
    createDecentralizationSnapshots,
    getDecentralizationSnapshotHistory,
    // Decentralization country/continent snapshots (issue #138)
    createDecentralizationCountrySnapshots,
    getDecentralizationCountrySnapshotHistory,
    createDecentralizationContinentSnapshots,
    getDecentralizationContinentSnapshotHistory,
} = adapter;

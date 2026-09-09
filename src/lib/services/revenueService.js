// Revenue service — public entry point.
//
// This file is a thin re-export hub. The implementation is split by concern under
// ./revenue/ (see issue #124):
//   - revenue/revenueSyncState.js — in-memory sync state & failed-tx stats
//   - revenue/transactionSync.js  — fetch/process/progressive sync/initial sync/audit
//   - revenue/revenueBackfill.js  — one-off app_name/app_type backfill utilities
//   - revenue/revenueReporting.js — revenue calculation & reporting
//   - fluxNetworkData.js          — generic FLUX price / block height reads (no
//                                   revenue-specific logic; shared network data)
//
// Every existing `import { X } from '$lib/services/revenueService.js'` continues to
// work unchanged — this file re-exports the full previous public surface.

export {
    getFailedTxStats,
    clearPermanentlyFailedTxids,
    getRevenueSyncState,
    isRevenueSyncRunning,
    getTimeSinceLastSync,
    getRevenueSyncStatus
} from './revenue/revenueSyncState.js';

export { fetchFluxPrice, fetchCurrentBlockHeight } from './fluxNetworkData.js';

export {
    progressiveSync,
    auditRecentTransactions,
    initialSync
} from './revenue/transactionSync.js';

export { backfillAppTypes, backfillAppNames } from './revenue/revenueBackfill.js';

export {
    getRevenueBreakdown,
    fetchRevenueStats,
    formatRevenueStats,
    calculateMonthlyRevenue,
    calculatePreviousMonthRevenue,
    getMonthlyPaymentCount,
    getPreviousMonthPaymentCount,
    calculateYesterdayRevenue,
    getYesterdayPaymentCount
} from './revenue/revenueReporting.js';

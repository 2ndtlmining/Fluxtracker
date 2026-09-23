import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #307 — a failed read must reject, never resolve to 0 / [] / null / a partial sum.
 *
 * Twenty-odd adapter reads used to log the error and return an empty value. To everything
 * above the adapter that is indistinguishable from "the database says there is nothing":
 * dbCallTracker counted it as a DB success, withDbFallback cached the zeros as fresh for
 * its whole TTL (replacing the good stale entry it would otherwise have served), and the
 * circuit breaker never tripped. A Supabase blip rendered as real zeros on the dashboard.
 */

let failure = null;     // the PostgREST error every call returns; null = succeed
let rowData = null;     // what a successful call returns

vi.mock('../supabaseClient.js', () => {
    const result = () => ({ data: failure ? null : rowData, count: failure ? null : 0, error: failure });
    const chain = () => {
        const c = {};
        for (const m of ['select', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'ilike', 'or']) {
            c[m] = () => c;
        }
        c.single = () => Promise.resolve(result());
        c.maybeSingle = () => Promise.resolve(result());
        c.range = () => Promise.resolve(result());
        c.then = (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        return c;
    };
    const rpc = () => chain();
    return { supabase: { from: () => chain(), rpc } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

beforeEach(() => {
    failure = null;
    rowData = null;
});

const READS = [
    ['getCurrentMetrics', []],
    ['getAllSnapshots', []],
    ['getLastNSnapshots', [30]],
    ['getTxidCount', []],
    ['getPaymentCountForDateRange', ['2026-09-01', '2026-09-22']],
    ['getRevenueForBlockRange', [1, 2]],
    ['getTransactionsByDate', ['2026-09-22']],
    ['getAppAnalytics', [1, 50, '']],
    ['getDailyRevenueFromTransactions', [30]],
    ['getDailyRevenueInRange', ['2026-09-01', '2026-09-22']],
    ['getDailyRevenueUSDFromTransactions', [30]],
    ['getPricesForDateRange', ['2026-09-01', '2026-09-22']],
    ['getPriceHistoryCount', []],
    ['getRepoSnapshotCountByDate', ['2026-09-22']],
    ['getRepoHistory', ['itzg/minecraft-server', 90]],
    ['getDistinctRepos', []],
    ['getLatestRepoSnapshot', []],
    ['getTopReposByCategory', ['gaming', 200]],
    ['getCategoryTotal', ['gaming', '2026-09-22']],
    ['getCategoryHistory', ['gaming', 90]],
    ['getReposByCategory', ['gaming']],
    ['getGameSnapshotsByDate', ['2026-09-22']],
    ['getUnresolvedFailedTxids', [200]],
    ['getFailedTxidCount', []],
    ['getTransactionsWithNullUsd', [1000, 0]],
    ['countTxidsWithoutAppName', [30]],
    ['getTxidsWithoutAppName', [100, 30]]
];

describe('failed reads reject instead of returning empty values (issue #307)', () => {
    it.each(READS)('%s rejects on a database error', async (fn, args) => {
        failure = { message: 'connection terminated unexpectedly' };
        await expect(adapter[fn](...args)).rejects.toThrow(/connection terminated/);
    });
});

describe('an empty result is still an empty result, not an error', () => {
    it('getCurrentMetrics returns null when the row does not exist yet', async () => {
        rowData = null;
        await expect(adapter.getCurrentMetrics()).resolves.toBeNull();
    });

    it('getTopReposByCategory returns no repos for a category with no rows', async () => {
        rowData = null;
        await expect(adapter.getTopReposByCategory('gaming', 200)).resolves.toEqual({ date: null, repos: [] });
    });

    it('getLatestRepoSnapshot returns [] on an empty table', async () => {
        rowData = null;
        await expect(adapter.getLatestRepoSnapshot()).resolves.toEqual([]);
    });
});

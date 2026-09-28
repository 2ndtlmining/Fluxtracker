import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #432, end to end with the REAL circuit breaker (Supabase mode) and the real
 * dbCallTracker: a Flux daemon/explorer outage that fails every revenue pass must leave the
 * database breaker CLOSED. Before, each failed pass counted against the database, five of
 * them tripped it OPEN, and with a failover configured the app switched away from a healthy
 * primary.
 */

vi.mock('../../db/supabaseClient.js', () => ({
    switchTo: vi.fn(() => ({ success: true, changed: true, previous: 'primary', active: 'failover' })),
    hasFailover: vi.fn(() => true),
    getActiveInstanceName: vi.fn(() => 'primary')
}));

const mockFetchRevenueStats = vi.fn();
vi.mock('../revenueService.js', () => ({
    fetchRevenueStats: (...args) => mockFetchRevenueStats(...args),
    auditRecentTransactions: vi.fn(async () => ({ recovered: 0, missingFound: 0 }))
}));
vi.mock('../priceHistoryService.js', () => ({ backfillNullUsdAmounts: vi.fn(async () => ({ updated: 0 })) }));

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let scheduler, breaker, client;
const originalDbType = process.env.DB_TYPE;

beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    delete process.env.DB_TYPE; // the breaker is a no-op in SQLite mode
    breaker = await import('../../db/circuitBreaker.js');
    client = await import('../../db/supabaseClient.js');
    scheduler = await import('../revenueScheduler.js');
    client.switchTo.mockClear();
});

afterEach(() => {
    scheduler.stopRevenueSync();
    vi.useRealTimers();
    if (originalDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = originalDbType;
});

describe('revenue passes and the database breaker (issue #432)', () => {
    it('six passes failing on the block height leave the breaker CLOSED', async () => {
        mockFetchRevenueStats.mockRejectedValue(new Error('Could not fetch current block height'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 5);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(6);
        expect(breaker.getCircuitState()).toMatchObject({ state: 'CLOSED', failureCount: 0 });
        expect(client.switchTo).not.toHaveBeenCalled();
    });

    it('six passes failing on the database still trip it', async () => {
        mockFetchRevenueStats.mockRejectedValue(Object.assign(new Error('fetch failed'), { isDatabaseError: true }));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 5);

        expect(breaker.getCircuitState().state).toBe('OPEN');
    });
});

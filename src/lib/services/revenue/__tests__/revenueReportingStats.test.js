import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * revenueReportingPeriods.test.js covers the month/yesterday boundary functions (issue #224).
 * These are the other three exports -- the ones that produce the headline revenue figures and
 * that testAllServices.test.js mocks away, so nothing ever executed them (issue #225).
 */

const mockGetRevenueForDateRange = vi.fn();
const mockUpdateCurrentMetrics = vi.fn();
const mockUpdateSyncStatus = vi.fn();
const mockCountTxidsWithoutAppName = vi.fn();
vi.mock('../../../db/database.js', () => ({
    updateCurrentMetrics: (...a) => mockUpdateCurrentMetrics(...a),
    updateSyncStatus: (...a) => mockUpdateSyncStatus(...a),
    getRevenueForDateRange: (...a) => mockGetRevenueForDateRange(...a),
    getPaymentCountForDateRange: vi.fn(),
    countTxidsWithoutAppName: (...a) => mockCountTxidsWithoutAppName(...a)
}));

const mockSetRevenueSyncRunning = vi.fn();
const mockSetRevenueSyncError = vi.fn();
vi.mock('../revenueSyncState.js', () => ({
    setRevenueSyncRunning: (...a) => mockSetRevenueSyncRunning(...a),
    setRevenueSyncError: (...a) => mockSetRevenueSyncError(...a)
}));

const mockFetchFluxPrice = vi.fn();
vi.mock('../../fluxNetworkData.js', () => ({
    fetchFluxPrice: (...a) => mockFetchFluxPrice(...a)
}));

const mockProgressiveSync = vi.fn();
vi.mock('../transactionSync.js', () => ({
    progressiveSync: (...a) => mockProgressiveSync(...a)
}));

const mockBackfillAppTypes = vi.fn();
const mockBackfillAppNames = vi.fn();
vi.mock('../revenueBackfill.js', () => ({
    backfillAppTypes: (...a) => mockBackfillAppTypes(...a),
    backfillAppNames: (...a) => mockBackfillAppNames(...a)
}));

import { getRevenueBreakdown, fetchRevenueStats, formatRevenueStats } from '../revenueReporting.js';

/** Midday UTC, so the UTC date and the local date agree in every timezone CI or dev uses. */
const NOW = new Date('2026-03-15T12:00:00.000Z');

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockGetRevenueForDateRange.mockResolvedValue(0);
    mockFetchFluxPrice.mockResolvedValue(0.05);
    mockProgressiveSync.mockResolvedValue(undefined);
    mockCountTxidsWithoutAppName.mockResolvedValue(0);
    mockBackfillAppTypes.mockResolvedValue(undefined);
    mockBackfillAppNames.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('getRevenueBreakdown', () => {
    it('asks for one window per timeframe, each ending today', async () => {
        await getRevenueBreakdown();

        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2026-03-14', '2026-03-15'); // day
        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2026-03-08', '2026-03-15'); // week
        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2026-02-13', '2026-03-15'); // month
        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2025-12-15', '2026-03-15'); // quarter
        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2025-03-15', '2026-03-15'); // year
        expect(mockGetRevenueForDateRange).toHaveBeenCalledTimes(5);
    });

    it('returns the five timeframes keyed by name', async () => {
        mockGetRevenueForDateRange
            .mockResolvedValueOnce(10)
            .mockResolvedValueOnce(70)
            .mockResolvedValueOnce(300)
            .mockResolvedValueOnce(900)
            .mockResolvedValueOnce(3650);

        expect(await getRevenueBreakdown()).toEqual({
            day: 10, week: 70, month: 300, quarter: 900, year: 3650
        });
    });

    it('reports a failed timeframe as 0 rather than failing the whole breakdown', async () => {
        // Worth knowing rather than endorsing: a database error on one window is
        // indistinguishable from a genuinely quiet period in the response.
        mockGetRevenueForDateRange
            .mockResolvedValueOnce(10)
            .mockRejectedValueOnce(new Error('query timed out'))
            .mockResolvedValue(300);

        const breakdown = await getRevenueBreakdown();

        expect(breakdown.day).toBe(10);
        expect(breakdown.week).toBe(0);
        expect(breakdown.month).toBe(300);
    });
});

describe('fetchRevenueStats', () => {
    it('returns today\'s revenue with the price it fetched', async () => {
        mockFetchFluxPrice.mockResolvedValue(0.0625);
        mockGetRevenueForDateRange.mockResolvedValue(1234.5);

        const stats = await fetchRevenueStats();

        expect(stats).toEqual({ current_revenue: 1234.5, flux_price_usd: 0.0625 });
    });

    it('reads today only, not a range', async () => {
        await fetchRevenueStats();

        expect(mockGetRevenueForDateRange).toHaveBeenCalledWith('2026-03-15', '2026-03-15');
    });

    it('imports new transactions before reading the total', async () => {
        const order = [];
        mockProgressiveSync.mockImplementation(async () => { order.push('sync'); });
        mockGetRevenueForDateRange.mockImplementation(async () => { order.push('read'); return 1; });

        await fetchRevenueStats();

        expect(order).toEqual(['sync', 'read']);
    });

    it('persists the revenue it computed', async () => {
        mockGetRevenueForDateRange.mockResolvedValue(99);

        await fetchRevenueStats();

        expect(mockUpdateCurrentMetrics).toHaveBeenCalledWith(expect.objectContaining({
            current_revenue: 99
        }));
    });

    it('backfills app names only when some rows are actually missing one', async () => {
        mockCountTxidsWithoutAppName.mockResolvedValue(0);

        await fetchRevenueStats();

        expect(mockBackfillAppNames).not.toHaveBeenCalled();
    });

    it('backfills recent app names in a bounded batch when rows are missing', async () => {
        // Bounded to 30 days on purpose: older NULLs are direct payments with no OP_RETURN
        // hash and will never resolve, so an unbounded pass would re-scan them every cycle.
        mockCountTxidsWithoutAppName.mockResolvedValue(12);

        await fetchRevenueStats();

        expect(mockCountTxidsWithoutAppName).toHaveBeenCalledWith(30);
        expect(mockBackfillAppNames).toHaveBeenCalledWith(500, 30, true);
    });

    it('always backfills app types', async () => {
        await fetchRevenueStats();

        expect(mockBackfillAppTypes).toHaveBeenCalledTimes(1);
    });

    it('clears the running flag on the way out', async () => {
        await fetchRevenueStats();

        expect(mockSetRevenueSyncRunning).toHaveBeenNthCalledWith(1, true);
        expect(mockSetRevenueSyncRunning).toHaveBeenLastCalledWith(false);
    });

    it('clears the running flag on failure too, and records why', async () => {
        // A stuck running flag is what /api/revenue-status reports as a sync in progress
        // forever.
        const failure = new Error('supabase unreachable');
        mockProgressiveSync.mockRejectedValue(failure);

        await expect(fetchRevenueStats()).rejects.toThrow('supabase unreachable');

        expect(mockSetRevenueSyncRunning).toHaveBeenLastCalledWith(false);
        expect(mockSetRevenueSyncError).toHaveBeenCalledWith(failure);
        expect(mockUpdateSyncStatus).toHaveBeenCalledWith('revenue', 'failed', 'supabase unreachable', null);
    });

    it('does not persist metrics when the sync failed', async () => {
        mockProgressiveSync.mockRejectedValue(new Error('supabase unreachable'));

        await expect(fetchRevenueStats()).rejects.toThrow();

        expect(mockUpdateCurrentMetrics).not.toHaveBeenCalled();
    });
});

describe('formatRevenueStats', () => {
    it('renders FLUX, USD and price for display', () => {
        expect(formatRevenueStats({ current_revenue: 1234.5678 }, 0.0625)).toEqual({
            flux: '1234.57 FLUX',
            usd: '$77.16',
            price: '$0.0625'
        });
    });

    it('prefers the price passed in over the one stored on the data', () => {
        const formatted = formatRevenueStats({ current_revenue: 100, flux_price_usd: 0.01 }, 0.05);

        expect(formatted.usd).toBe('$5.00');
        expect(formatted.price).toBe('$0.0500');
    });

    it('falls back to the stored price when none is passed', () => {
        const formatted = formatRevenueStats({ current_revenue: 100, flux_price_usd: 0.01 });

        expect(formatted.usd).toBe('$1.00');
    });

    it('says N/A rather than $0.00 when no price is available', () => {
        // $0.00 would read as "these transactions were worthless" instead of "we could not
        // price them".
        const formatted = formatRevenueStats({ current_revenue: 500 }, 0);

        expect(formatted.flux).toBe('500.00 FLUX');
        expect(formatted.usd).toBe('N/A');
        expect(formatted.price).toBe('N/A');
    });

    it('treats a missing revenue figure as zero', () => {
        expect(formatRevenueStats({}, 0.05).flux).toBe('0.00 FLUX');
    });
});

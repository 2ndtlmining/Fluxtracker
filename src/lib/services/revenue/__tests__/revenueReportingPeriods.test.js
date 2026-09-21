import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #224 — revenueReporting's month boundaries had the same local-vs-UTC mismatch as
 * /api/revenue/:period: `new Date(y, m, 1)` and `new Date(y, m, 0)` are local-time
 * constructors, serialized with `.toISOString()`, compared against a `date` column that is
 * unambiguously UTC.
 *
 * This module had no tests at all -- nine exported functions producing headline revenue
 * figures, stubbed out wherever they appear elsewhere in the suite. These pin the six that
 * compute a date range; the rest is #225's scope.
 *
 * TZ is Australia/Sydney (UTC+10) and the clock 20:00 UTC, which is the next day locally.
 * Under TZ=UTC the old code and the new agree, so the zone has to be forced or the test
 * proves nothing.
 */

process.env.TZ = 'Australia/Sydney';

vi.mock('../../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn(),
    getRevenueForDateRange: vi.fn(async () => 100),
    getPaymentCountForDateRange: vi.fn(async () => 7),
    countTxidsWithoutAppName: vi.fn(async () => 0)
}));
vi.mock('../revenueSyncState.js', () => ({
    setRevenueSyncRunning: vi.fn(),
    setRevenueSyncError: vi.fn()
}));
vi.mock('../../fluxNetworkData.js', () => ({ fetchFluxPrice: vi.fn(async () => 0.06) }));
vi.mock('../transactionSync.js', () => ({ progressiveSync: vi.fn() }));
vi.mock('../revenueBackfill.js', () => ({ backfillAppTypes: vi.fn(), backfillAppNames: vi.fn() }));

import { getRevenueForDateRange, getPaymentCountForDateRange } from '../../../db/database.js';
import {
    calculateMonthlyRevenue,
    calculatePreviousMonthRevenue,
    getMonthlyPaymentCount,
    getPreviousMonthPaymentCount,
    calculateYesterdayRevenue,
    getYesterdayPaymentCount
} from '../revenueReporting.js';

// 2026-09-21 20:00 UTC == 2026-09-22 06:00 in Sydney.
const NOW = new Date('2026-09-21T20:00:00Z');

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('month boundaries are UTC (issue #224)', () => {
    it('calculateMonthlyRevenue sums the 1st of this UTC month to today', async () => {
        // The bug asked for 2026-08-31 .. 2026-09-21, folding 31 August into September.
        await calculateMonthlyRevenue();

        expect(getRevenueForDateRange).toHaveBeenCalledWith('2026-09-01', '2026-09-21');
    });

    it('calculatePreviousMonthRevenue sums the whole previous UTC month', async () => {
        // The bug asked for 2026-07-31 .. 2026-08-30: 31 July pulled in, and 31 August
        // counted in this period AND the current one.
        await calculatePreviousMonthRevenue();

        expect(getRevenueForDateRange).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    });

    it('getMonthlyPaymentCount uses the same month as the revenue it sits beside', async () => {
        await getMonthlyPaymentCount();

        expect(getPaymentCountForDateRange).toHaveBeenCalledWith('2026-09-01', '2026-09-21');
    });

    it('getPreviousMonthPaymentCount uses the same previous month', async () => {
        await getPreviousMonthPaymentCount();

        expect(getPaymentCountForDateRange).toHaveBeenCalledWith('2026-08-01', '2026-08-31');
    });
});

describe('yesterday is the previous UTC day (issue #224)', () => {
    it('calculateYesterdayRevenue reads one UTC day back', async () => {
        await calculateYesterdayRevenue();

        expect(getRevenueForDateRange).toHaveBeenCalledWith('2026-09-20', '2026-09-20');
    });

    it('getYesterdayPaymentCount reads the same day', async () => {
        await getYesterdayPaymentCount();

        expect(getPaymentCountForDateRange).toHaveBeenCalledWith('2026-09-20', '2026-09-20');
    });

    it('holds across a DST transition, where a local -1 day is 23 or 25 hours', async () => {
        // 2026-10-04 is when Sydney springs forward. Stepping back one LOCAL day here is
        // 23 hours, which can land on the wrong UTC date.
        vi.setSystemTime(new Date('2026-10-04T13:30:00Z'));

        await calculateYesterdayRevenue();

        expect(getRevenueForDateRange).toHaveBeenCalledWith('2026-10-03', '2026-10-03');
    });
});

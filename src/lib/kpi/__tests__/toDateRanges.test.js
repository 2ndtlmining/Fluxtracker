import { describe, it, expect } from 'vitest';
import { getToDateRanges } from '../periods.js';

/**
 * Issue #224 — /api/revenue/:period built its calendar boundaries with LOCAL-time
 * constructors (`new Date(y, m, 1)`, `getDay()`, `new Date(y, m, 0)`) and then serialized
 * them with `.toISOString()`, which is UTC. `revenue_transactions.date` is unambiguously
 * UTC (transactionSync.js derives it from toISOString()), so outside UTC the sums covered
 * the wrong days.
 *
 * TZ is pinned to Australia/Sydney (UTC+10) and the clock to 20:00 UTC, which is the next
 * day locally -- the exact condition that shifts every boundary by one. Under TZ=UTC the
 * buggy code and the correct code agree, which is why this shipped unnoticed and why the
 * test has to force a non-UTC zone.
 *
 * These ranges are the IN-PROGRESS period to date versus the full previous period, which
 * is what this endpoint reports. getPeriodRanges() answers a different question (two
 * COMPLETED periods, for KPI reports) and is left alone.
 */

process.env.TZ = 'Australia/Sydney';

// 2026-09-21 20:00 UTC == 2026-09-22 06:00 in Sydney. UTC says the 21st; local says the 22nd.
const NOW = new Date('2026-09-21T20:00:00Z');

describe('getToDateRanges — UTC boundaries under a non-UTC host (issue #224)', () => {
    it('daily: today, and yesterday to compare', () => {
        expect(getToDateRanges('daily', NOW)).toEqual({
            current: { start: '2026-09-21', end: '2026-09-21' },
            previous: { start: '2026-09-20', end: '2026-09-20' }
        });
    });

    it('weekly: this ISO week to date, and the whole previous week', () => {
        // 2026-09-21 is a Monday in UTC, so the in-progress week is one day old.
        expect(getToDateRanges('weekly', NOW)).toEqual({
            current: { start: '2026-09-21', end: '2026-09-21' },
            previous: { start: '2026-09-14', end: '2026-09-20' }
        });
    });

    it('monthly: month to date, and the whole previous month', () => {
        // The bug produced current 2026-08-31..2026-09-21 (31 August summed into
        // September) and previous 2026-07-31..2026-08-30 (31 July pulled in, 31 August
        // counted in BOTH periods).
        expect(getToDateRanges('monthly', NOW)).toEqual({
            current: { start: '2026-09-01', end: '2026-09-21' },
            previous: { start: '2026-08-01', end: '2026-08-31' }
        });
    });

    it('quarterly: quarter to date, and the whole previous quarter', () => {
        expect(getToDateRanges('quarterly', NOW)).toEqual({
            current: { start: '2026-07-01', end: '2026-09-21' },
            previous: { start: '2026-04-01', end: '2026-06-30' }
        });
    });

    it('yearly: year to date, and the whole previous year', () => {
        expect(getToDateRanges('yearly', NOW)).toEqual({
            current: { start: '2026-01-01', end: '2026-09-21' },
            previous: { start: '2025-01-01', end: '2025-12-31' }
        });
    });
});

describe('getToDateRanges — calendar edges', () => {
    it('rolls the year back for Q1', () => {
        expect(getToDateRanges('quarterly', new Date('2026-02-10T00:00:00Z'))).toEqual({
            current: { start: '2026-01-01', end: '2026-02-10' },
            previous: { start: '2025-10-01', end: '2025-12-31' }
        });
    });

    it('rolls the year back for January', () => {
        expect(getToDateRanges('monthly', new Date('2026-01-05T00:00:00Z'))).toEqual({
            current: { start: '2026-01-01', end: '2026-01-05' },
            previous: { start: '2025-12-01', end: '2025-12-31' }
        });
    });

    it('gets February right in a leap year', () => {
        expect(getToDateRanges('monthly', new Date('2024-03-15T00:00:00Z')).previous)
            .toEqual({ start: '2024-02-01', end: '2024-02-29' });
    });

    it('treats Sunday as the last day of the ISO week, not the first', () => {
        // 2026-09-20 is a Sunday. The in-progress week must still start on the 14th.
        expect(getToDateRanges('weekly', new Date('2026-09-20T12:00:00Z'))).toEqual({
            current: { start: '2026-09-14', end: '2026-09-20' },
            previous: { start: '2026-09-07', end: '2026-09-13' }
        });
    });

    it('rejects an unknown timeframe', () => {
        expect(() => getToDateRanges('fortnightly', NOW)).toThrow(/fortnightly/);
    });
});

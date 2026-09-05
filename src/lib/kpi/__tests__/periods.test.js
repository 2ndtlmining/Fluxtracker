import { describe, it, expect } from 'vitest';
import { getPeriodRanges, formatPeriod, dayCount, enumerateDates } from '../periods.js';

/** Fixed "today" in UTC. */
const at = (iso) => new Date(`${iso}T12:00:00Z`);

/** Compact assertion: ranges as "start..end". */
const ranges = (tf, iso) => {
    const r = getPeriodRanges(tf, at(iso));
    return [`${r.current.start}..${r.current.end}`, `${r.comparison.start}..${r.comparison.end}`];
};

describe('getPeriodRanges — weekly (Mon-Sun, last completed week)', () => {
    it('mid-week: uses the week that ended last Sunday', () => {
        // Friday 2026-08-21 -> completed week Mon 10th - Sun 16th
        expect(ranges('weekly', '2026-08-21')).toEqual([
            '2026-08-10..2026-08-16',
            '2026-08-03..2026-08-09'
        ]);
    });

    it('today is Monday: the week that just ended, not the one starting today', () => {
        expect(ranges('weekly', '2026-08-17')).toEqual([
            '2026-08-10..2026-08-16',
            '2026-08-03..2026-08-09'
        ]);
    });

    it('today is Sunday: excludes the in-progress week that ends today', () => {
        // Sunday 2026-08-16 is the last day of its own week, which is not complete yet
        expect(ranges('weekly', '2026-08-16')).toEqual([
            '2026-08-03..2026-08-09',
            '2026-07-27..2026-08-02'
        ]);
    });

    it('crosses a year boundary cleanly', () => {
        expect(ranges('weekly', '2026-01-02')).toEqual([
            '2025-12-22..2025-12-28',
            '2025-12-15..2025-12-21'
        ]);
    });

    it('always produces two 7-day periods', () => {
        for (const day of ['2026-08-21', '2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31']) {
            const r = getPeriodRanges('weekly', at(day));
            expect(dayCount(r.current.start, r.current.end)).toBe(7);
            expect(dayCount(r.comparison.start, r.comparison.end)).toBe(7);
        }
    });
});

describe('getPeriodRanges — monthly (calendar month)', () => {
    it('mid-month: last completed month vs the one before', () => {
        expect(ranges('monthly', '2026-08-21')).toEqual([
            '2026-07-01..2026-07-31',
            '2026-06-01..2026-06-30'
        ]);
    });

    it('1st of the month', () => {
        expect(ranges('monthly', '2026-08-01')).toEqual([
            '2026-07-01..2026-07-31',
            '2026-06-01..2026-06-30'
        ]);
    });

    it('last day of the month still excludes that month', () => {
        expect(ranges('monthly', '2026-08-31')).toEqual([
            '2026-07-01..2026-07-31',
            '2026-06-01..2026-06-30'
        ]);
    });

    it('handles February in a leap year', () => {
        // March 2024 -> current Feb 2024 (29 days), comparison Jan 2024
        expect(ranges('monthly', '2024-03-15')).toEqual([
            '2024-02-01..2024-02-29',
            '2024-01-01..2024-01-31'
        ]);
    });

    it('handles February in a non-leap year', () => {
        expect(ranges('monthly', '2026-03-15')).toEqual([
            '2026-02-01..2026-02-28',
            '2026-01-01..2026-01-31'
        ]);
    });

    it('crosses the year boundary in January', () => {
        expect(ranges('monthly', '2026-01-01')).toEqual([
            '2025-12-01..2025-12-31',
            '2025-11-01..2025-11-30'
        ]);
    });

    it('crosses the year boundary in February', () => {
        expect(ranges('monthly', '2026-02-10')).toEqual([
            '2026-01-01..2026-01-31',
            '2025-12-01..2025-12-31'
        ]);
    });
});

describe('getPeriodRanges — quarterly (calendar quarters)', () => {
    it('in Q3 -> compares Q2 against Q1', () => {
        expect(ranges('quarterly', '2026-08-21')).toEqual([
            '2026-04-01..2026-06-30',
            '2026-01-01..2026-03-31'
        ]);
    });

    it('in Q1 -> compares Q4 and Q3 of last year', () => {
        expect(ranges('quarterly', '2026-01-01')).toEqual([
            '2025-10-01..2025-12-31',
            '2025-07-01..2025-09-30'
        ]);
    });

    it('on the last day of Q4 still excludes Q4', () => {
        expect(ranges('quarterly', '2026-12-31')).toEqual([
            '2026-07-01..2026-09-30',
            '2026-04-01..2026-06-30'
        ]);
    });

    it('on the first day of Q2', () => {
        expect(ranges('quarterly', '2026-04-01')).toEqual([
            '2026-01-01..2026-03-31',
            '2025-10-01..2025-12-31'
        ]);
    });
});

describe('getPeriodRanges — yearly (calendar year)', () => {
    it('compares the last completed year against the one before', () => {
        expect(ranges('yearly', '2026-08-21')).toEqual([
            '2025-01-01..2025-12-31',
            '2024-01-01..2024-12-31'
        ]);
    });

    it('on Jan 1 the year that just ended is the current period', () => {
        expect(ranges('yearly', '2026-01-01')).toEqual([
            '2025-01-01..2025-12-31',
            '2024-01-01..2024-12-31'
        ]);
    });

    it('on Dec 31 the in-progress year is still excluded', () => {
        expect(ranges('yearly', '2026-12-31')).toEqual([
            '2025-01-01..2025-12-31',
            '2024-01-01..2024-12-31'
        ]);
    });
});

describe('getPeriodRanges — daily (last completed UTC day)', () => {
    it('compares yesterday against the day before it', () => {
        expect(ranges('daily', '2026-08-21')).toEqual([
            '2026-08-20..2026-08-20',
            '2026-08-19..2026-08-19'
        ]);
    });

    it('just after midnight UTC: yesterday is still the last completed day', () => {
        const r = getPeriodRanges('daily', new Date('2026-08-21T00:05:00Z'));
        expect(r.current).toEqual({ start: '2026-08-20', end: '2026-08-20' });
        expect(r.comparison).toEqual({ start: '2026-08-19', end: '2026-08-19' });
    });

    it('on Jan 1 the last day of the previous year is the current period', () => {
        expect(ranges('daily', '2026-01-01')).toEqual([
            '2025-12-31..2025-12-31',
            '2025-12-30..2025-12-30'
        ]);
    });

    it('crosses a leap day cleanly', () => {
        expect(ranges('daily', '2024-03-01')).toEqual([
            '2024-02-29..2024-02-29',
            '2024-02-28..2024-02-28'
        ]);
    });

    it('labels the period "Day" and formats as a single date', () => {
        const r = getPeriodRanges('daily', at('2026-08-21'));
        expect(r.label).toBe('Day');
        expect(formatPeriod('daily', r.current)).toBe('Aug 20, 2026');
    });
});

describe('getPeriodRanges — invariants', () => {
    it('the comparison period always ends the day before the current one starts', () => {
        for (const tf of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
            for (const day of ['2026-08-21', '2026-01-01', '2026-12-31', '2024-02-29']) {
                const r = getPeriodRanges(tf, at(day));
                const gap = dayCount(r.comparison.end, r.current.start);
                expect(gap, `${tf} @ ${day}`).toBe(2); // inclusive count of [end, start]
            }
        }
    });

    it('the current period always ends strictly before today', () => {
        for (const tf of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
            const r = getPeriodRanges(tf, at('2026-08-21'));
            expect(r.current.end < '2026-08-21', `${tf}`).toBe(true);
        }
    });

    it('rejects an unknown timeframe', () => {
        expect(() => getPeriodRanges('fortnightly', at('2026-08-21'))).toThrow(/Unknown timeframe/);
    });
});

describe('formatPeriod', () => {
    it('formats a week within one month', () => {
        expect(formatPeriod('weekly', { start: '2026-08-10', end: '2026-08-16' }))
            .toBe('Aug 10-16, 2026');
    });

    it('formats a week spanning two months', () => {
        expect(formatPeriod('weekly', { start: '2026-07-27', end: '2026-08-02' }))
            .toBe('Jul 27-Aug 2, 2026');
    });

    it('formats month, quarter and year', () => {
        expect(formatPeriod('monthly', { start: '2026-07-01', end: '2026-07-31' })).toBe('Jul 2026');
        expect(formatPeriod('quarterly', { start: '2026-04-01', end: '2026-06-30' })).toBe('Q2 2026');
        expect(formatPeriod('yearly', { start: '2025-01-01', end: '2025-12-31' })).toBe('2025');
    });
});

describe('date helpers', () => {
    it('dayCount is inclusive', () => {
        expect(dayCount('2026-08-10', '2026-08-16')).toBe(7);
        expect(dayCount('2026-08-10', '2026-08-10')).toBe(1);
        expect(dayCount('2026-01-01', '2026-12-31')).toBe(365);
        expect(dayCount('2024-01-01', '2024-12-31')).toBe(366);
    });

    it('enumerateDates covers the inclusive range', () => {
        expect(enumerateDates('2026-08-10', '2026-08-13')).toEqual([
            '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'
        ]);
        expect(enumerateDates('2026-02-27', '2026-03-01')).toEqual([
            '2026-02-27', '2026-02-28', '2026-03-01'
        ]);
    });
});

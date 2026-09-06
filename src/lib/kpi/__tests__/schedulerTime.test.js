import { describe, it, expect } from 'vitest';
import {
    utcDayKey,
    isoWeekKey,
    monthlyKey,
    quarterlyKey,
    yearlyKey,
    periodKey,
    isDue
} from '../schedulerTime.js';

const ms = iso => Date.parse(`${iso}Z`);

describe('utcDayKey', () => {
    it('formats a UTC day key', () => {
        expect(utcDayKey(ms('2026-09-05T03:14:15'))).toBe('2026-09-05');
    });
});

describe('isoWeekKey', () => {
    it('keys a normal week', () => {
        // Friday 2026-08-21 belongs to Mon Aug 17 - Sun Aug 23
        expect(isoWeekKey(ms('2026-08-21T12:00'))).toBe('2026-W34');
    });

    it('pins the ISO year on the week: 2024-12-30 belongs to 2025-W01', () => {
        expect(isoWeekKey(ms('2024-12-30T12:00'))).toBe('2025-W01');
    });

    it('Jan 1 2026 (a Thursday) is 2026-W01', () => {
        expect(isoWeekKey(ms('2026-01-01T12:00'))).toBe('2026-W01');
    });

    it('is stable across the week and changes at the Monday boundary', () => {
        const wednesday = ms('2026-08-12T12:00');   // same ISO week as its Sunday
        const sunday = ms('2026-08-16T12:00');      // last day of that week (W33)
        const monday = ms('2026-08-17T12:00');      // first day of the next one (W34)
        expect(isoWeekKey(wednesday)).toBe(isoWeekKey(sunday));
        expect(isoWeekKey(sunday)).not.toBe(isoWeekKey(monday));
        expect(isoWeekKey(monday)).toBe(isoWeekKey(monday + 6 * 86400000));
    });
});

describe('periodKey', () => {
    it('daily uses the day key, weekly the ISO week key', () => {
        expect(periodKey('daily', ms('2026-09-05T03:00'))).toBe('2026-09-05');
        expect(periodKey('weekly', ms('2026-09-05T03:00'))).toBe('2026-W36');
    });

    it('monthly, quarterly and yearly use their calendar keys', () => {
        expect(periodKey('monthly', ms('2026-09-05T03:00'))).toBe('2026-09');
        expect(periodKey('quarterly', ms('2026-09-05T03:00'))).toBe('2026-Q3');
        expect(periodKey('yearly', ms('2026-09-05T03:00'))).toBe('2026');
        // Quarter and year rollovers
        expect(periodKey('quarterly', ms('2026-10-01T03:00'))).toBe('2026-Q4');
        expect(periodKey('yearly', ms('2026-01-01T03:00'))).toBe('2026');
    });
});

describe('isDue', () => {
    const HOUR = 2;

    it('is not due before the configured hour', () => {
        expect(isDue('daily', ms('2026-09-05T01:59'), HOUR, null)).toBe(false);
    });

    it('is due at/after the hour when never sent', () => {
        expect(isDue('daily', ms('2026-09-05T02:00'), HOUR, null)).toBe(true);
        expect(isDue('daily', ms('2026-09-05T23:00'), HOUR, null)).toBe(true);
    });

    it('is not due when the receipt is from the same UTC day', () => {
        expect(isDue('daily', ms('2026-09-05T23:00'), HOUR, ms('2026-09-05T02:00'))).toBe(false);
    });

    it('is due when the receipt is from yesterday (the daily catch-up case)', () => {
        // Server was down at 02:00, came back at 14:00: still sends yesterday's report
        expect(isDue('daily', ms('2026-09-05T14:00'), HOUR, ms('2026-09-04T02:00'))).toBe(true);
    });

    it('weekly is not due while the receipt is from the same ISO week', () => {
        // Saturday, receipt from Friday: same ISO week (Mon Aug 31 - Sun Sep 6)
        expect(isDue('weekly', ms('2026-09-05T03:00'), HOUR, ms('2026-09-04T02:00'))).toBe(false);
    });

    it('weekly is due when the receipt is from the previous ISO week', () => {
        expect(isDue('weekly', ms('2026-09-05T03:00'), HOUR, ms('2026-08-28T02:00'))).toBe(true);
    });

    it('weekly catches up any day of the week (no Monday-only gate)', () => {
        // Missed Monday, server back Thursday: the period is complete, send it
        expect(isDue('weekly', ms('2026-09-03T03:00'), HOUR, ms('2026-08-28T02:00'))).toBe(true);
    });

    it('monthly is due once the calendar month has rolled over', () => {
        // Sep 1: August completed — the receipt from Aug 25 is a previous period
        expect(isDue('monthly', ms('2026-09-01T03:00'), HOUR, ms('2026-08-25T02:00'))).toBe(true);
        // Sent this month: not due again
        expect(isDue('monthly', ms('2026-09-20T03:00'), HOUR, ms('2026-09-01T02:00'))).toBe(false);
        // Before the hour: not due yet even on rollover day
        expect(isDue('monthly', ms('2026-09-01T01:00'), HOUR, ms('2026-08-25T02:00'))).toBe(false);
    });

    it('quarterly is due on quarter rollover', () => {
        expect(isDue('quarterly', ms('2026-10-01T03:00'), HOUR, ms('2026-09-20T02:00'))).toBe(true);
        expect(isDue('quarterly', ms('2026-10-05T03:00'), HOUR, ms('2026-10-01T02:00'))).toBe(false);
    });

    it('yearly is due on year rollover', () => {
        expect(isDue('yearly', ms('2026-01-01T03:00'), HOUR, ms('2025-12-20T02:00'))).toBe(true);
        expect(isDue('yearly', ms('2026-06-01T03:00'), HOUR, ms('2026-01-01T02:00'))).toBe(false);
    });
});

import { describe, it, expect } from 'vitest';
import { splitDateRange } from './dateWindows.js';

describe('splitDateRange (#390)', () => {
    it('keeps a short range as one window', () => {
        expect(splitDateRange('2026-01-01', '2026-03-31', 800)).toEqual([['2026-01-01', '2026-03-31']]);
    });

    it('splits a long range into contiguous, non-overlapping windows covering every day', () => {
        const w = splitDateRange('2022-01-01', '2026-09-26', 800);
        expect(w[0][0]).toBe('2022-01-01');
        expect(w.at(-1)[1]).toBe('2026-09-26');
        let days = 0;
        for (let i = 0; i < w.length; i++) {
            const span = (Date.parse(w[i][1]) - Date.parse(w[i][0])) / 86400000 + 1;
            expect(span).toBeLessThanOrEqual(800);
            days += span;
            if (i > 0) expect(Date.parse(w[i][0]) - Date.parse(w[i - 1][1])).toBe(86400000);
        }
        expect(days).toBe((Date.parse('2026-09-26') - Date.parse('2022-01-01')) / 86400000 + 1);
    });

    it('splits exactly at the window size', () => {
        expect(splitDateRange('2026-01-01', '2026-01-10', 5)).toEqual([['2026-01-01', '2026-01-05'], ['2026-01-06', '2026-01-10']]);
        expect(splitDateRange('2026-01-01', '2026-01-11', 5)).toHaveLength(3);
    });

    it('does not explode a far-future sentinel end date', () => {
        const w = splitDateRange('2024-05-13', '9999-12-31', 800);
        expect(w.length).toBeLessThanOrEqual(3);
        expect(w.at(-1)[1]).toBe('9999-12-31');
    });

    it('passes a malformed or inverted range through untouched', () => {
        expect(splitDateRange('2026-02-01', '2026-01-01', 800)).toEqual([['2026-02-01', '2026-01-01']]);
        expect(splitDateRange('bad', '2026-01-01', 800)).toEqual([['bad', '2026-01-01']]);
    });
});

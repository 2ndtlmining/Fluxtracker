import { describe, it, expect } from 'vitest';
import { toColumnar, fromColumnar } from './columnar.js';

describe('columnar encoding (#389)', () => {
    it('round-trips rows, keeping nulls and zeros', () => {
        const rows = [
            { snapshot_date: '2026-09-01', node_total: 100, gaming_apps_total: 0, median_days_left: null },
            { snapshot_date: '2026-09-02', node_total: 101, gaming_apps_total: 3, median_days_left: 16 }
        ];
        const c = toColumnar(rows);
        expect(c.columns).toEqual(['snapshot_date', 'node_total', 'gaming_apps_total', 'median_days_left']);
        expect(c.rows[0]).toEqual(['2026-09-01', 100, 0, null]);
        expect(fromColumnar(c)).toEqual(rows);
    });

    it('handles an empty set', () => {
        expect(toColumnar([])).toEqual({ columns: [], rows: [] });
        expect(fromColumnar(toColumnar(null))).toEqual([]);
    });

    it('is much smaller than row objects for wide rows', () => {
        const wide = Array.from({ length: 100 }, (_, i) =>
            Object.fromEntries(Array.from({ length: 60 }, (_, c) => [`some_metric_column_${c}`, i + c])));
        expect(JSON.stringify(toColumnar(wide)).length).toBeLessThan(JSON.stringify(wide).length / 3);
    });
});

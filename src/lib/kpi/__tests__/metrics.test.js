import { describe, it, expect } from 'vitest';
import {
    averageColumn,
    computeChange,
    buildKpiDataset,
    formatValue,
    formatDelta,
    formatPercent,
    sumDaily,
    MIN_COVERAGE
} from '../metrics.js';

/** n snapshot rows carrying `value` in `column`. */
function snaps(column, values) {
    return values.map((v, i) => ({ snapshot_date: `2026-08-${String(i + 1).padStart(2, '0')}`, [column]: v }));
}

describe('averageColumn', () => {
    it('averages the days that have data', () => {
        const r = averageColumn(snaps('node_total', [10, 20, 30]), 'node_total', 3);
        expect(r.value).toBe(20);
        expect(r.covered).toBe(true);
    });

    it('treats zero as a failed snapshot, not a real reading', () => {
        // A live network never truly has 0 nodes — a zero means the service failed that day
        const r = averageColumn(snaps('node_total', [10, 0, 20]), 'node_total', 3);
        expect(r.value).toBe(15);
        expect(r.coveredDays).toBe(2);
    });

    it('marks a metric uncovered below the coverage threshold', () => {
        // 5 of 10 days = 50%, well under MIN_COVERAGE
        const r = averageColumn(snaps('total_apps', [1, 1, 1, 1, 1]), 'total_apps', 10);
        expect(r.covered).toBe(false);
        expect(MIN_COVERAGE).toBeGreaterThan(0.5);
    });

    it('tolerates a small number of missing days', () => {
        // 9 of 10 = 90%, exactly at the threshold
        const r = averageColumn(snaps('node_total', Array(9).fill(100)), 'node_total', 10);
        expect(r.covered).toBe(true);
    });

    it('reports no value at all when the column is empty across the period', () => {
        const r = averageColumn(snaps('gitapps_count', [0, 0, 0]), 'gitapps_count', 3);
        expect(r.value).toBeNull();
        expect(r.covered).toBe(false);
    });

    it('ignores non-numeric values', () => {
        const rows = [{ node_total: null }, { node_total: 10 }, { node_total: undefined }];
        expect(averageColumn(rows, 'node_total', 3).value).toBe(10);
    });
});

describe('computeChange', () => {
    it('computes absolute and percentage change to one decimal', () => {
        expect(computeChange(110, 100)).toEqual({ absolute: 10, percent: 10, note: null });
        expect(computeChange(95, 100)).toEqual({ absolute: -5, percent: -5, note: null });
        expect(computeChange(133, 100)).toMatchObject({ percent: 33 });
    });

    it('rounds to one decimal place', () => {
        expect(computeChange(123.456, 100).percent).toBe(23.5);
    });

    it('zero to zero is "No change", not a divide by zero', () => {
        expect(computeChange(0, 0)).toEqual({ absolute: 0, percent: 0, note: 'No change' });
    });

    it('zero to positive is "New", not Infinity', () => {
        const r = computeChange(50, 0);
        expect(r.percent).toBeNull();
        expect(r.note).toBe('New');
        expect(r.absolute).toBe(50);
    });

    it('handles a drop to zero', () => {
        expect(computeChange(0, 50)).toMatchObject({ absolute: -50, percent: -100 });
    });

    it('returns Insufficient data when either side is missing', () => {
        expect(computeChange(null, 100).note).toBe('Insufficient data');
        expect(computeChange(100, null).note).toBe('Insufficient data');
    });
});

describe('buildKpiDataset', () => {
    const current = { start: '2026-08-10', end: '2026-08-16' };   // 7 days
    const comparison = { start: '2026-08-03', end: '2026-08-09' }; // 7 days

    function makeSnapshots(overrides = {}) {
        return Array.from({ length: 7 }, (_, i) => ({
            snapshot_date: `2026-08-${String(10 + i).padStart(2, '0')}`,
            node_total: 6000,
            node_cumulus: 2800,
            node_nimbus: 1500,
            node_stratus: 1700,
            used_cpu_cores: 8800,
            used_ram_gb: 17,
            used_storage_gb: 250,
            total_apps: 6400,
            dockerapps_count: 6200,
            gitapps_count: 170,
            gaming_apps_total: 320,
            ...overrides
        }));
    }

    const revenue = { flux: 1000, usd: 42, days: 7 };

    it('produces all four sections with every metric', () => {
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: makeSnapshots(),
            comparisonSnapshots: makeSnapshots(),
            currentRevenue: revenue,
            comparisonRevenue: revenue
        });

        expect(d.sections.map(s => s.key)).toEqual(['revenue', 'nodes', 'resources', 'applications']);
        expect(d.totalMetrics).toBe(13);
        expect(d.availableMetrics).toBe(13);
        expect(d.empty).toBe(false);
    });

    it('sums revenue and averages the rest', () => {
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: makeSnapshots({ node_total: 6000 }),
            comparisonSnapshots: makeSnapshots({ node_total: 5000 }),
            currentRevenue: { flux: 1400, usd: 60 },
            comparisonRevenue: { flux: 700, usd: 30 }
        });

        const flux = d.sections[0].metrics.find(m => m.key === 'flux');
        expect(flux.current).toBe(1400);
        expect(flux.change.percent).toBe(100);

        const nodes = d.sections[1].metrics.find(m => m.key === 'total');
        expect(nodes.current).toBe(6000);      // average, not sum
        expect(nodes.comparison).toBe(5000);
        expect(nodes.change.percent).toBe(20);
    });

    it('marks only the uncovered metrics, leaving the rest of the section intact', () => {
        // The real Quarterly case: git/docker have no history, total/gaming do
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: makeSnapshots(),
            comparisonSnapshots: makeSnapshots({ gitapps_count: 0, dockerapps_count: 0 }),
            currentRevenue: revenue,
            comparisonRevenue: revenue
        });

        const apps = d.sections.find(s => s.key === 'applications');
        const byKey = Object.fromEntries(apps.metrics.map(m => [m.key, m]));

        expect(byKey.git.available).toBe(false);
        expect(byKey.docker.available).toBe(false);
        expect(byKey.total.available).toBe(true);
        expect(byKey.gaming.available).toBe(true);
        expect(apps.available).toBe(true);          // section still worth showing
        expect(d.empty).toBe(false);
        expect(d.availableMetrics).toBe(11);
    });

    it('never reports a metric when only one of the two periods has data', () => {
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: makeSnapshots(),
            comparisonSnapshots: [],           // no history at all
            currentRevenue: revenue,
            comparisonRevenue: revenue
        });

        const nodes = d.sections.find(s => s.key === 'nodes');
        expect(nodes.metrics.every(m => !m.available)).toBe(true);
        expect(nodes.metrics[0].current).toBeNull();
    });

    it('treats a genuinely zero-revenue period as valid data, not missing data', () => {
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: makeSnapshots(),
            comparisonSnapshots: makeSnapshots(),
            currentRevenue: { flux: 0, usd: 0 },
            comparisonRevenue: { flux: 0, usd: 0 }
        });

        const flux = d.sections[0].metrics.find(m => m.key === 'flux');
        expect(flux.available).toBe(true);
        expect(flux.change.note).toBe('No change');
    });

    it('flags an entirely empty dataset so the caller can refuse to send', () => {
        const d = buildKpiDataset({
            current, comparison,
            currentSnapshots: [],
            comparisonSnapshots: [],
            currentRevenue: { flux: 0, usd: 0 },
            comparisonRevenue: { flux: 0, usd: 0 }
        });

        // Revenue is always "covered", so only the snapshot metrics drop out
        expect(d.availableMetrics).toBe(2);
        expect(d.sections.filter(s => s.available).map(s => s.key)).toEqual(['revenue']);
    });
});

describe('formatting (no emoji, explicit signs)', () => {
    it('formats each value type', () => {
        expect(formatValue(1234.5, 'usd')).toBe('$1,234.50');
        expect(formatValue(1234.5, 'flux')).toBe('1,234.50');
        expect(formatValue(17.25, 'gb')).toBe('17.3 GB');
        expect(formatValue(8800.4, 'cores')).toBe('8,800 cores');
        expect(formatValue(6469.2, 'int')).toBe('6,469');
    });

    it('shows Insufficient data for a missing value', () => {
        expect(formatValue(null, 'int')).toBe('Insufficient data');
    });

    it('always signs the delta', () => {
        expect(formatDelta({ absolute: 212 }, 'int')).toBe('+212');
        expect(formatDelta({ absolute: -212 }, 'int')).toBe('-212');
        expect(formatDelta({ absolute: 0 }, 'int')).toBe('0');
    });

    it('always signs the percentage and keeps one decimal', () => {
        expect(formatPercent({ percent: 3.4 })).toBe('+3.4%');
        expect(formatPercent({ percent: -3.44 })).toBe('-3.4%');
        expect(formatPercent({ percent: 0 })).toBe('0.0%');
    });

    it('renders the zero-comparison note instead of a percentage', () => {
        expect(formatPercent({ percent: null, note: 'New' })).toBe('New');
    });

    it('uses no emoji anywhere', () => {
        const samples = [
            formatValue(1, 'usd'), formatDelta({ absolute: -1 }, 'int'),
            formatPercent({ percent: 5 }), formatPercent({ percent: null, note: 'New' })
        ].join(' ');
        expect(/\p{Extended_Pictographic}/u.test(samples)).toBe(false);
    });
});

describe('sumDaily', () => {
    it('sums a daily series and tolerates gaps', () => {
        expect(sumDaily([{ v: 1 }, { v: 2 }, {}, { v: null }], 'v')).toBe(3);
        expect(sumDaily([], 'v')).toBe(0);
    });
});

describe('revenue history floor', () => {
    const base = {
        currentSnapshots: [], comparisonSnapshots: [],
        currentRevenue: { flux: 100, usd: 5 },
        comparisonRevenue: { flux: 50, usd: 2 }
    };

    it('reports revenue when both periods start after transactions began', () => {
        const d = buildKpiDataset({
            ...base,
            current: { start: '2026-08-10', end: '2026-08-16' },
            comparison: { start: '2026-08-03', end: '2026-08-09' },
            earliestRevenueDate: '2024-05-13'
        });
        expect(d.sections[0].metrics.every(m => m.available)).toBe(true);
    });

    it('refuses revenue when the comparison period predates the transaction history', () => {
        // The real Yearly case: 2025 is complete, 2024 only starts in May, so summing 2024
        // would understate it and report growth that never happened.
        const d = buildKpiDataset({
            ...base,
            current: { start: '2025-01-01', end: '2025-12-31' },
            comparison: { start: '2024-01-01', end: '2024-12-31' },
            earliestRevenueDate: '2024-05-13'
        });
        expect(d.sections[0].metrics.every(m => m.available)).toBe(false);
        expect(d.empty).toBe(true);
    });

    it('treats revenue as covered when the history start is unknown', () => {
        const d = buildKpiDataset({
            ...base,
            current: { start: '2020-01-01', end: '2020-12-31' },
            comparison: { start: '2019-01-01', end: '2019-12-31' },
            earliestRevenueDate: null
        });
        expect(d.sections[0].metrics.every(m => m.available)).toBe(true);
    });
});

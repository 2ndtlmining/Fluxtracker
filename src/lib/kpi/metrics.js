/**
 * KPI metric definitions and period aggregation.
 *
 * Aggregation rules (see README "KPI Report" for the rationale):
 *
 *   Revenue          SUM across the period. Revenue accrues, so a period total is the only
 *                    meaningful figure — and it matches /api/revenue/:period exactly, which
 *                    is what the dashboard's revenue card shows.
 *
 *   Everything else  AVERAGE of that period's daily snapshots. Nodes, resources and app
 *                    counts are point-in-time values that fluctuate daily. Averaging keeps a
 *                    single failed snapshot (~37 days in the history have zeroed service
 *                    values) as a small distortion instead of defining the whole number,
 *                    which is what an end-of-period reading would do.
 *
 * A metric is only reported when BOTH periods have enough covered days. Coverage is counted
 * per metric, not per snapshot row, because the app-count columns were added to the schema
 * long after node and resource columns — older snapshots have the column but no value.
 */

import { dayCount } from './periods.js';

/** Fraction of a period's days that must carry data before the metric is reported. */
export const MIN_COVERAGE = 0.9;

/**
 * `column` is the daily_snapshots column. `format` drives presentation only.
 * Revenue is handled separately — it comes from revenue_transactions, not snapshots.
 */
export const SECTIONS = [
    {
        key: 'revenue',
        title: 'Revenue',
        source: 'revenue_transactions',
        aggregation: 'sum',
        metrics: [
            { key: 'flux', label: 'Flux', format: 'flux' },
            { key: 'usd', label: 'USD', format: 'usd' }
        ]
    },
    {
        key: 'nodes',
        title: 'Nodes',
        source: 'daily_snapshots',
        aggregation: 'average',
        metrics: [
            { key: 'total', label: 'Total', column: 'node_total', format: 'int' },
            { key: 'cumulus', label: 'Cumulus', column: 'node_cumulus', format: 'int' },
            { key: 'nimbus', label: 'Nimbus', column: 'node_nimbus', format: 'int' },
            { key: 'stratus', label: 'Stratus', column: 'node_stratus', format: 'int' }
        ]
    },
    {
        key: 'resources',
        title: 'Resource Utilization',
        source: 'daily_snapshots',
        aggregation: 'average',
        metrics: [
            { key: 'cpu', label: 'CPU used', column: 'used_cpu_cores', format: 'cores' },
            { key: 'ram', label: 'RAM used', column: 'used_ram_gb', format: 'gb' },
            { key: 'ssd', label: 'SSD used', column: 'used_storage_gb', format: 'gb' }
        ]
    },
    {
        key: 'applications',
        title: 'Applications',
        source: 'daily_snapshots',
        aggregation: 'average',
        metrics: [
            { key: 'total', label: 'Total Apps', column: 'total_apps', format: 'int' },
            { key: 'docker', label: 'Docker Apps', column: 'dockerapps_count', format: 'int' },
            { key: 'git', label: 'Git', column: 'gitapps_count', format: 'int' },
            { key: 'gaming', label: 'Gaming', column: 'gaming_apps_total', format: 'int' }
        ]
    }
];

/**
 * Average a snapshot column over a period, ignoring days with no value.
 *
 * Zero is treated as "no data" rather than a real reading: none of these metrics can
 * legitimately be zero on a live network (there are always nodes, always apps), so a zero
 * means the service that populates it failed that day.
 */
export function averageColumn(snapshots, column, expectedDays) {
    const values = snapshots
        .map(s => s[column])
        .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0);

    if (values.length === 0) {
        return { value: null, coveredDays: 0, expectedDays, covered: false };
    }

    const sum = values.reduce((a, b) => a + b, 0);
    return {
        value: sum / values.length,
        coveredDays: values.length,
        expectedDays,
        covered: values.length / expectedDays >= MIN_COVERAGE
    };
}

/** Sum a per-day series over a period. Missing days count as zero revenue, which is real. */
export function sumDaily(rows, valueKey) {
    return rows.reduce((sum, row) => sum + (row[valueKey] || 0), 0);
}

/**
 * Absolute and percentage change, with the divide-by-zero cases spelled out.
 * Returns `percent: null` where a percentage is meaningless, plus a `note` explaining it.
 */
export function computeChange(current, comparison) {
    if (current === null || comparison === null) {
        return { absolute: null, percent: null, note: 'Insufficient data' };
    }

    const absolute = current - comparison;

    if (comparison === 0) {
        if (current === 0) return { absolute: 0, percent: 0, note: 'No change' };
        return { absolute, percent: null, note: 'New' };
    }

    return {
        absolute,
        percent: Math.round((absolute / comparison) * 1000) / 10,
        note: null
    };
}

/**
 * Build the full KPI dataset for two periods.
 *
 * @param {object} input
 * @param {{start,end}} input.current
 * @param {{start,end}} input.comparison
 * @param {Array} input.currentSnapshots  daily_snapshots rows for the current period
 * @param {Array} input.comparisonSnapshots
 * @param {{flux:number, usd:number, days:number}} input.currentRevenue
 * @param {{flux:number, usd:number, days:number}} input.comparisonRevenue
 * @param {string|null} [input.earliestRevenueDate] first date we have any transaction for
 */
export function buildKpiDataset({
    current,
    comparison,
    currentSnapshots,
    comparisonSnapshots,
    currentRevenue,
    comparisonRevenue,
    earliestRevenueDate = null
}) {
    // A period that starts before we were recording transactions produces a partial sum,
    // which is far more misleading than showing nothing: comparing a full 2025 against a
    // 2024 that only starts in May would read as enormous growth that never happened.
    const revenueCovered = (period) =>
        !earliestRevenueDate || period.start >= earliestRevenueDate;

    const currentRevenueCovered = revenueCovered(current);
    const comparisonRevenueCovered = revenueCovered(comparison);
    const currentDays = dayCount(current.start, current.end);
    const comparisonDays = dayCount(comparison.start, comparison.end);

    const sections = SECTIONS.map(section => {
        const metrics = section.metrics.map(metric => {
            let cur;
            let cmp;

            if (section.key === 'revenue') {
                // A period with genuinely zero revenue is valid data, so revenue coverage
                // depends only on whether the period predates our transaction history.
                cur = {
                    value: currentRevenue[metric.key] ?? 0,
                    covered: currentRevenueCovered,
                    coveredDays: currentRevenueCovered ? currentDays : 0,
                    expectedDays: currentDays
                };
                cmp = {
                    value: comparisonRevenue[metric.key] ?? 0,
                    covered: comparisonRevenueCovered,
                    coveredDays: comparisonRevenueCovered ? comparisonDays : 0,
                    expectedDays: comparisonDays
                };
            } else {
                cur = averageColumn(currentSnapshots, metric.column, currentDays);
                cmp = averageColumn(comparisonSnapshots, metric.column, comparisonDays);
            }

            const available = cur.covered && cmp.covered;
            const currentValue = available ? cur.value : null;
            const comparisonValue = available ? cmp.value : null;

            return {
                key: metric.key,
                label: metric.label,
                format: metric.format,
                available,
                current: currentValue,
                comparison: comparisonValue,
                change: computeChange(currentValue, comparisonValue),
                coverage: {
                    current: { days: cur.coveredDays, of: cur.expectedDays },
                    comparison: { days: cmp.coveredDays, of: cmp.expectedDays }
                }
            };
        });

        return {
            key: section.key,
            title: section.title,
            aggregation: section.aggregation,
            source: section.source,
            metrics,
            available: metrics.some(m => m.available)
        };
    });

    const totalMetrics = sections.reduce((n, s) => n + s.metrics.length, 0);
    const availableMetrics = sections.reduce((n, s) => n + s.metrics.filter(m => m.available).length, 0);

    return {
        sections,
        availableMetrics,
        totalMetrics,
        // Nothing computable at all — the caller should refuse to send rather than deliver
        // an empty report.
        empty: availableMetrics === 0
    };
}

// ============================================
// FORMATTING
// ============================================

const INSUFFICIENT = 'Insufficient data';

export function formatValue(value, format) {
    if (value === null || value === undefined) return INSUFFICIENT;

    switch (format) {
        case 'usd':
            return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'flux':
            return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'gb':
            return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' GB';
        case 'cores':
            return Math.round(value).toLocaleString('en-US') + ' cores';
        case 'int':
        default:
            return Math.round(value).toLocaleString('en-US');
    }
}

/** Always signed, so direction is readable without color — no emoji, per spec. */
export function formatDelta(change, format) {
    if (!change || change.absolute === null) return INSUFFICIENT;

    const sign = change.absolute > 0 ? '+' : change.absolute < 0 ? '-' : '';
    const magnitude = formatValue(Math.abs(change.absolute), format);
    return `${sign}${magnitude}`;
}

export function formatPercent(change) {
    if (!change) return INSUFFICIENT;
    if (change.percent === null) return change.note || INSUFFICIENT;
    if (change.percent === 0) return '0.0%';

    const sign = change.percent > 0 ? '+' : '-';
    return `${sign}${Math.abs(change.percent).toFixed(1)}%`;
}

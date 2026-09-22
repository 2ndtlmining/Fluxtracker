import { describe, it, expect } from 'vitest';
import { comparisonWindows, shapeCurrentMetrics, buildComparisonResponse } from '../analytics.js';

/**
 * /api/analytics/comparison/:days had no coverage at all (issue #225): its logic was inline
 * in the route handler, so the window arithmetic that was the fix for #48 and the shaping
 * that feeds every card on the comparison row were unreachable from a test. Extracted here
 * for the same reason history.js exports shapeGameHistory.
 *
 * What makes this endpoint dangerous is that it renders perfectly when it is wrong -- #48
 * shipped as a comparison that silently compared today against a single day N days back, and
 * the page looked exactly the same.
 */

describe('comparisonWindows', () => {
    it('compares the last N days against the N before them', () => {
        const w = comparisonWindows('2026-09-22', 30);

        expect(w).toEqual({
            currentStart: '2026-08-24',
            currentEnd: '2026-09-22',
            previousStart: '2026-07-25',
            previousEnd: '2026-08-23',
            targetDate: '2026-08-23'
        });
    });

    it('makes the two windows adjacent and non-overlapping', () => {
        // The #48 bug in one assertion: no day may appear in both periods, and no day may
        // fall between them.
        for (const days of [1, 7, 30, 90, 365]) {
            const w = comparisonWindows('2026-09-22', days);
            const dayAfterPrevious = new Date(`${w.previousEnd}T00:00:00Z`);
            dayAfterPrevious.setUTCDate(dayAfterPrevious.getUTCDate() + 1);

            expect(dayAfterPrevious.toISOString().split('T')[0]).toBe(w.currentStart);
        }
    });

    it('gives both windows the same length', () => {
        const spanDays = (start, end) =>
            (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;

        for (const days of [1, 7, 30, 90, 365]) {
            const w = comparisonWindows('2026-09-22', days);

            expect(spanDays(w.currentStart, w.currentEnd)).toBe(days - 1);
            expect(spanDays(w.previousStart, w.previousEnd)).toBe(days - 1);
        }
    });

    it('treats one day as today against yesterday', () => {
        const w = comparisonWindows('2026-09-22', 1);

        expect(w.currentStart).toBe('2026-09-22');
        expect(w.currentEnd).toBe('2026-09-22');
        expect(w.previousStart).toBe('2026-09-21');
        expect(w.previousEnd).toBe('2026-09-21');
    });

    it('crosses month and year boundaries correctly', () => {
        expect(comparisonWindows('2026-01-02', 7).currentStart).toBe('2025-12-27');
        expect(comparisonWindows('2026-03-01', 1).previousStart).toBe('2026-02-28');
    });

    it('counts a leap day as a day', () => {
        expect(comparisonWindows('2024-03-01', 1).previousEnd).toBe('2024-02-29');
    });

    it('shifts in UTC, so a DST changeover cannot move a boundary', () => {
        // A local-time Date shifts by 23 or 25 hours across a changeover and lands on the
        // wrong day. These are the US and EU spring-forward dates.
        expect(comparisonWindows('2026-03-09', 1).previousEnd).toBe('2026-03-08');
        expect(comparisonWindows('2026-03-30', 1).previousEnd).toBe('2026-03-29');
    });

    it('points targetDate at the single day the snapshot comparison reads', () => {
        expect(comparisonWindows('2026-09-22', 30).targetDate).toBe('2026-08-23');
        expect(comparisonWindows('2026-09-22', 1).targetDate).toBe('2026-09-21');
    });
});

describe('shapeCurrentMetrics', () => {
    const RAW = {
        node_total: 12800, node_cumulus: 8000, node_nimbus: 3000, node_stratus: 1800,
        total_apps: 4200, gitapps_count: 400, dockerapps_count: 3800,
        gaming_apps_total: 900, gaming_minecraft: 300, gaming_palworld: 400, gaming_enshrouded: 200,
        crypto_nodes_total: 1500, crypto_presearch: 900, crypto_kaspa: 400, crypto_alephium: 200,
        cpu_utilization_percent: 61.5, ram_utilization_percent: 44.25, storage_utilization_percent: 30,
        wordpress_count: 120
    };

    it('nests the flat current_metrics row into the shape the frontend reads', () => {
        expect(shapeCurrentMetrics(RAW)).toEqual({
            nodes: { total: 12800, cumulus: 8000, nimbus: 3000, stratus: 1800 },
            apps: { total: 4200, gitapps: 400, dockerapps: 3800 },
            gaming: { total: 900, minecraft: 300, palworld: 400, enshrouded: 200 },
            crypto: { total: 1500, presearch: 900, kaspa: 400, alephium: 200 },
            cloud: {
                cpu: { utilization: 61.5 },
                ram: { utilization: 44.25 },
                storage: { utilization: 30 }
            },
            wordpress: { count: 120 }
        });
    });

    it('defaults the git/docker split to 0 when those columns are absent', () => {
        const shaped = shapeCurrentMetrics({ ...RAW, gitapps_count: null, dockerapps_count: undefined });

        expect(shaped.apps.gitapps).toBe(0);
        expect(shaped.apps.dockerapps).toBe(0);
    });

    it('passes a missing column through as undefined rather than inventing a zero', () => {
        // Deliberate: calculateChange treats a missing past value as a neutral 0, but the
        // current value staying undefined is what makes a renamed column visible instead of
        // silently reading as "the network has none of these".
        expect(shapeCurrentMetrics({}).nodes.total).toBeUndefined();
    });
});

describe('buildComparisonResponse', () => {
    const windows = comparisonWindows('2026-09-22', 30);

    const current = shapeCurrentMetrics({
        node_total: 12800, node_cumulus: 8000, node_nimbus: 3000, node_stratus: 1800,
        total_apps: 4200, gitapps_count: 400, dockerapps_count: 3800,
        gaming_apps_total: 900, gaming_minecraft: 300, gaming_palworld: 400, gaming_enshrouded: 200,
        crypto_nodes_total: 1500, crypto_presearch: 900, crypto_kaspa: 400, crypto_alephium: 200,
        cpu_utilization_percent: 60, ram_utilization_percent: 44.25, storage_utilization_percent: 30,
        wordpress_count: 120
    });

    const pastSnapshot = {
        node_total: 12000, node_cumulus: 7600, node_nimbus: 2900, node_stratus: 1900,
        total_apps: 4000, gitapps_count: 500, dockerapps_count: 3500,
        gaming_apps_total: 800, gaming_minecraft: 350, gaming_palworld: 300, gaming_enshrouded: 200,
        crypto_nodes_total: 1400, crypto_presearch: 900, crypto_kaspa: 300, crypto_alephium: 200,
        cpu_utilization_percent: 50, ram_utilization_percent: 44.25, storage_utilization_percent: 40,
        wordpress_count: 100,
        decentralization_datacenter_percent: 70,
        apps_deployed_today: 25, apps_expiring_today: 10
    };

    const build = (overrides = {}) => buildComparisonResponse({
        days: 30,
        windows,
        current,
        pastSnapshot,
        currentRevenue: 5000,
        previousRevenue: 4000,
        ...overrides
    });

    it('compares revenue period against period, and says which periods', () => {
        const { changes } = build();

        expect(changes.revenue).toEqual({
            change: 25,
            trend: 'up',
            current: 5000,
            previous: 4000,
            currentRange: { start: '2026-08-24', end: '2026-09-22' },
            previousRange: { start: '2026-07-25', end: '2026-08-23' }
        });
    });

    it('calls an empty previous period an absent baseline, not a 0% change', () => {
        const { changes } = build({ previousRevenue: 0 });

        expect(changes.revenue.note).toBe('No revenue data for 2026-07-25..2026-08-23');
        expect(changes.revenue.change).toBe(0);
        expect(changes.revenue.trend).toBe('neutral');
    });

    it('reports totals as percentages and members as raw differences', () => {
        const { changes } = build();

        expect(changes.nodes.change).toBeCloseTo(6.67, 2);  // 12000 -> 12800
        expect(changes.nodes.difference).toBe(800);
        expect(changes.nodes.cumulusChange).toBe(400);
        expect(changes.nodes.cumulusTrend).toBe('up');
        expect(changes.nodes.stratusChange).toBe(-100);
        expect(changes.nodes.stratusTrend).toBe('down');
        expect(changes.nodes.nimbusChange).toBe(100);
    });

    it('calls an unchanged member neutral', () => {
        const { changes } = build();

        expect(changes.gaming.enshroudedChange).toBe(0);
        expect(changes.gaming.enshroudedTrend).toBe('neutral');
        expect(changes.crypto.presearchChange).toBe(0);
        expect(changes.crypto.presearchTrend).toBe('neutral');
    });

    it('covers every card the comparison row renders', () => {
        const { changes } = build();

        for (const key of ['revenue', 'nodes', 'apps', 'cpu', 'ram', 'storage', 'gaming', 'crypto', 'wordpress']) {
            expect(changes).toHaveProperty(key);
        }
    });

    it('includes the live sections when their reads succeeded', () => {
        const { changes } = build({
            decentralization: { datacenterPercent: 63 },
            activity: {
                deployedToday: { cached: true, apps: new Array(30) },
                expiring24h: { cached: true, apps: new Array(8) }
            }
        });

        expect(changes.decentralization).toEqual({ change: -10, trend: 'down' });   // 70 -> 63
        expect(changes.appsDeployed).toEqual({ change: 20, trend: 'up' });          // 25 -> 30
        expect(changes.appsExpiring).toEqual({ change: -20, trend: 'down' });       // 10 -> 8
    });

    it('leaves out a live section whose read failed, rather than failing the response', () => {
        // This is the #138 fix: one failing live read used to 500 the whole comparison.
        const { changes } = build({ decentralization: null, activity: null });

        expect(changes).not.toHaveProperty('decentralization');
        expect(changes).not.toHaveProperty('appsDeployed');
        expect(changes.revenue.change).toBe(25);
        expect(changes.nodes.difference).toBe(800);
    });

    it('counts an uncached live activity read as zero', () => {
        const { changes } = build({
            activity: {
                deployedToday: { cached: false, apps: new Array(30) },
                expiring24h: { cached: false, apps: new Array(8) }
            }
        });

        expect(changes.appsDeployed).toEqual({ change: -100, trend: 'down' });
    });

    it('still answers with revenue when no snapshot exists for the past date', () => {
        const response = build({ pastSnapshot: null });

        expect(response.partialData).toBe(true);
        expect(response.message).toContain('2026-08-23');
        expect(response.changes.revenue.change).toBe(25);
        expect(response.changes).not.toHaveProperty('nodes');
    });

    it('shows the git/docker split against zero on a day with no snapshot', () => {
        const { changes } = build({ pastSnapshot: null });

        expect(changes.apps).toEqual({
            change: 0,
            difference: 0,
            trend: 'neutral',
            gitChange: 400,
            gitTrend: 'up',
            dockerChange: 3800,
            dockerTrend: 'up'
        });
    });

    it('labels the response with the period it covers', () => {
        const response = build();

        expect(response.period).toBe(30);
        expect(response.currentDate).toBe('2026-09-22');
        expect(response.comparisonDate).toBe('2026-08-23');
    });

    it('treats a snapshot full of nulls as zeroes rather than throwing', () => {
        const { changes } = build({ pastSnapshot: { node_total: null, total_apps: null } });

        expect(changes.nodes.difference).toBe(12800);
        expect(changes.nodes.change).toBe(0);   // no baseline to divide by
        expect(changes.nodes.trend).toBe('neutral');
    });
});

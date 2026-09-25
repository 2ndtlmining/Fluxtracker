import { describe, it, expect } from 'vitest';
import { buildGameMetrics, buildGameSnapshots, GAMING_TOTAL_METRIC, GAME_REVENUE_METRICS } from './gameSeries.js';

describe('buildGameMetrics', () => {
    const instances = metrics => metrics.filter(m => !m.source);

    it('always leads with the total, then one entry per game in the given order', () => {
        const metrics = instances(buildGameMetrics(['Palworld', 'Valheim', 'FiveM']));

        expect(metrics.map(m => m.id)).toEqual([
            'gaming_instances_total',
            'game:Palworld',
            'game:Valheim',
            'game:FiveM'
        ]);
        expect(metrics.map(m => m.label)).toEqual(['All Game Instances', 'Palworld', 'Valheim', 'FiveM']);
    });

    it('reads the same field for every instance metric, so the chart needs no gaming branch', () => {
        for (const metric of instances(buildGameMetrics(['Palworld']))) {
            expect(metric.field).toBe('game_instances');
            expect(metric.format).toBe('number');
        }
    });

    it('is just the total when no games have been collected yet', () => {
        expect(instances(buildGameMetrics([]))).toEqual([GAMING_TOTAL_METRIC]);
        expect(instances(buildGameMetrics())).toEqual([GAMING_TOTAL_METRIC]);
    });

    it('always ends with the game-revenue metrics (#265), on their own source', () => {
        const metrics = buildGameMetrics(['Palworld']);
        expect(metrics.slice(-GAME_REVENUE_METRICS.length)).toEqual(GAME_REVENUE_METRICS);
        expect(GAME_REVENUE_METRICS.every(m => m.source === 'gameRevenue' && m.description)).toBe(true);
        expect(buildGameMetrics([])).toHaveLength(1 + GAME_REVENUE_METRICS.length);
    });
});

describe('buildGameSnapshots', () => {
    const history = {
        games: ['Palworld', 'Valheim'],
        history: [
            { date: '2026-09-01', game: 'Palworld', count: 10 },
            { date: '2026-09-01', game: 'Valheim', count: 4 },
            // 09-02 collected, but Palworld ran nothing: a real zero, not a gap.
            { date: '2026-09-02', game: 'Valheim', count: 5 },
            // 09-03 not collected at all -- absent from both series.
            { date: '2026-09-04', game: 'Palworld', count: 12 }
        ],
        total: [
            { date: '2026-09-01', count: 14 },
            { date: '2026-09-02', count: 5 },
            { date: '2026-09-04', count: 12 }
        ]
    };

    it('plots the total for the base metric', () => {
        expect(buildGameSnapshots(history, 'gaming_instances_total')).toEqual([
            { snapshot_date: '2026-09-01', game_instances: 14 },
            { snapshot_date: '2026-09-02', game_instances: 5 },
            { snapshot_date: '2026-09-04', game_instances: 12 }
        ]);
    });

    it('falls back to the total for a metric id left over from another category', () => {
        expect(buildGameSnapshots(history, 'daily_revenue')).toHaveLength(3);
        expect(buildGameSnapshots(history, undefined)).toHaveLength(3);
    });

    it('plots only the selected game', () => {
        expect(buildGameSnapshots(history, 'game:Valheim')).toEqual([
            { snapshot_date: '2026-09-01', game_instances: 4 },
            { snapshot_date: '2026-09-02', game_instances: 5 },
            { snapshot_date: '2026-09-04', game_instances: 0 }
        ]);
    });

    it('omits uncollected days rather than plotting them as zero', () => {
        const dates = buildGameSnapshots(history, 'game:Palworld').map(r => r.snapshot_date);

        // 09-03 has no row for ANY game -- nothing was collected, so it must be a gap.
        expect(dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
        expect(dates).not.toContain('2026-09-03');
    });

    it('plots a genuine zero on a day that was collected without the selected game', () => {
        // 09-02 was collected (Valheim has a row), so Palworld really did run none.
        const row = buildGameSnapshots(history, 'game:Palworld').find(r => r.snapshot_date === '2026-09-02');
        expect(row).toEqual({ snapshot_date: '2026-09-02', game_instances: 0 });
    });

    it('sorts by date regardless of the order rows arrive in', () => {
        const shuffled = { history: [
            { date: '2026-09-04', game: 'Palworld', count: 12 },
            { date: '2026-09-01', game: 'Palworld', count: 10 }
        ] };
        expect(buildGameSnapshots(shuffled, 'game:Palworld').map(r => r.snapshot_date))
            .toEqual(['2026-09-01', '2026-09-04']);
    });

    it('is empty, never a throw, before the fetch lands or on an un-migrated database', () => {
        expect(buildGameSnapshots(null, 'game:Palworld')).toEqual([]);
        expect(buildGameSnapshots({ games: [], history: [], total: [] }, 'game:Palworld')).toEqual([]);
        expect(buildGameSnapshots({}, 'gaming_instances_total')).toEqual([]);
    });

    it('handles a game whose name contains the metric prefix delimiter', () => {
        const odd = { history: [{ date: '2026-09-01', game: 'RuneScape: Dragonwilds', count: 3 }] };
        expect(buildGameSnapshots(odd, 'game:RuneScape: Dragonwilds')).toEqual([
            { snapshot_date: '2026-09-01', game_instances: 3 }
        ]);
    });
});

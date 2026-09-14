import { describe, it, expect } from 'vitest';
import { shapeGameHistory } from '../history.js';

/**
 * Issue #175: /api/history/games is the single fetch behind the chart's Gaming category.
 * The shaping is where the two claims that matter live -- dropdown order, and the refusal to
 * turn a missing reading into a zero.
 */
describe('shapeGameHistory', () => {
    const rows = [
        { snapshot_date: '2026-09-01', game_name: 'Palworld', instance_count: 200 },
        { snapshot_date: '2026-09-01', game_name: 'Valheim', instance_count: 95 },
        { snapshot_date: '2026-09-02', game_name: 'Palworld', instance_count: 250 },
        { snapshot_date: '2026-09-02', game_name: 'Valheim', instance_count: 91 }
    ];

    it('flattens rows into date/game/count triples in source order', () => {
        const { history } = shapeGameHistory(rows, []);

        expect(history).toEqual([
            { date: '2026-09-01', game: 'Palworld', count: 200 },
            { date: '2026-09-01', game: 'Valheim', count: 95 },
            { date: '2026-09-02', game: 'Palworld', count: 250 },
            { date: '2026-09-02', game: 'Valheim', count: 91 }
        ]);
    });

    it('orders the dropdown by each game\'s MOST RECENT count, not its first or its peak', () => {
        // Valheim outranks Palworld on day 1 and loses on day 2. The dropdown follows the
        // latest reading, so it matches what the Gaming card shows today.
        const overtaken = [
            { snapshot_date: '2026-09-01', game_name: 'Fading', instance_count: 500 },
            { snapshot_date: '2026-09-02', game_name: 'Fading', instance_count: 2 },
            { snapshot_date: '2026-09-02', game_name: 'Rising', instance_count: 40 }
        ];

        expect(shapeGameHistory(overtaken, []).games).toEqual(['Rising', 'Fading']);
    });

    it('breaks an equal-count tie alphabetically so the order is stable between requests', () => {
        const tied = [
            { snapshot_date: '2026-09-02', game_name: 'Zomboid', instance_count: 7 },
            { snapshot_date: '2026-09-02', game_name: 'Argos', instance_count: 7 }
        ];

        expect(shapeGameHistory(tied, []).games).toEqual(['Argos', 'Zomboid']);
    });

    it('lists a game that disappeared, so its earlier history stays selectable', () => {
        const { games } = shapeGameHistory(rows.concat(
            { snapshot_date: '2026-09-01', game_name: 'Discontinued', instance_count: 3 }
        ), []);

        expect(games).toContain('Discontinued');
    });

    it('drops a NULL gaming_instances_total rather than plotting it as zero', () => {
        const { total } = shapeGameHistory([], [
            { snapshot_date: '2026-09-01', gaming_instances_total: null },
            { snapshot_date: '2026-09-02', gaming_instances_total: 449 },
            { snapshot_date: '2026-09-03', gaming_instances_total: undefined }
        ]);

        expect(total).toEqual([{ date: '2026-09-02', count: 449 }]);
    });

    it('keeps a genuine zero, which is a real reading and not a missing one', () => {
        const { total } = shapeGameHistory([], [
            { snapshot_date: '2026-09-02', gaming_instances_total: 0 }
        ]);

        expect(total).toEqual([{ date: '2026-09-02', count: 0 }]);
    });

    it('returns empty arrays when the table is missing entirely', () => {
        // What a Supabase without migration 013 produces once the endpoint's catch fires --
        // an empty category, not a 500.
        expect(shapeGameHistory([], [])).toEqual({ games: [], history: [], total: [] });
    });
});

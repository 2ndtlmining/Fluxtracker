import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Per-game snapshot history (issue #175): game_snapshots already stores one row per game per
 * day; this is the range reader that backs the Historical Performance chart's Gaming category.
 * Runs the REAL sqliteAdapter against a temp-file database, same pattern as
 * decentralizationSnapshots.test.js.
 */

const tmpPath = path.join(os.tmpdir(), `game-snapshot-history-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getGameSnapshotHistory', () => {
    it('round-trips a per-game breakdown for one date', async () => {
        await adapter.createGameSnapshots('2026-09-01', [
            { name: 'Palworld', instances: 250 },
            { name: 'Valheim', instances: 91 },
            { name: 'FiveM', instances: 12 }
        ]);

        const rows = await adapter.getGameSnapshotHistory('2026-09-01', '2026-09-01');

        expect(rows.map(r => ({ game: r.game_name, count: r.instance_count }))).toEqual([
            { game: 'Palworld', count: 250 },
            { game: 'Valheim', count: 91 },
            { game: 'FiveM', count: 12 }
        ]);
    });

    it('is ordered by date ascending, then instance_count desc within a date', async () => {
        await adapter.createGameSnapshots('2026-09-03', [
            { name: 'Terraria', instances: 6 },
            { name: 'Minecraft', instances: 58 }
        ]);
        await adapter.createGameSnapshots('2026-09-02', [
            { name: 'Rust', instances: 11 }
        ]);

        const rows = await adapter.getGameSnapshotHistory('2026-09-02', '2026-09-03');

        expect(rows.map(r => `${r.snapshot_date}:${r.game_name}`)).toEqual([
            '2026-09-02:Rust',
            '2026-09-03:Minecraft',
            '2026-09-03:Terraria'
        ]);
    });

    it('filters to an inclusive date range', async () => {
        await adapter.createGameSnapshots('2026-09-10', [{ name: 'Range Test', instances: 1 }]);
        await adapter.createGameSnapshots('2026-09-11', [{ name: 'Range Test', instances: 2 }]);
        await adapter.createGameSnapshots('2026-09-12', [{ name: 'Range Test', instances: 3 }]);

        const rows = await adapter.getGameSnapshotHistory('2026-09-10', '2026-09-11');

        expect(rows.map(r => r.snapshot_date)).toEqual(['2026-09-10', '2026-09-11']);
    });

    it('returns an empty array for a range with no snapshots', async () => {
        const rows = await adapter.getGameSnapshotHistory('2020-01-01', '2020-01-31');

        expect(rows).toEqual([]);
    });

    it('re-snapshotting a date updates counts in place rather than duplicating', async () => {
        await adapter.createGameSnapshots('2026-09-20', [{ name: 'Enshrouded', instances: 5 }]);
        await adapter.createGameSnapshots('2026-09-20', [{ name: 'Enshrouded', instances: 9 }]);

        const rows = await adapter.getGameSnapshotHistory('2026-09-20', '2026-09-20');

        expect(rows).toEqual([expect.objectContaining({ game_name: 'Enshrouded', instance_count: 9 })]);
    });

    it('keeps a game absent on a date absent from that date rather than reporting zero', async () => {
        // A game that stopped being deployed must leave a GAP in the chart, not a zero line:
        // "no reading" and "nobody ran it" are different claims and only one is true here.
        await adapter.createGameSnapshots('2026-09-25', [
            { name: 'Gone Tomorrow', instances: 4 },
            { name: 'Still Here', instances: 7 }
        ]);
        await adapter.createGameSnapshots('2026-09-26', [
            { name: 'Still Here', instances: 8 }
        ]);

        const rows = await adapter.getGameSnapshotHistory('2026-09-25', '2026-09-26');
        const day2 = rows.filter(r => r.snapshot_date === '2026-09-26');

        expect(day2.map(r => r.game_name)).toEqual(['Still Here']);
    });
});

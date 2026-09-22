import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TRACKED_GAMES } from '../../config.js';

/**
 * Issue #231 — repointing the per-game columns at app-name counting, and what that means
 * for 836 days of history.
 *
 * game_snapshots only starts on 2026-09-15: it can correct 8 days. For the 828 before it
 * no app-name reading has ever existed, and the stored values are image-only counts of a
 * different thing -- gaming_valheim = 3 where 108 were running. Leaving them would put a
 * 27x step in the middle of one column that reads as growth rather than as a change of
 * method, so they are set to NULL, which is what "no reading" means everywhere else here
 * and what the KPI layer already treats as missing.
 *
 * Runs the real SQLite adapter and reads back: the #229 lesson is that a green unit test
 * on the builder proves nothing about what landed in the database.
 */

let dir, db, repair;

beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-repair-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dir, 'test.sqlite3');
    db = await import('../adapters/sqliteAdapter.js');
    repair = await import('../gameColumnRepair.js');
    await db.initDatabase();
    await db.getDb().exec('DELETE FROM daily_snapshots; DELETE FROM game_snapshots;');
});

afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

async function snapshot(date, extra = {}) {
    await db.createDailySnapshot({
        snapshot_date: date, timestamp: Date.parse(`${date}T00:00:00Z`),
        daily_revenue: 1, sync_status: 'completed', ...extra
    });
}

describe('repairGameColumns', () => {
    it('writes the app-name count over a stale image-only reading', async () => {
        await snapshot('2026-09-15', { gaming_valheim: 3 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        await repair.repairGameColumns();

        expect((await db.getSnapshotByDate('2026-09-15')).gaming_valheim).toBe(108);
    });

    it('fills a game that never had a column value at all', async () => {
        await snapshot('2026-09-15');
        await db.createGameSnapshots('2026-09-15', [{ name: 'RuneScape: Dragonwilds', instances: 249 }]);

        await repair.repairGameColumns();

        expect((await db.getSnapshotByDate('2026-09-15')).gaming_dragonwilds).toBe(249);
    });

    it('records 0 for a tracked game absent from a day that was collected', async () => {
        await snapshot('2026-09-15', { gaming_rust: 7 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        await repair.repairGameColumns();

        // The day has a breakdown and Rust is not in it, so Rust ran nothing.
        expect((await db.getSnapshotByDate('2026-09-15')).gaming_rust).toBe(0);
    });

    it('NULLs every per-game column on days that predate game_snapshots', async () => {
        await snapshot('2025-01-01', { gaming_valheim: 3, gaming_palworld: 40 });
        await snapshot('2026-09-15', { gaming_valheim: 3 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        await repair.repairGameColumns();

        const old = await db.getSnapshotByDate('2025-01-01');
        const nonNull = TRACKED_GAMES.filter(g => old[g.dbKey] !== null).map(g => g.dbKey);
        expect(nonNull, `left behind: ${nonNull.join(', ')}`).toEqual([]);
    });

    it('leaves non-game columns on those old days untouched', async () => {
        await snapshot('2025-01-01', { gaming_valheim: 3, node_total: 5200, daily_revenue: 1234 });
        await snapshot('2026-09-15');
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        await repair.repairGameColumns();

        const old = await db.getSnapshotByDate('2025-01-01');
        expect(old.node_total).toBe(5200);
        expect(old.daily_revenue).toBe(1234);
    });

    it('reports what it did', async () => {
        await snapshot('2025-01-01', { gaming_valheim: 3 });
        await snapshot('2025-01-02', { gaming_valheim: 4 });
        await snapshot('2026-09-15', { gaming_valheim: 3 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        const result = await repair.repairGameColumns();

        expect(result).toMatchObject({ repaired: 1, cleared: 2, firstGameSnapshotDate: '2026-09-15' });
    });

    it('is idempotent -- a second run changes nothing', async () => {
        await snapshot('2025-01-01', { gaming_valheim: 3 });
        await snapshot('2026-09-15', { gaming_valheim: 3 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        await repair.repairGameColumns();
        const afterFirst = await db.getSnapshotByDate('2026-09-15');
        await repair.repairGameColumns();
        const afterSecond = await db.getSnapshotByDate('2026-09-15');

        expect(afterSecond.gaming_valheim).toBe(108);
        expect(afterSecond).toEqual(afterFirst);
    });

    it('refuses to touch anything when game_snapshots is empty', async () => {
        // Otherwise an empty source would read as "no app-name data ever" and wipe all 836
        // days of history on a database that simply had not collected any games yet.
        await snapshot('2025-01-01', { gaming_valheim: 3 });

        const result = await repair.repairGameColumns();

        expect(result).toMatchObject({ repaired: 0, cleared: 0, skipped: true });
        expect((await db.getSnapshotByDate('2025-01-01')).gaming_valheim).toBe(3);
    });

    it('supports a dry run that reports without writing', async () => {
        await snapshot('2025-01-01', { gaming_valheim: 3 });
        await snapshot('2026-09-15', { gaming_valheim: 3 });
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        const result = await repair.repairGameColumns({ dryRun: true });

        expect(result).toMatchObject({ repaired: 1, cleared: 1, dryRun: true });
        expect((await db.getSnapshotByDate('2026-09-15')).gaming_valheim).toBe(3);
        expect((await db.getSnapshotByDate('2025-01-01')).gaming_valheim).toBe(3);
    });

    it('skips a game_snapshots day that has no daily_snapshots row', async () => {
        await db.createGameSnapshots('2026-09-15', [{ name: 'Valheim', instances: 108 }]);

        const result = await repair.repairGameColumns();

        expect(result.repaired).toBe(0);
    });
});

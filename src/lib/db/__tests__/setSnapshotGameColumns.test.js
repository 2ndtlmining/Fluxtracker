import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TRACKED_GAMES } from '../../config.js';

/**
 * Issue #231 — the per-game columns change meaning from an image-only count to an
 * app-name one, so the repair has to OVERWRITE stored values, including non-zero ones.
 * fillSnapshotNullColumns() cannot do it: by design it only ever fills a NULL, which is
 * right for the nightly top-up and wrong here.
 *
 * Written through the real SQLite adapter and read back. #229 is the reason that rule
 * exists in this repo: its fix corrected the snapshot builder, the unit test passed, and
 * the values still never reached the database because both adapters rebuilt the row and
 * dropped the columns a second time.
 */

const tmpPath = path.join(os.tmpdir(), `set-game-cols-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = tmpPath;

const db = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await db.initDatabase();
    await db.createDailySnapshot({
        snapshot_date: '2026-09-20',
        timestamp: Date.now(),
        daily_revenue: 10,
        gaming_valheim: 3,          // the stale image-only reading
        gaming_palworld: 227,
        sync_status: 'completed'
    });
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('setSnapshotGameColumns', () => {
    it('overwrites a stale non-zero reading', async () => {
        await db.setSnapshotGameColumns('2026-09-20', { gaming_valheim: 108 });

        expect((await db.getSnapshotByDate('2026-09-20')).gaming_valheim).toBe(108);
    });

    it('writes NULL when asked, for a day with no app-name record', async () => {
        await db.setSnapshotGameColumns('2026-09-20', { gaming_palworld: null });

        expect((await db.getSnapshotByDate('2026-09-20')).gaming_palworld).toBeNull();
    });

    it('stores a real zero as 0, not NULL', async () => {
        await db.setSnapshotGameColumns('2026-09-20', { gaming_rust: 0 });

        expect((await db.getSnapshotByDate('2026-09-20')).gaming_rust).toBe(0);
    });

    it('touches only the columns it was given', async () => {
        await db.setSnapshotGameColumns('2026-09-20', { gaming_valheim: 111 });

        const row = await db.getSnapshotByDate('2026-09-20');
        expect(row.gaming_valheim).toBe(111);
        expect(row.daily_revenue).toBe(10);
        expect(row.gaming_rust).toBe(0);
    });

    it('round-trips every tracked game, so no column is silently dropped', async () => {
        const values = Object.fromEntries(TRACKED_GAMES.map((g, i) => [g.dbKey, i + 1]));

        await db.setSnapshotGameColumns('2026-09-20', values);

        const row = await db.getSnapshotByDate('2026-09-20');
        const dropped = TRACKED_GAMES.filter(g => row[g.dbKey] !== values[g.dbKey]).map(g => g.dbKey);
        expect(dropped, `not stored: ${dropped.join(', ')}`).toEqual([]);
    });

    it('is a no-op for a date with no snapshot', async () => {
        await expect(db.setSnapshotGameColumns('2019-01-01', { gaming_valheim: 5 })).resolves.toBe(false);
    });

    it('is a no-op when given nothing to write', async () => {
        await expect(db.setSnapshotGameColumns('2026-09-20', {})).resolves.toBe(false);
    });

    it('ignores a column that is not on the table', async () => {
        await expect(
            db.setSnapshotGameColumns('2026-09-20', { gaming_valheim: 99, not_a_column: 1 })
        ).resolves.toBe(true);

        expect((await db.getSnapshotByDate('2026-09-20')).gaming_valheim).toBe(99);
    });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #229 — repairing the game counts that were written as a fabricated 0.
 *
 * The forward fix stops it recurring; this repairs ~615 days of history. It is possible
 * because repo_snapshots stores per-image daily counts from the SAME image-matching source
 * the live game counter uses, so the reconstruction is exact rather than an estimate.
 *
 * The safety rule is the whole design: only a stored 0 is ever overwritten, and only with a
 * POSITIVE reconstructed count. A day on which the game genuinely ran zero instances stays
 * 0, and a real non-zero reading is never restated.
 */

let dbDir, db;

beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-backfill-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
    db = await import('../adapters/sqliteAdapter.js');
    await db.initDatabase();
});

afterEach(() => {
    vi.restoreAllMocks();
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

const snapshot = (date, over = {}) => ({
    snapshot_date: date, timestamp: Date.now(), daily_revenue: 1,
    sync_status: 'completed', ...over
});

describe('fillZeroSnapshotColumns', () => {
    it('replaces a fabricated 0 with the real count', async () => {
        await db.createDailySnapshot(snapshot('2026-09-21', { gaming_rust: 0 }));

        const filled = await db.fillZeroSnapshotColumns('2026-09-21', { gaming_rust: 4 });

        expect(filled).toEqual(['gaming_rust']);
        expect((await db.getSnapshotByDate('2026-09-21')).gaming_rust).toBe(4);
    });

    it('never restates a real non-zero reading', async () => {
        // The columns this repairs sit beside columns that were always written correctly.
        // Overwriting one of those would turn a repair into data loss.
        await db.createDailySnapshot(snapshot('2026-09-21', { gaming_palworld: 258 }));

        const filled = await db.fillZeroSnapshotColumns('2026-09-21', { gaming_palworld: 3 });

        expect(filled).toEqual([]);
        expect((await db.getSnapshotByDate('2026-09-21')).gaming_palworld).toBe(258);
    });

    it('leaves a genuine zero alone when there is nothing to put there', async () => {
        await db.createDailySnapshot(snapshot('2026-09-21', { gaming_rust: 0 }));

        const filled = await db.fillZeroSnapshotColumns('2026-09-21', { gaming_rust: 0 });

        expect(filled).toEqual([]);
    });

    it('ignores a column the row does not have', async () => {
        await db.createDailySnapshot(snapshot('2026-09-21'));

        await expect(db.fillZeroSnapshotColumns('2026-09-21', { not_a_column: 5 }))
            .resolves.toEqual([]);
    });

    it('is a no-op for a date with no snapshot', async () => {
        await expect(db.fillZeroSnapshotColumns('2020-01-01', { gaming_rust: 4 }))
            .resolves.toEqual([]);
    });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Filling NULL columns on an existing snapshot row.
 *
 * A metric that ships mid-day finds that day's snapshot row already written, and
 * shouldTakeSnapshot() refuses to rewrite a day that already exists -- correctly, since a
 * re-snapshot would restate every column from whatever current_metrics happens to hold.
 * So the new column stays NULL for that day forever, and someone has to go and write the
 * value by hand. unique_wallets (#201) needed exactly that.
 *
 * This fills ONLY columns that are still NULL, and only from real readings.
 */

let dbDir, db;

beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-topup-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
    db = await import('../adapters/sqliteAdapter.js');
    await db.initDatabase();
});

afterEach(() => {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

const row = (over = {}) => ({
    snapshot_date: '2026-09-21',
    timestamp: Date.now(),
    daily_revenue: 1234.5,
    node_total: 6451,
    total_apps: 7922,
    sync_status: 'completed',
    ...over
});

describe('fillSnapshotNullColumns', () => {
    it('fills a column that is NULL', async () => {
        await db.createDailySnapshot(row({ unique_wallets: null }));

        const filled = await db.fillSnapshotNullColumns('2026-09-21', { unique_wallets: 830 });

        expect(filled).toEqual(['unique_wallets']);
        const after = await db.getSnapshotByDate('2026-09-21');
        expect(after.unique_wallets).toBe(830);
    });

    it('never overwrites a column that already has a value', async () => {
        // The whole point: this tops up what is missing, it does not restate the day.
        // A snapshot taken at 23:00 must not be rewritten with numbers read at 23:05.
        await db.createDailySnapshot(row({ unique_wallets: 824 }));

        const filled = await db.fillSnapshotNullColumns('2026-09-21', { unique_wallets: 830 });

        expect(filled).toEqual([]);
        const after = await db.getSnapshotByDate('2026-09-21');
        expect(after.unique_wallets).toBe(824);
    });

    it('leaves every other column untouched', async () => {
        await db.createDailySnapshot(row({ unique_wallets: null }));
        const before = await db.getSnapshotByDate('2026-09-21');

        await db.fillSnapshotNullColumns('2026-09-21', { unique_wallets: 830 });

        const after = await db.getSnapshotByDate('2026-09-21');
        expect(after.daily_revenue).toBe(before.daily_revenue);
        expect(after.node_total).toBe(before.node_total);
        expect(after.total_apps).toBe(before.total_apps);
        expect(after.sync_status).toBe(before.sync_status);
    });

    it('ignores values that are not real readings', async () => {
        // 0 means "collection failed" in a snapshot column by this repo's convention, so
        // writing one would replace "missing" with "missing" while looking like a reading.
        await db.createDailySnapshot(row({ unique_wallets: null }));

        const filled = await db.fillSnapshotNullColumns('2026-09-21', {
            unique_wallets: 0,
            gaming_instances_total: null,
            apps_deployed_today: undefined
        });

        expect(filled).toEqual([]);
        const after = await db.getSnapshotByDate('2026-09-21');
        expect(after.unique_wallets).toBeNull();
    });

    it('fills several columns in one call and reports which it filled', async () => {
        await db.createDailySnapshot(row({ unique_wallets: null, gaming_instances_total: 42 }));

        const filled = await db.fillSnapshotNullColumns('2026-09-21', {
            unique_wallets: 830,
            gaming_instances_total: 99
        });

        expect(filled).toEqual(['unique_wallets']);
        const after = await db.getSnapshotByDate('2026-09-21');
        expect(after.unique_wallets).toBe(830);
        expect(after.gaming_instances_total).toBe(42);
    });

    it('does nothing when the day has no snapshot at all', async () => {
        // Creating one here would race the real snapshot job and produce a half-empty day.
        const filled = await db.fillSnapshotNullColumns('2026-09-20', { unique_wallets: 824 });

        expect(filled).toEqual([]);
        expect(await db.getSnapshotByDate('2026-09-20')).toBeNull();
    });

    it('ignores a column the table does not have', async () => {
        await db.createDailySnapshot(row());

        const filled = await db.fillSnapshotNullColumns('2026-09-21', { not_a_real_column: 7 });

        expect(filled).toEqual([]);
    });
});

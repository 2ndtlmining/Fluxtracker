import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #220 — a failed write must not be reported as a success.
 *
 * `createDailySnapshot` and `updateCurrentMetrics` logged their write error and returned,
 * so `snapshotManager.takeSnapshot()` went on to reset `consecutiveFailures`, fire a
 * backup and answer `{ success: true }` for a day that has no row. Every sibling snapshot
 * writer (`createGameSnapshots`, `createDecentralizationSnapshots`, `upsertDailySnapshots`)
 * already throws; these two were the exception.
 *
 * The failures are forced with a RAISE(ABORT) trigger rather than a mock: the write is
 * rejected by the database exactly as an RLS denial or a schema-cache miss rejects it,
 * while reads keep working, which is the shape of the real incident.
 */

const tmpPath = path.join(os.tmpdir(), `snap-honesty-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = tmpPath;

const db = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await db.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

/** Run `fn` while the database rejects every `event` on `table`. */
async function whileWritesRejected(table, event, fn) {
    const name = `reject_${table}_${event}`;
    db.getDb().exec(
        `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'write rejected'); END;`
    );
    try {
        return await fn();
    } finally {
        db.getDb().exec(`DROP TRIGGER ${name}`);
    }
}

const snapshot = (date) => ({
    snapshot_date: date,
    timestamp: Date.now(),
    daily_revenue: 42,
    node_total: 7,
    sync_status: 'completed'
});

describe('createDailySnapshot surfaces a failed write (issue #220)', () => {
    it('rejects when the database refuses the row', async () => {
        await whileWritesRejected('daily_snapshots', 'INSERT', async () => {
            await expect(db.createDailySnapshot(snapshot('2026-09-22'))).rejects.toThrow(/write rejected/);
        });

        expect(await db.getSnapshotByDate('2026-09-22')).toBeFalsy();
    });

    it('still resolves when the write succeeds', async () => {
        await expect(db.createDailySnapshot(snapshot('2026-09-23'))).resolves.toBeUndefined();

        const stored = await db.getSnapshotByDate('2026-09-23');
        expect(stored.node_total).toBe(7);
    });
});

describe('updateCurrentMetrics surfaces a failed write (issue #220)', () => {
    it('rejects when the database refuses the update', async () => {
        await whileWritesRejected('current_metrics', 'UPDATE', async () => {
            await expect(db.updateCurrentMetrics({ node_total: 5 })).rejects.toThrow(/write rejected/);
        });
    });

    it('still resolves when the write succeeds', async () => {
        await expect(db.updateCurrentMetrics({ node_total: 11 })).resolves.toBeUndefined();

        const stored = await db.getCurrentMetrics();
        expect(stored.node_total).toBe(11);
    });
});

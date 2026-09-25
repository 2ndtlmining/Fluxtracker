import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { METRIC_COLUMNS, GAMING_REPOS } from '../../config.js';

/**
 * Issue #229, second half — the adapter must not drop columns the builder produced.
 *
 * The first fix for #229 corrected snapshotManager's snapshotData and a unit test on that
 * builder went green, but the four game columns STILL did not reach the database: the
 * adapters each enumerate the columns literally too, so the row object was rebuilt on the
 * way down and the newer games were dropped a second time. Three hardcoded lists, not one.
 *
 * A builder-level test cannot see that. This one writes through the REAL SQLite adapter and
 * reads back, which is the only layer at which "the value actually landed" is true or false.
 */

let dbDir, db;

beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-parity-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
    db = await import('../adapters/sqliteAdapter.js');
    await db.initDatabase();
});

afterEach(() => {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

/** Distinct non-zero value per column, so a dropped column reads back as 0/null rather
 *  than coincidentally matching its neighbour. */
function fullSnapshot() {
    const snap = { snapshot_date: '2026-09-21', timestamp: Date.now(), sync_status: 'completed' };
    METRIC_COLUMNS.forEach((col, i) => { snap[col] = i + 1; });
    snap.daily_revenue = 999;
    return snap;
}

describe('createDailySnapshot column parity (issue #229)', () => {
    it('round-trips every METRIC_COLUMNS value that belongs on daily_snapshots', async () => {
        const snap = fullSnapshot();
        await db.createDailySnapshot(snap);

        const stored = await db.getSnapshotByDate('2026-09-21');
        const onRow = METRIC_COLUMNS.filter(c => c in stored);
        const dropped = onRow.filter(c => stored[c] !== snap[c]);

        expect(dropped, `adapter dropped: ${dropped.join(', ')}`).toEqual([]);
    });

    it('persists every configured game, not a hardcoded subset', async () => {
        // The exact regression: gaming_rust/terraria/ark/windrose were in GAMING_REPOS and
        // in current_metrics, but the adapter's literal list predated them, so they were
        // written as the column DEFAULT 0 -- indistinguishable from "no instances ran".
        const snap = fullSnapshot();
        await db.createDailySnapshot(snap);

        const stored = await db.getSnapshotByDate('2026-09-21');
        for (const repo of GAMING_REPOS) {
            expect(stored[repo.dbKey], `${repo.dbKey} (${repo.name}) did not reach the row`)
                .toBe(snap[repo.dbKey]);
        }
    });

    it('stores null, not 0, for a nullable column the caller left absent', async () => {
        // These have no DEFAULT precisely so absent reads back as "not collected". A 0 here
        // would be averaged into KPI reports as a real reading.
        await db.createDailySnapshot({
            snapshot_date: '2026-09-21', timestamp: Date.now(), daily_revenue: 1, sync_status: 'completed'
        });

        const stored = await db.getSnapshotByDate('2026-09-21');
        expect(stored.unique_wallets).toBeNull();
        expect(stored.unique_app_owners).toBeNull();
        expect(stored.locked_collateral).toBeNull();
        expect(stored.median_days_left).toBeNull();
    });
});

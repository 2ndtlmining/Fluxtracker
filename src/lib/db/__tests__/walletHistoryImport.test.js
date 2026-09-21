import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #201 — importing Fluxutilmon's unique-wallet history.
 *
 * Two separable pieces, both tested here against a real SQLite database rather than mocks,
 * because the whole risk of this import is what it does to rows that already exist:
 *
 *   1. readWalletHistory()  — folder of JSON snapshots -> one reading per day
 *   2. setSnapshotWalletCount() — write that touches unique_wallets and nothing else
 */

let dbDir;
let db;
let readWalletHistory;
let setSnapshotWalletCount, createDailySnapshot, getSnapshotByDate, initDatabase;

beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-import-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');

    vi.resetModules();
    db = await import('../adapters/sqliteAdapter.js');
    ({ setSnapshotWalletCount, createDailySnapshot, getSnapshotByDate, initDatabase } = db);
    await initDatabase();

    ({ readWalletHistory } = await import('../../../../scripts/import-wallet-history.mjs'));
});

afterEach(() => {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

/** Writes a Fluxutilmon-shaped snapshot file. */
function writeSnapshot(dir, stamp, fields) {
    fs.writeFileSync(
        path.join(dir, `utilization_${stamp}.json`),
        JSON.stringify({ Snapshot: stamp, totalnodes: 6000, ...fields })
    );
}

describe('readWalletHistory', () => {
    let src;
    beforeEach(() => {
        src = fs.mkdtempSync(path.join(os.tmpdir(), 'utildata-'));
    });

    it('reads one reading per day keyed by date', () => {
        writeSnapshot(src, '2024-06-17_18-48-21', { unique_wallet_count: 3432 });
        writeSnapshot(src, '2024-06-18_19-10-00', { unique_wallet_count: 3400 });

        const { readings } = readWalletHistory(src);

        expect(readings.get('2024-06-17')).toBe(3432);
        expect(readings.get('2024-06-18')).toBe(3400);
        expect(readings.size).toBe(2);
    });

    it('takes the LAST snapshot of a day, not the first', () => {
        // 415 of the 789 days carry 2-4 snapshots. A daily snapshot is end-of-day state,
        // so the latest reading of the day is the one that represents it.
        writeSnapshot(src, '2024-12-24_02-00-00', { unique_wallet_count: 2900 });
        writeSnapshot(src, '2024-12-24_23-30-00', { unique_wallet_count: 2988 });
        writeSnapshot(src, '2024-12-24_11-00-00', { unique_wallet_count: 2950 });

        const { readings } = readWalletHistory(src);

        expect(readings.get('2024-12-24')).toBe(2988);
    });

    it('skips files with no unique_wallet_count rather than recording a zero', () => {
        // The 9 earliest exports predate the field. A 0 for them would read as "no wallets
        // ran nodes that day" and, once imported, could never be told from a real reading.
        writeSnapshot(src, '2024-06-07_05-44-22', {});                       // pre-field
        writeSnapshot(src, '2024-06-17_18-48-21', { unique_wallet_count: 3432 });

        const { readings, skipped } = readWalletHistory(src);

        expect(readings.has('2024-06-07')).toBe(false);
        expect(readings.size).toBe(1);
        expect(skipped.noWalletField).toBe(1);
    });

    it('skips a zero or negative count instead of importing it', () => {
        writeSnapshot(src, '2024-07-01_10-00-00', { unique_wallet_count: 0 });
        writeSnapshot(src, '2024-07-02_10-00-00', { unique_wallet_count: -5 });

        const { readings, skipped } = readWalletHistory(src);

        expect(readings.size).toBe(0);
        expect(skipped.invalidCount).toBe(2);
    });

    it('counts an unparseable file rather than aborting the whole import', () => {
        fs.writeFileSync(path.join(src, 'utilization_2024-08-01_10-00-00.json'), '{ not json');
        writeSnapshot(src, '2024-08-02_10-00-00', { unique_wallet_count: 3000 });

        const { readings, skipped } = readWalletHistory(src);

        expect(readings.get('2024-08-02')).toBe(3000);
        expect(skipped.unparseable).toBe(1);
    });
});

describe('setSnapshotWalletCount', () => {
    /** A full snapshot row, the way the nightly job writes one. */
    const fullRow = (date) => ({
        snapshot_date: date,
        timestamp: Date.now(),
        daily_revenue: 1234.5,
        node_total: 6000,
        node_cumulus: 2800,
        total_apps: 6400,
        sync_status: 'completed'
    });

    it('sets unique_wallets on an existing row without touching any other column', async () => {
        // This is the whole risk of the import: 789 days land on rows that already hold
        // real revenue and node history, and none of it may be disturbed.
        await createDailySnapshot(fullRow('2026-01-01'));
        const before = await getSnapshotByDate('2026-01-01');

        const result = await setSnapshotWalletCount('2026-01-01', 1365);

        expect(result).toBe('updated');
        const after = await getSnapshotByDate('2026-01-01');
        expect(after.unique_wallets).toBe(1365);
        expect(after.daily_revenue).toBe(before.daily_revenue);
        expect(after.node_total).toBe(before.node_total);
        expect(after.total_apps).toBe(before.total_apps);
        expect(after.sync_status).toBe(before.sync_status);
    });

    it('creates a backfilled row when the day has no snapshot at all', async () => {
        const result = await setSnapshotWalletCount('2024-06-17', 3432);

        expect(result).toBe('created');
        const row = await getSnapshotByDate('2024-06-17');
        expect(row.unique_wallets).toBe(3432);
        // Marked so a reader can tell this row was never a real day of collection.
        expect(row.sync_status).toBe('backfilled');
    });

    it('is idempotent — running twice leaves the same single row', async () => {
        await setSnapshotWalletCount('2024-06-17', 3432);
        const second = await setSnapshotWalletCount('2024-06-17', 3432);

        expect(second).toBe('updated');
        const row = await getSnapshotByDate('2024-06-17');
        expect(row.unique_wallets).toBe(3432);
    });

    it('refuses a non-positive count so a bad reading cannot overwrite a good one', async () => {
        await createDailySnapshot({ ...fullRow('2026-02-01'), unique_wallets: 1200 });

        await expect(setSnapshotWalletCount('2026-02-01', 0)).rejects.toThrow();

        const row = await getSnapshotByDate('2026-02-01');
        expect(row.unique_wallets).toBe(1200);
    });
});

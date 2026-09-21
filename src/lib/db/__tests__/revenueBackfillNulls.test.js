import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #218 — POST /api/admin/backfill wrote up to 365 days of daily_snapshots with every
 * non-revenue metric hardcoded to 0 and sync_status 'completed'.
 *
 * A 0 is not a missing reading anywhere else in this repo: snapshotManager and both
 * adapters use `?? null` precisely so an absent value stays NULL, the KPI layer treats a 0
 * as a failed collection, and fillSnapshotNullColumns() repairs NULL columns only -- it
 * skips anything already set, so a fabricated 0 is permanent. The analytics comparison
 * then renders "+6448 nodes, 0% change, neutral" against those days and presents it as
 * real history.
 *
 * Runs the real SQLite adapter through database.js and reads back, because "the column is
 * NULL in the database" is the only form of this claim that is actually true or false.
 *
 * TZ is pinned to a DST-observing zone for the date-loop test: the loop advanced with
 * local-time setDate() over UTC date strings, so a spring-forward day was emitted twice
 * and a later day skipped entirely.
 */

process.env.TZ = 'America/New_York';

const tmpPath = path.join(os.tmpdir(), `revenue-backfill-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = tmpPath;

const adapter = await import('../adapters/sqliteAdapter.js');
const { backfillRevenueSnapshots } = await import('../run-backfill.js');

/** Columns the backfill has no reading for — none of them may come back as 0. */
const FABRICATED_COLUMNS = [
    'total_cpu_cores', 'used_cpu_cores', 'cpu_utilization_percent',
    'total_ram_gb', 'used_ram_gb', 'ram_utilization_percent',
    'total_storage_gb', 'used_storage_gb', 'storage_utilization_percent',
    'total_apps', 'watchtower_count', 'gaming_apps_total', 'crypto_nodes_total',
    'wordpress_count', 'node_cumulus', 'node_nimbus', 'node_stratus', 'node_total'
];

beforeAll(async () => {
    await adapter.initDatabase();
    await adapter.insertTransaction({
        txid: 'tx-1', address: 'addr-1', amount: 12.5,
        block_height: 100, timestamp: Date.parse('2026-03-07T10:00:00Z') / 1000, date: '2026-03-07'
    });
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('backfillRevenueSnapshots (issue #218)', () => {
    it('leaves every metric it has no reading for NULL, not 0', async () => {
        await backfillRevenueSnapshots('2026-03-07', '2026-03-07');

        const row = await adapter.getSnapshotByDate('2026-03-07');
        const fabricated = FABRICATED_COLUMNS.filter(c => row[c] !== null);

        expect(fabricated, `backfill invented a value for: ${fabricated.join(', ')}`).toEqual([]);
    });

    it('stores the revenue it does have', async () => {
        const row = await adapter.getSnapshotByDate('2026-03-07');

        expect(row.daily_revenue).toBe(12.5);
    });

    it("marks the row 'backfilled' so it is not mistaken for a real collection", async () => {
        const row = await adapter.getSnapshotByDate('2026-03-07');

        expect(row.sync_status).toBe('backfilled');
    });

    it('writes each day in the range exactly once across a DST transition', async () => {
        // 2026-03-08 is the US spring-forward. The local-time loop emitted it twice and
        // never reached 2026-03-11.
        const { created } = await backfillRevenueSnapshots('2026-03-08', '2026-03-11');

        const dates = (await adapter.getSnapshotsInRange('2026-03-08', '2026-03-11')).map(r => r.snapshot_date);

        expect(dates).toEqual(['2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11']);
        expect(created).toBe(4);
    });

    it('skips a day that already has a snapshot', async () => {
        const { created, skipped } = await backfillRevenueSnapshots('2026-03-07', '2026-03-07');

        expect(created).toBe(0);
        expect(skipped).toBe(1);
    });
});

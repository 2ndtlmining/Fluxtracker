import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #248. The daily snapshot for date D is taken minutes after midnight UTC, so the
 * `daily_revenue` it records for D is whatever had arrived in those first few minutes --
 * effectively nothing. Measured over 836 rows on a live instance, the 315 written this way
 * carried 15,375 FLUX between them against an actual 1,313,595.
 *
 * The fix writes D-1's completed total when D's row is created, which needs a narrow update:
 * createDailySnapshot() enumerates every column and nulls anything absent, so reusing it to
 * touch one field would wipe the rest of that day's row.
 *
 * Real sqliteAdapter against a real temp database, same pattern as
 * decentralizationSnapshots.test.js.
 */

const tmpPath = path.join(os.tmpdir(), `snapshot-revenue-update-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

/** A full row, so a partial update has something to preserve. */
async function seed(date, revenue) {
    await adapter.createDailySnapshot({
        snapshot_date: date,
        timestamp: Date.parse(`${date}T00:00:00Z`),
        daily_revenue: revenue,
        flux_price_usd: 0.0625,
        node_total: 12800,
        node_cumulus: 8000,
        total_apps: 4200,
        gaming_apps_total: 900,
        decentralization_datacenter_percent: 49.5,
        sync_status: 'completed'
    });
}

describe('updateSnapshotRevenue', () => {
    it('replaces the revenue for a date that already has a row', async () => {
        await seed('2026-05-01', 0);

        const updated = await adapter.updateSnapshotRevenue('2026-05-01', 9028.23);

        expect(updated).toBe(true);
        const [row] = await adapter.getSnapshotsInRange('2026-05-01', '2026-05-01');
        expect(row.daily_revenue).toBe(9028.23);
    });

    it('leaves every other column on that row alone', async () => {
        // The reason this function exists rather than reusing createDailySnapshot(), which
        // enumerates all columns and nulls the absent ones.
        await seed('2026-05-02', 0);

        await adapter.updateSnapshotRevenue('2026-05-02', 1234.5);

        const [row] = await adapter.getSnapshotsInRange('2026-05-02', '2026-05-02');
        expect(row.daily_revenue).toBe(1234.5);
        expect(row.node_total).toBe(12800);
        expect(row.node_cumulus).toBe(8000);
        expect(row.total_apps).toBe(4200);
        expect(row.gaming_apps_total).toBe(900);
        expect(row.flux_price_usd).toBe(0.0625);
        expect(row.decentralization_datacenter_percent).toBe(49.5);
        expect(row.sync_status).toBe('completed');
    });

    it('touches only the date it was given', async () => {
        await seed('2026-05-03', 111);
        await seed('2026-05-04', 222);

        await adapter.updateSnapshotRevenue('2026-05-03', 999);

        const [neighbour] = await adapter.getSnapshotsInRange('2026-05-04', '2026-05-04');
        expect(neighbour.daily_revenue).toBe(222);
    });

    it('reports false for a date with no row, rather than inserting one', async () => {
        // Filling gaps is backfillRevenueSnapshots()'s job. This one only corrects a day
        // that was already recorded, so a missing row must stay missing.
        const updated = await adapter.updateSnapshotRevenue('2019-01-01', 500);

        expect(updated).toBe(false);
        expect(await adapter.getSnapshotsInRange('2019-01-01', '2019-01-01')).toHaveLength(0);
    });

    it('accepts a zero, since a day with no revenue is a real reading', async () => {
        await seed('2026-05-05', 4321);

        const updated = await adapter.updateSnapshotRevenue('2026-05-05', 0);

        expect(updated).toBe(true);
        const [row] = await adapter.getSnapshotsInRange('2026-05-05', '2026-05-05');
        expect(row.daily_revenue).toBe(0);
    });

    it('is idempotent', async () => {
        await seed('2026-05-06', 0);

        await adapter.updateSnapshotRevenue('2026-05-06', 777);
        await adapter.updateSnapshotRevenue('2026-05-06', 777);

        const rows = await adapter.getSnapshotsInRange('2026-05-06', '2026-05-06');
        expect(rows).toHaveLength(1);
        expect(rows[0].daily_revenue).toBe(777);
    });
});

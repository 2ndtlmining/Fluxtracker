import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #248, part 2: repairing the rows already written wrong.
 *
 * #256 fixed the forward path -- each snapshot now finalises the previous day -- but the 315
 * rows the old code wrote still hold a start-of-day partial. This rewrites history, so the
 * rules it follows matter more than the arithmetic:
 *
 *   - it never touches today, whose figure is legitimately partial until tomorrow;
 *   - it only ever RAISES a value. Every instance of this bug understates, and lowering a
 *     stored figure to match an empty transaction table would destroy data on any day the
 *     sync does not cover;
 *   - it refuses outright if the transaction table is empty, rather than zeroing everything;
 *   - a dry run writes nothing.
 *
 * Real sqliteAdapter against a real temp database.
 */

const tmpPath = path.join(os.tmpdir(), `snapshot-revenue-repair-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');
const { repairSnapshotRevenue } = await import('../snapshotRevenueRepair.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

const TODAY = new Date().toISOString().split('T')[0];
const shift = (days) => {
    const d = new Date(`${TODAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
};

async function seedSnapshot(date, revenue) {
    await adapter.createDailySnapshot({
        snapshot_date: date,
        timestamp: Date.parse(`${date}T00:20:00Z`),
        daily_revenue: revenue,
        node_total: 12800,
        total_apps: 4200,
        sync_status: 'completed'
    });
}

async function seedTransactions(date, amounts) {
    for (const [i, amount] of amounts.entries()) {
        await adapter.insertTransaction({
            txid: `repair-${date}-${i}-${Math.random()}`,
            address: 't1Addr',
            from_address: 't1Sender',
            amount,
            block_height: 2900000 + i,
            timestamp: Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000),
            date
        });
    }
}

/** Wipe both tables so each test starts from a known state. */
async function reset() {
    const db = (await import('better-sqlite3')).default(tmpPath);
    db.prepare('DELETE FROM daily_snapshots').run();
    db.prepare('DELETE FROM revenue_transactions').run();
    db.close();
}

beforeEach(async () => {
    await reset();
});

describe('repairSnapshotRevenue', () => {
    it('raises a day that was recorded as a start-of-day partial', async () => {
        await seedSnapshot(shift(-3), 12.5);
        await seedTransactions(shift(-3), [4000, 3000, 2028.23]);

        const result = await repairSnapshotRevenue();

        expect(result.changed).toBe(1);
        const [row] = await adapter.getSnapshotsInRange(shift(-3), shift(-3));
        expect(row.daily_revenue).toBeCloseTo(9028.23, 2);
    });

    it('leaves a day that already matches alone', async () => {
        await seedSnapshot(shift(-3), 500);
        await seedTransactions(shift(-3), [500]);

        const result = await repairSnapshotRevenue();

        expect(result.changed).toBe(0);
        expect(result.unchanged).toBe(1);
    });

    it('never touches today, whose figure is still legitimately partial', async () => {
        await seedSnapshot(TODAY, 25.33);
        await seedTransactions(TODAY, [1867.04]);

        const result = await repairSnapshotRevenue();

        expect(result.changed).toBe(0);
        const [row] = await adapter.getSnapshotsInRange(TODAY, TODAY);
        expect(row.daily_revenue).toBe(25.33);
    });

    it('does not lower a stored figure the transactions cannot account for', async () => {
        // The dangerous case: a day outside the sync's coverage has no transactions, so the
        // "truth" reads 0. Every instance of this bug understates, so a value higher than
        // the transactions is missing sync data, not a wrong snapshot -- lowering it would
        // destroy the only record of that day.
        await seedSnapshot(shift(-4), 7777);
        await seedTransactions(shift(-2), [100]); // some other day, so the table is not empty

        const result = await repairSnapshotRevenue();

        const [row] = await adapter.getSnapshotsInRange(shift(-4), shift(-4));
        expect(row.daily_revenue).toBe(7777);
        expect(result.overstated).toBe(1);
    });

    it('refuses to run at all when there are no transactions', async () => {
        // Otherwise a broken or not-yet-synced revenue table would zero every row.
        await seedSnapshot(shift(-3), 500);

        const result = await repairSnapshotRevenue();

        expect(result.skipped).toBe(true);
        expect(result.reason).toMatch(/no revenue transactions/i);
        const [row] = await adapter.getSnapshotsInRange(shift(-3), shift(-3));
        expect(row.daily_revenue).toBe(500);
    });

    it('writes nothing on a dry run, but reports what it would do', async () => {
        await seedSnapshot(shift(-3), 0);
        await seedTransactions(shift(-3), [9028.23]);

        const result = await repairSnapshotRevenue({ dryRun: true });

        expect(result.dryRun).toBe(true);
        expect(result.changed).toBe(1);
        const [row] = await adapter.getSnapshotsInRange(shift(-3), shift(-3));
        expect(row.daily_revenue).toBe(0);
    });

    it('is idempotent', async () => {
        await seedSnapshot(shift(-3), 0);
        await seedTransactions(shift(-3), [9028.23]);

        const first = await repairSnapshotRevenue();
        const second = await repairSnapshotRevenue();

        expect(first.changed).toBe(1);
        expect(second.changed).toBe(0);
        expect(second.unchanged).toBe(1);
    });

    it('honours an explicit date range', async () => {
        await seedSnapshot(shift(-5), 0);
        await seedSnapshot(shift(-3), 0);
        await seedTransactions(shift(-5), [111]);
        await seedTransactions(shift(-3), [222]);

        const result = await repairSnapshotRevenue({ from: shift(-3), to: shift(-3) });

        expect(result.changed).toBe(1);
        const [outside] = await adapter.getSnapshotsInRange(shift(-5), shift(-5));
        expect(outside.daily_revenue).toBe(0);
    });

    it('treats a sub-FLUX difference as equal, not as a discrepancy', async () => {
        // Summing float amounts in a different order than when the row was written moves a
        // total by hundredths. The first live run called 357 such days "overstated", which
        // reads as a data problem and is not one.
        await seedSnapshot(shift(-3), 1090.41);
        await seedTransactions(shift(-3), [1090.37]);

        const result = await repairSnapshotRevenue();

        expect(result.overstated).toBe(0);
        expect(result.unchanged).toBe(1);
    });

    it('still catches a difference big enough to matter', async () => {
        await seedSnapshot(shift(-3), 100);
        await seedTransactions(shift(-3), [5058.47]);

        const result = await repairSnapshotRevenue();

        expect(result.changed).toBe(1);
    });

    it('reports the totals so a dry run can be judged before committing to it', async () => {
        await seedSnapshot(shift(-3), 0);
        await seedSnapshot(shift(-2), 0);
        await seedTransactions(shift(-3), [1000]);
        await seedTransactions(shift(-2), [2000]);

        const result = await repairSnapshotRevenue({ dryRun: true });

        expect(result.checked).toBe(2);
        expect(result.recordedBefore).toBeCloseTo(0, 2);
        expect(result.actualTotal).toBeCloseTo(3000, 2);
        expect(result.sample.length).toBeGreaterThan(0);
        expect(result.sample[0]).toMatchObject({ date: expect.any(String), from: 0 });
    });
});

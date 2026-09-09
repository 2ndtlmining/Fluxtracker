import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Team Funded historical trend (issue #146): per-day revenue summed from a given address
 * list. Runs the REAL sqliteAdapter functions against a real temp-file database, same
 * pattern as nodeIpClassification.test.js -- DB_PATH must be set before the dynamic import
 * since sqliteAdapter reads it at module load.
 */

const tmpPath = path.join(os.tmpdir(), `daily-revenue-from-addresses-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const A = 't1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 't1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const OTHER = 't1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

function insertTx(txid, fromAddress, amount, amountUsd, date) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date)
        VALUES (?, 'dest', ?, ?, ?, ?, 0, ?)
    `).run(txid, fromAddress, amount, amountUsd, 1000, date);
}

beforeAll(async () => {
    await adapter.initDatabase();
    insertTx('tx-1', A, 100, 5.5, '2026-08-10');
    insertTx('tx-2', A, 50, 2.75, '2026-08-10');
    insertTx('tx-3', B, 25, 1.25, '2026-08-11');
    insertTx('tx-4', OTHER, 900, 45, '2026-08-11'); // not in the address list
    insertTx('tx-5', A, 999, 50, '2026-08-20'); // outside the range
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getDailyRevenueFromAddressesInRange', () => {
    it('sums FLUX revenue per day for a single address', async () => {
        const rows = await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', [A]);
        expect(rows).toEqual([{ date: '2026-08-10', daily_revenue: 150 }]);
    });

    it('sums across several addresses on the same day', async () => {
        const rows = await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', [A, B]);
        expect(rows).toEqual([
            { date: '2026-08-10', daily_revenue: 150 },
            { date: '2026-08-11', daily_revenue: 25 }
        ]);
    });

    it('excludes an address not in the list', async () => {
        const rows = await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', [A]);
        const total = rows.reduce((sum, r) => sum + r.daily_revenue, 0);
        expect(total).toBe(150); // not 150 + 900 from OTHER
    });

    it('respects the date range', async () => {
        const rows = await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', [A]);
        expect(rows.find(r => r.date === '2026-08-20')).toBeUndefined();
    });

    it('returns [] for an empty or missing address list, without querying', async () => {
        expect(await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', [])).toEqual([]);
        expect(await adapter.getDailyRevenueFromAddressesInRange('2026-08-10', '2026-08-16', null)).toEqual([]);
    });
});

describe('getDailyRevenueUSDFromAddressesInRange', () => {
    it('sums USD revenue per day for a single address', async () => {
        const rows = await adapter.getDailyRevenueUSDFromAddressesInRange('2026-08-10', '2026-08-16', [A]);
        expect(rows).toEqual([{ date: '2026-08-10', daily_revenue_usd: 8.25 }]);
    });

    it('sums across several addresses on the same day', async () => {
        const rows = await adapter.getDailyRevenueUSDFromAddressesInRange('2026-08-10', '2026-08-16', [A, B]);
        expect(rows).toEqual([
            { date: '2026-08-10', daily_revenue_usd: 8.25 },
            { date: '2026-08-11', daily_revenue_usd: 1.25 }
        ]);
    });

    it('returns [] for an empty or missing address list', async () => {
        expect(await adapter.getDailyRevenueUSDFromAddressesInRange('2026-08-10', '2026-08-16', [])).toEqual([]);
        expect(await adapter.getDailyRevenueUSDFromAddressesInRange('2026-08-10', '2026-08-16', null)).toEqual([]);
    });
});

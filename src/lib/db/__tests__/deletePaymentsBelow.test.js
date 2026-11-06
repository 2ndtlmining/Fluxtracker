import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #567: removes spec-update fees stored before MIN_PAYMENT_FLUX existed. Runs the REAL
 * sqliteAdapter against a temp-file database, because a wrong comparison here deletes revenue.
 */

const tmpPath = path.join(os.tmpdir(), `delete-payments-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

let n = 0;
function pay(amount, date) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date)
        VALUES (?, 'dest', 'payer', ?, 0, ?, 0, ?)
    `).run(`tx-${++n}`, amount, n, date);
}

const amounts = () => adapter.getDb()
    .prepare('SELECT amount FROM revenue_transactions ORDER BY amount').all().map(r => r.amount);

beforeAll(async () => {
    await adapter.initDatabase();
    pay(0.02, '2026-09-10');
    pay(0.03, '2026-11-06');
    pay(0.03, '2026-11-06');
    pay(0.09999999, '2026-11-06');
    pay(0.1, '2026-11-06');
    pay(42.04, '2026-11-06');
});

afterAll(async () => {
    adapter.getDb().close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpPath + suffix, { force: true });
});

describe('deletePaymentsBelow (sqlite)', () => {
    it('deletes only rows under the cutoff and names each affected date once', async () => {
        const result = await adapter.deletePaymentsBelow(0.1);

        expect(result.deleted).toBe(4);
        expect(result.dates.sort()).toEqual(['2026-09-10', '2026-11-06']);
        expect(amounts()).toEqual([0.1, 42.04]);
    });

    it('finds nothing the second time', async () => {
        expect(await adapter.deletePaymentsBelow(0.1)).toEqual({ deleted: 0, dates: [] });
        expect(amounts()).toEqual([0.1, 42.04]);
    });
});

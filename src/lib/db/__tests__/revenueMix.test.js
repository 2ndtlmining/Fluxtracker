import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { shapeMixRows, mixFields } from '../../utils/revenueSources.js';

/**
 * Revenue mix (issue #262 part 2): new apps vs renewals/updates, enterprise, and days bought
 * per payment. Runs the REAL sqliteAdapter function against a temp-file database, like
 * payerBase.test.js. Migration 020 holds the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `revenue-mix-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

let n = 0;
function insertTx(date, amount, usd, msgType, enterprise, expireBlocks) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date,
                                          msg_type, enterprise, expire_blocks, instances)
        VALUES (?, 'dest', 'payer', ?, ?, 1000, 0, ?, ?, ?, ?, 3)
    `).run(`tx-${++n}`, amount, usd, date, msgType, enterprise, expireBlocks);
}

beforeAll(async () => {
    await adapter.initDatabase();
    insertTx('2026-09-01', 100, 50, 'register', 0, 88000);   // new, 1 month
    insertTx('2026-09-01', 300, 150, 'update', 1, 20160);    // enterprise renewal, 1 week
    insertTx('2026-09-01', 50, null, null, null, null);      // never matched to a message
    insertTx('2026-09-02', 20, 10, 'update', 0, 264000);     // 3 months
    insertTx('2026-10-01', 999, 999, 'register', 0, 88000);  // outside the range
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getDailyRevenueMixInRange (#262)', () => {
    it('splits each day by message type and enterprise, unmatched payments in the total only', async () => {
        const rows = shapeMixRows(await adapter.getDailyRevenueMixInRange('2026-09-01', '2026-09-30'));
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            date: '2026-09-01', total_flux: 450,
            new_flux: 100, new_usd: 50, update_flux: 300, update_usd: 150,
            enterprise_flux: 300, enterprise_usd: 150, commitment_payments: 2
        });
        // (88000 + 20160) / 2880 days
        expect(rows[0].commitment_days_sum).toBeCloseTo(37.5556, 3);
        expect(rows[1]).toMatchObject({ date: '2026-09-02', total_flux: 20, new_flux: 0, update_flux: 20, enterprise_flux: 0 });
        expect(rows[1].commitment_days_sum).toBeCloseTo(91.6667, 3);
    });
});

describe('shapeMixRows / mixFields (#262)', () => {
    it('coerces string numbers and drops rows without a date', () => {
        expect(shapeMixRows([{ date: '2026-09-01T00:00:00Z', total_flux: '5', commitment_payments: '2' }, {}]))
            .toEqual([expect.objectContaining({ date: '2026-09-01', total_flux: 5, commitment_payments: 2, new_flux: 0 })]);
        expect(shapeMixRows(null)).toEqual([]);
    });

    it('computes shares of total FLUX and the per-payment commitment', () => {
        const f = mixFields({ new_flux: 100, update_flux: 300, enterprise_flux: 300, commitment_days_sum: 60, commitment_payments: 2 }, 450);
        expect(f.mix_new_percent).toBeCloseTo(22.22, 2);
        expect(f.mix_update_percent).toBeCloseTo(66.67, 2);
        expect(f.mix_enterprise_percent).toBeCloseTo(66.67, 2);
        expect(f.mix_commitment_days).toBe(30);
    });

    it('is all zeros for a day with no mix row or no revenue -- never NaN', () => {
        const f = mixFields(undefined, 0);
        expect(Object.values(f).every(v => v === 0)).toBe(true);
    });
});

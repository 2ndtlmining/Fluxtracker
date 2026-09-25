import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { bruteForceRunRate, monthlyRunRate } from '../../utils/runRate.js';

/**
 * Run-rate (issue #263): each payment's USD spread over the days it bought. The REAL
 * sqliteAdapter query (running sums over start/end events) is checked against a plain
 * day-by-day loop over the same payments. Migration 021 holds the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `run-rate-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const PAYMENTS = [
    { date: '2026-08-01', usd: 300, expire: 88000 },    // ~30.6 days
    { date: '2026-08-10', usd: 70, expire: 20160 },     // exactly 7 days
    { date: '2026-08-15', usd: 1000, expire: 264000 },  // ~91.7 days, runs past the range
    { date: '2026-08-20', usd: 50, expire: null },      // no known term: left out
    { date: '2026-08-21', usd: null, expire: 20160 },   // no USD value: left out
    { date: '2026-09-30', usd: 999, expire: 20160 }     // after the range: left out
];

let n = 0;
beforeAll(async () => {
    await adapter.initDatabase();
    const insert = adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, expire_blocks)
        VALUES (?, 'dest', 'payer', 1, ?, 1000, 0, ?, ?)
    `);
    for (const p of PAYMENTS) insert.run(`tx-${++n}`, p.usd, p.date, p.expire);
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getDailyRunRateInRange (#263)', () => {
    it('matches a day-by-day loop over the payments, for every day in the range', async () => {
        const rows = await adapter.getDailyRunRateInRange('2026-08-05', '2026-09-20');
        const expected = bruteForceRunRate(PAYMENTS, '2026-08-05', '2026-09-20');
        expect(rows.map(r => r.date)).toEqual(expected.map(r => r.date));
        rows.forEach((row, i) => {
            expect(row.daily_rate_usd).toBeCloseTo(expected[i].daily_rate_usd, 6);
            expect(row.deferred_usd).toBeCloseTo(expected[i].deferred_usd, 6);
        });
    });

    it('spreads a payment evenly and ends it after its term', async () => {
        const [aug10] = await adapter.getDailyRunRateInRange('2026-08-10', '2026-08-10');
        // 300/30.556 + 70/7 per day; the 7-day payment is still fully unconsumed at day start
        expect(aug10.daily_rate_usd).toBeCloseTo(300 / (88000 / 2880) + 10, 6);
        const [aug17] = await adapter.getDailyRunRateInRange('2026-08-17', '2026-08-17');
        expect(aug17.daily_rate_usd).toBeCloseTo(300 / (88000 / 2880) + 1000 / (264000 / 2880), 6);
    });

    it('returns nothing when there are no payments', async () => {
        expect(await adapter.getDailyRunRateInRange('2020-01-01', '2020-01-31')).toEqual([]);
    });
});

describe('monthlyRunRate', () => {
    it('scales a daily rate to an average month', () => {
        expect(monthlyRunRate(100)).toBeCloseTo(3043.75, 2);
        expect(monthlyRunRate(null)).toBe(0);
    });
});

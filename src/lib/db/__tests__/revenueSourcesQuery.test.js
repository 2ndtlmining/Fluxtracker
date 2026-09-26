import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { mergeRevenueSources } from '../../utils/revenueSources.js';

/**
 * Issue #386: the Revenue Sources endpoint in one query instead of six. The single query must
 * give exactly what the six separate reads gave -- checked against the real SQLite adapter,
 * both paths through the same mergeRevenueSources. Migration 027 is the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `revenue-sources-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const a = await import('../adapters/sqliteAdapter.js');

const TEAM = ['t1TEAM'];
const FIAT = ['t1FIATa', 't1FIATb'];
let n = 0;
function pay(date, from, amount, usd) {
    a.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date)
        VALUES (?, 'dest', ?, ?, ?, 1000, 0, ?)
    `).run(`tx-${++n}`, from, amount, usd, date);
}

beforeAll(async () => {
    await a.initDatabase();
    pay('2026-09-01', 't1TEAM', 100, 7);
    pay('2026-09-01', 't1FIATa', 50, 3.5);
    pay('2026-09-01', 't1FIATb', 20, null);   // USD not known yet: counts as 0
    pay('2026-09-01', 'customer', 30, 2);
    pay('2026-09-02', 'customer', 10, 0.7);   // a day with no team or fiat payment
    pay('2026-10-01', 't1TEAM', 999, 99);     // outside the range
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getDailyRevenueSourcesInRange (#386)', () => {
    it('matches the six separate reads exactly', async () => {
        const [s, e] = ['2026-09-01', '2026-09-30'];
        const six = mergeRevenueSources({
            total: await a.getDailyRevenueInRange(s, e),
            totalUsd: await a.getDailyRevenueUSDInRange(s, e),
            team: await a.getDailyRevenueFromAddressesInRange(s, e, TEAM),
            teamUsd: await a.getDailyRevenueUSDFromAddressesInRange(s, e, TEAM),
            fiat: await a.getDailyRevenueFromAddressesInRange(s, e, FIAT),
            fiatUsd: await a.getDailyRevenueUSDFromAddressesInRange(s, e, FIAT)
        });
        const rows = await a.getDailyRevenueSourcesInRange(s, e, TEAM, FIAT);
        const col = (f, as) => rows.map(r => ({ date: r.date, [as]: r[f] }));
        const one = mergeRevenueSources({
            total: col('total_flux', 'daily_revenue'), totalUsd: col('total_usd', 'daily_revenue_usd'),
            team: col('team_flux', 'daily_revenue'), teamUsd: col('team_usd', 'daily_revenue_usd'),
            fiat: col('fiat_flux', 'daily_revenue'), fiatUsd: col('fiat_usd', 'daily_revenue_usd')
        });
        expect(one).toEqual(six);
        expect(one[0]).toMatchObject({ date: '2026-09-01', total_flux: 200, team_flux: 100, fiat_flux: 70, organic_flux: 100, crypto_flux: 130 });
        expect(one).toHaveLength(2);
    });

    it('works with empty address lists', async () => {
        const rows = await a.getDailyRevenueSourcesInRange('2026-09-01', '2026-09-30', [], []);
        expect(rows[0]).toMatchObject({ total_flux: 200, team_flux: 0, fiat_flux: 0 });
    });
});

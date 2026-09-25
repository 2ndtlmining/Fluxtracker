import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Payer base (issue #267): paying wallets per month (new vs returning) and revenue
 * concentration across apps. Runs the REAL sqliteAdapter functions against a temp-file
 * database, like dailyRevenueFromAddresses.test.js. Migration 018 holds the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `payer-base-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const TEAM = 't1TEAMTEAMTEAMTEAMTEAMTEAMTEAMTEAMT';
let n = 0;
function insertTx(fromAddress, amount, date, appName = null) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name)
        VALUES (?, 'dest', ?, ?, 0, 1000, 0, ?, ?)
    `).run(`tx-${++n}`, fromAddress, amount, date, appName);
}

beforeAll(async () => {
    await adapter.initDatabase();
    insertTx('alice', 10, '2026-06-05', 'app1');   // alice's first payment: June
    insertTx('alice', 10, '2026-07-02', 'app1');   // returning in July
    insertTx('alice', 10, '2026-07-20', 'app1');   // twice in July still counts once
    insertTx('bob', 50, '2026-07-10', 'app2');     // new in July
    insertTx('carol', 5, '2025-01-01', 'app3');    // first paid long before the range...
    insertTx('carol', 5, '2026-07-15', 'app3');    // ...so she is returning in July
    insertTx(TEAM, 1000, '2026-07-01', 'app4');    // excluded
    insertTx('Unknown', 7, '2026-07-01', 'app5');  // not a wallet
    insertTx('dave', 1, '2026-08-01', null);       // no app name: not in concentration
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getMonthlyPayerStats (#267)', () => {
    it('counts distinct payers per month, new = first payment ever in that month', async () => {
        const rows = await adapter.getMonthlyPayerStats('2026-06-01', '2026-08-31', [TEAM]);
        expect(rows).toEqual([
            { month: '2026-06-01', payers: 1, new_payers: 1 },   // alice
            { month: '2026-07-01', payers: 3, new_payers: 1 },   // alice, bob (new), carol
            { month: '2026-08-01', payers: 1, new_payers: 1 }    // dave
        ]);
    });

    it('excludes the given addresses and the Unknown placeholder', async () => {
        const july = (await adapter.getMonthlyPayerStats('2026-07-01', '2026-07-31', [TEAM]))[0];
        expect(july.payers).toBe(3);
        const withTeam = (await adapter.getMonthlyPayerStats('2026-07-01', '2026-07-31', []))[0];
        expect(withTeam.payers).toBe(4);
    });
});

describe('getAppRevenueConcentration (#267)', () => {
    it('reports the total, app count, top ten and how few apps make 80%', async () => {
        const c = await adapter.getAppRevenueConcentration();
        // app4 1000, app2 50, app1 30, app3 10, app5 7 = 1097 across 5 named apps
        expect(c).toEqual({ total_revenue: 1097, app_count: 5, top10_revenue: 1097, apps_for_80pct: 1 });
    });
});

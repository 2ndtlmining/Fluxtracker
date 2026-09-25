import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { GAME_APP_NAME_PATTERN, resolveGameFromAppName } from '../../config.js';
import { shapeGameRevenueRows, summarizeGameRevenue } from '../../utils/gameRevenue.js';

/**
 * Game-server revenue (issue #265). The REAL sqliteAdapter query against a temp-file
 * database, with the pattern built from config.js. Migration 024 holds the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `game-revenue-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

let n = 0;
function pay(date, app, flux, usd) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name)
        VALUES (?, 'dest', 'payer', ?, ?, 1000, 0, ?, ?)
    `).run(`tx-${++n}`, flux, usd, date, app);
}

const NAMES = [
    'palworld1790087212677',            // game
    'Minecraftbedrockserver1790300670978', // game, mixed case
    'palworld16slots',                  // hand-named: NOT the game-site pattern
    'wordpress1790087212677',           // a dedicated site, but not a game
    null                                // no app name
];

beforeAll(async () => {
    await adapter.initDatabase();
    pay('2026-09-01', NAMES[0], 100, 7);
    pay('2026-09-01', NAMES[1], 50, 3.5);
    pay('2026-09-01', NAMES[2], 40, 2.8);
    pay('2026-09-01', NAMES[3], 10, 0.7);
    pay('2026-09-02', NAMES[4], 20, null);
    pay('2026-09-03', NAMES[0], 30, null);   // no USD value yet
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('GAME_APP_NAME_PATTERN', () => {
    it('agrees with resolveGameFromAppName on every name', () => {
        const re = new RegExp(GAME_APP_NAME_PATTERN);
        for (const name of NAMES.filter(Boolean)) {
            expect(re.test(name.toLowerCase()), name).toBe(resolveGameFromAppName(name) !== null);
        }
    });
});

describe('hand-deployed game servers (#395)', () => {
    it('counts a payment once game_name is recorded, even without a game-site name', async () => {
        adapter.getDb().prepare(`
            INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name)
            VALUES ('tx-rust', 'dest', 'payer', 25, 2, 1000, 0, '2026-08-15', 'rustserver')
        `).run();
        const before = shapeGameRevenueRows(await adapter.getDailyGameRevenueInRange('2026-08-15', '2026-08-15', GAME_APP_NAME_PATTERN));
        expect(before[0].game_flux).toBe(0);

        const updated = await adapter.updateTransactionGameBatch([{ txid: 'tx-rust', game_name: 'Rust' }, { txid: 'tx-rust', game_name: null }]);
        expect(updated).toBe(1);
        const after = shapeGameRevenueRows(await adapter.getDailyGameRevenueInRange('2026-08-15', '2026-08-15', GAME_APP_NAME_PATTERN));
        expect(after[0]).toMatchObject({ game_flux: 25, game_usd: 2 });

        // Only rows with no game yet are touched: re-running never overwrites.
        expect(await adapter.updateTransactionGameBatch([{ txid: 'tx-rust', game_name: 'Other' }])).toBe(0);
    });
});

describe('getDailyGameRevenueInRange (#265)', () => {
    it('sums game-site app names per day, beside the day total', async () => {
        const rows = shapeGameRevenueRows(await adapter.getDailyGameRevenueInRange('2026-09-01', '2026-09-30', GAME_APP_NAME_PATTERN));
        expect(rows).toEqual([
            { date: '2026-09-01', total_flux: 200, game_flux: 150, game_usd: 10.5 },
            { date: '2026-09-02', total_flux: 20, game_flux: 0, game_usd: 0 },
            { date: '2026-09-03', total_flux: 30, game_flux: 30, game_usd: 0 }
        ]);
    });

    it('summarises a window as $, FLUX and share of all revenue', async () => {
        const summary = summarizeGameRevenue(await adapter.getDailyGameRevenueInRange('2026-09-01', '2026-09-30', GAME_APP_NAME_PATTERN));
        expect(summary).toEqual({ usd: 10.5, flux: 180, sharePercent: 72 });
        expect(summarizeGameRevenue([])).toEqual({ usd: 0, flux: 0, sharePercent: null });
    });
});

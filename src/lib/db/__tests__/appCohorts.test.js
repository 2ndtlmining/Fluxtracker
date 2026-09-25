import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { shapeCohortRows } from '../../utils/appCohorts.js';

/**
 * App retention cohorts (issue #264). Runs the REAL sqliteAdapter query against a temp-file
 * database. Migration 022 holds the Postgres twin.
 */

const tmpPath = path.join(os.tmpdir(), `app-cohorts-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const WEEK = 20160;   // 7 days
const MONTH = 88000;  // ~30.6 days
const TODAY = '2026-09-25';

let n = 0;
function pay(app, date, msgType, expire) {
    adapter.getDb().prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name, msg_type, expire_blocks)
        VALUES (?, 'dest', 'payer', 1, 1, ?, 0, ?, ?, ?, ?)
    `).run(`tx-${++n}`, n, date, app, msgType, expire);
}

beforeAll(async () => {
    await adapter.initDatabase();
    // March cohort
    pay('short', '2026-03-01', 'register', WEEK);         // dies after 7 days
    pay('monthly', '2026-03-05', 'register', MONTH);      // renewed monthly until today
    for (const d of ['2026-04-04', '2026-05-04', '2026-06-03', '2026-07-03', '2026-08-02', '2026-09-01']) {
        pay('monthly', d, 'update', MONTH);
    }
    pay('reused', '2026-03-10', 'register', WEEK);        // life 1: March, dies
    pay('reused', '2026-08-01', 'register', MONTH);       // life 2: a NEW app in August
    pay('old', '2026-03-12', 'update', MONTH);            // no registration seen: left out
    // September cohort -- too young for 30-day survival
    pay('fresh', '2026-09-20', 'register', WEEK);
    pay('nometa', '2026-09-21', null, null);              // never matched to a message
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getAppCohorts (#264)', () => {
    it('groups app lives by registration month, a reused name counting as a new app', async () => {
        const rows = shapeCohortRows(await adapter.getAppCohorts('2026-01-01', TODAY, TODAY));
        expect(rows.map(r => [r.date, r.new_apps])).toEqual([
            ['2026-03-01', 3], ['2026-08-01', 1], ['2026-09-01', 1]
        ]);
    });

    it('counts survival only among lives old enough to know', async () => {
        const [march, august, september] = shapeCohortRows(await adapter.getAppCohorts('2026-01-01', TODAY, TODAY));
        expect(march).toMatchObject({ eligible_30: 3, survived_30: 1, eligible_180: 3, survived_180: 1, paid_again: 1, still_active: 1 });
        expect(march.survival_30_percent).toBeCloseTo(33.33, 2);
        // August's app (Aug 1 + 30.6 days) lived past 30 days but has lapsed by today
        expect(august).toMatchObject({ eligible_30: 1, survived_30: 1, eligible_90: 0, still_active: 0 });
        expect(august.survival_90_percent).toBeNull();
        // September is five days old: no survival figure at all, never 0%
        expect(september).toMatchObject({ eligible_30: 0, still_active: 1 });
        expect(september.survival_30_percent).toBeNull();
        expect(september.still_active_percent).toBe(100);
    });

    it('filters on the registration month', async () => {
        const rows = await adapter.getAppCohorts('2026-08-15', TODAY, TODAY);
        expect(rows.map(r => r.month)).toEqual(['2026-08-01', '2026-09-01']);
    });
});

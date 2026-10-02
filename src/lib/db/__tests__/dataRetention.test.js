import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { DATA_RETENTION_DAYS } from '../../config.js';

/**
 * Data retention: the database keeps 10 years. deleteOldSnapshots()/deleteOldTransactions()
 * are not scheduled anywhere, but if they ever are, their default cutoff must be the config
 * value -- not the old hard-coded 365, which would have wiped everything before last year.
 * Runs the REAL sqliteAdapter against a temp-file database.
 */

const tmpPath = path.join(os.tmpdir(), `data-retention-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
    await adapter.initDatabase();
    const db = adapter.getDb();
    for (const [date, label] of [[daysAgo(2), 'recent'], [daysAgo(3 * 365), 'three-years'], [daysAgo(9 * 365), 'nine-years'], [daysAgo(11 * 365), 'eleven-years']]) {
        db.prepare('INSERT INTO daily_snapshots (snapshot_date, timestamp, created_at) VALUES (?, 0, 0)').run(date);
        db.prepare(`INSERT INTO revenue_transactions (txid, address, from_address, amount, block_height, timestamp, date)
                    VALUES (?, 'dest', 'payer', 1, 1, 0, ?)`).run(`tx-${label}`, date);
    }
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('data retention', () => {
    it('is ten years', () => {
        expect(DATA_RETENTION_DAYS).toBe(3650);
    });

    it('deleteOldSnapshots keeps everything inside ten years by default', async () => {
        expect(await adapter.deleteOldSnapshots()).toBe(1);
        const kept = adapter.getDb().prepare('SELECT snapshot_date FROM daily_snapshots ORDER BY snapshot_date').all();
        expect(kept.map(r => r.snapshot_date)).toEqual([daysAgo(9 * 365), daysAgo(3 * 365), daysAgo(2)]);
    });

    it('deleteOldTransactions keeps everything inside ten years by default', async () => {
        expect(await adapter.deleteOldTransactions()).toBe(1);
        const kept = adapter.getDb().prepare('SELECT txid FROM revenue_transactions ORDER BY date').all();
        expect(kept.map(r => r.txid)).toEqual(['tx-nine-years', 'tx-three-years', 'tx-recent']);
    });
});

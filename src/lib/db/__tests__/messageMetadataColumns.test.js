import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #262 on SQLite: the four message-metadata columns are written at insert time, the
 * back-fill fills only rows that have none yet, and a database created before the columns
 * existed gains them at startup. Real adapter, temp-file database.
 */

const tmpPath = path.join(os.tmpdir(), `message-metadata-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

// A database from before #262: revenue_transactions without the new columns.
const Database = (await import('better-sqlite3')).default;
const legacy = new Database(tmpPath);
legacy.exec(`CREATE TABLE revenue_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, txid TEXT NOT NULL UNIQUE, address TEXT NOT NULL,
    from_address TEXT DEFAULT 'Unknown', amount REAL NOT NULL, amount_usd REAL,
    block_height INTEGER NOT NULL, timestamp INTEGER NOT NULL, date TEXT NOT NULL,
    app_name TEXT DEFAULT NULL, app_type TEXT DEFAULT NULL)`);
legacy.prepare(`INSERT INTO revenue_transactions (txid, address, amount, block_height, timestamp, date)
    VALUES ('old-tx', 'dest', 5, 1, 0, '2025-01-01')`).run();
legacy.close();

const adapter = await import('../adapters/sqliteAdapter.js');
const row = txid => adapter.getDb().prepare('SELECT msg_type, enterprise, expire_blocks, instances FROM revenue_transactions WHERE txid = ?').get(txid);

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('message metadata columns (#262)', () => {
    it('adds the columns to a database created before them, keeping existing rows', () => {
        expect(row('old-tx')).toEqual({ msg_type: null, enterprise: null, expire_blocks: null, instances: null });
    });

    it('writes the metadata at insert time', async () => {
        await adapter.insertTransactionsBatch([{
            txid: 'new-tx', address: 'dest', from_address: 'alice', amount: 10, amount_usd: 1,
            block_height: 2, timestamp: 0, date: '2026-09-25', app_name: 'app',
            msg_type: 'register', enterprise: true, expire_blocks: 88000, instances: 3
        }]);
        expect(row('new-tx')).toEqual({ msg_type: 'register', enterprise: 1, expire_blocks: 88000, instances: 3 });
    });

    it('the back-fill fills only rows with no metadata yet, and ignores unknown txids', async () => {
        const updated = await adapter.updateTransactionMetadataBatch([
            { txid: 'old-tx', msg_type: 'update', enterprise: false, expire_blocks: 20160, instances: 1 },
            { txid: 'new-tx', msg_type: 'update', enterprise: false, expire_blocks: 1, instances: 1 }, // already set
            { txid: 'not-a-tx', msg_type: 'register', enterprise: false, expire_blocks: 1, instances: 1 }
        ]);
        expect(updated).toBe(1);
        expect(row('old-tx')).toEqual({ msg_type: 'update', enterprise: 0, expire_blocks: 20160, instances: 1 });
        expect(row('new-tx').msg_type).toBe('register'); // never overwritten
    });
});

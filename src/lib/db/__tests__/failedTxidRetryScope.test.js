import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * The sync's retry pass recovers payments whose FETCH failed. Parked rows (no_hash,
 * fluxdrive, unregistered) already have their revenue row; handing them to the retry pass
 * marked them resolved, the app-name backfill then stopped skipping them and re-parked them,
 * and the pair looped forever. Real sqliteAdapter against a temp-file database.
 */

const tmpPath = path.join(os.tmpdir(), `failed-txid-retry-scope-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await adapter.initDatabase();
    await adapter.upsertFailedTxid('fetch-1', 'addr', 'fetch_failed');
    await adapter.upsertFailedTxid('nohash-1', '', 'no_hash');
    await adapter.upsertFailedTxid('drive-1', '', 'fluxdrive');
    await adapter.upsertFailedTxid('unreg-1', '', 'unregistered');
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getUnresolvedFailedTxids', () => {
    it('hands the retry pass only rows whose fetch failed', async () => {
        const rows = await adapter.getUnresolvedFailedTxids(200);
        expect(rows.map(r => r.txid)).toEqual(['fetch-1']);
    });

    it('keeps parked rows parked, so the auto backfill still skips them', async () => {
        for (const txid of ['nohash-1', 'drive-1', 'unreg-1']) {
            expect(await adapter.isFailedTxid(txid)).toBeTruthy();
        }
    });
});

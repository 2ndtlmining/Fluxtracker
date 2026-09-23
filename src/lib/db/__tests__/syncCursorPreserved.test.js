import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #335 — a failed revenue pass must not null the sync cursor.
 *
 * Both failure paths call updateSyncStatus('revenue', 'failed', msg, null). The upsert wrote
 * last_sync_block = null, and a null cursor makes the next progressiveSync() start at block 1:
 * a full-chain rescan after every transient failure.
 */

let captured = null;
vi.mock('../supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            upsert: (row) => {
                captured = row;
                return Promise.resolve({ error: null });
            }
        })
    }
}));

describe('Supabase updateSyncStatus keeps the cursor on a null block (issue #335)', () => {
    it('omits last_sync_block from the upsert when none is given', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        await adapter.updateSyncStatus('revenue', 'failed', 'boom', null);
        expect(captured).not.toHaveProperty('last_sync_block');
        expect(captured).toMatchObject({ sync_type: 'revenue', status: 'failed' });
    });

    it('writes the block when one is given', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        await adapter.updateSyncStatus('revenue', 'completed', null, 2974621);
        expect(captured.last_sync_block).toBe(2974621);
    });
});

describe('SQLite updateSyncStatus keeps the cursor on a null block (issue #335)', () => {
    let dbDir, db;

    beforeAll(async () => {
        dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-cursor-'));
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
        db = await import('../adapters/sqliteAdapter.js');
        await db.initDatabase();
    });

    afterAll(() => {
        try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
    });

    it('a failure after a completed pass leaves last_sync_block in place', async () => {
        await db.updateSyncStatus('revenue', 'completed', null, 2974621);
        await db.updateSyncStatus('revenue', 'failed', 'upstream timeout', null);

        const row = await db.getSyncStatus('revenue');
        expect(row.status).toBe('failed');
        expect(row.last_sync_block).toBe(2974621);
    });

    it('resetRevenueSyncBlock is still the way to clear it deliberately', async () => {
        await db.resetRevenueSyncBlock();
        expect((await db.getSyncStatus('revenue')).last_sync_block).toBeNull();
    });
});

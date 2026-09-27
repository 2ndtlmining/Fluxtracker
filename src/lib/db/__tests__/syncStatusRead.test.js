import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #429 — a failed sync_status read must throw, not return null.
 *
 * null means "no row": the revenue sync reads it as "never synced" and rescans from block 1,
 * and the KPI scheduler reads a missing receipt as "never sent" and sends again. A transient
 * read error has to look different from both.
 */

let supabaseResult = { data: null, error: null };
vi.mock('../supabaseClient.js', () => {
    const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () => Promise.resolve(supabaseResult),
        single: () => Promise.resolve(supabaseResult)
    };
    return { supabase: { from: () => query } };
});

describe('Supabase getSyncStatus (issue #429)', () => {
    it('returns the row when there is one', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        supabaseResult = { data: { sync_type: 'revenue', last_sync_block: 2986609 }, error: null };
        expect((await adapter.getSyncStatus('revenue')).last_sync_block).toBe(2986609);
    });

    it('returns null when there is no row', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        supabaseResult = { data: null, error: null };
        expect(await adapter.getSyncStatus('kpi_daily')).toBeNull();
    });

    it('throws when the read fails (postgrest-js reports network/5xx as {error})', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        supabaseResult = { data: null, error: { message: 'fetch failed', code: '' } };
        await expect(adapter.getSyncStatus('revenue')).rejects.toThrow(/getSyncStatus failed/);
    });
});

describe('SQLite getSyncStatus (issue #429)', () => {
    let dbDir, db;

    beforeAll(async () => {
        dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-read-'));
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
        db = await import('../adapters/sqliteAdapter.js');
        await db.initDatabase();
    });

    afterAll(async () => {
        try { await db.closeDatabase(); } catch { /* best effort */ }
        try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
    });

    it('returns the row, and null for a type never written', async () => {
        await db.updateSyncStatus('revenue', 'completed', null, 2986609);
        expect((await db.getSyncStatus('revenue')).last_sync_block).toBe(2986609);
        expect(await db.getSyncStatus('kpi_never_written')).toBeNull();
    });

    it('throws when the table cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        db.getDb().exec('ALTER TABLE sync_status RENAME TO sync_status_away');
        try {
            await expect(db.getSyncStatus('revenue')).rejects.toThrow(/getSyncStatus failed/);
        } finally {
            db.getDb().exec('ALTER TABLE sync_status_away RENAME TO sync_status');
        }
    });
});

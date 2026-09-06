import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Regression test for the KPI scheduler's 10-minute re-send bug.
 *
 * updateSyncStatus() used to be UPDATE-only: for sync types whose row does not exist
 * yet (the scheduler's kpi_daily/kpi_weekly/kpi_monthly/... receipts are created on
 * the fly) the UPDATE matched 0 rows and silently no-oped, so the receipt never
 * persisted and the scheduler re-sent every tick.
 *
 * The sqlite tests run the REAL adapter functions against a real temp-file database;
 * the supabase tests assert the adapter upserts (with onConflict) instead of updating.
 *
 * DB_PATH is read by sqliteAdapter at module load, so it is set before the dynamic import.
 */

const tmpPath = path.join(os.tmpdir(), `kpi-receipts-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const { supabaseUpsert, supabaseUpdate } = vi.hoisted(() => ({
    supabaseUpsert: vi.fn(() => ({ error: null })),
    supabaseUpdate: vi.fn(() => ({ error: null }))
}));

vi.mock('../supabaseClient.js', () => ({
    supabase: {
        from: vi.fn(() => ({ upsert: supabaseUpsert, update: supabaseUpdate }))
    }
}));

const adapter = await import('../adapters/sqliteAdapter.js');
const supabaseAdapter = await import('../adapters/supabaseAdapter.js');

beforeAll(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
    try { fs.unlinkSync(tmpPath + '-wal'); } catch { /* best effort */ }
    try { fs.unlinkSync(tmpPath + '-shm'); } catch { /* best effort */ }
    vi.restoreAllMocks();
});

describe('updateSyncStatus upsert (receipt persistence)', () => {
    it('creates a row for a sync type that has never been written', async () => {
        // Mirrors the scheduler exactly: no kpi_daily row exists, the first success
        // must CREATE the receipt, not silently update nothing.
        await adapter.updateSyncStatus('kpi_daily', 'completed');

        const receipt = await adapter.getSyncStatus('kpi_daily');
        expect(receipt).not.toBeNull();
        expect(receipt.sync_type).toBe('kpi_daily');
        expect(receipt.status).toBe('completed');
        expect(receipt.last_sync).toBeGreaterThan(0);
    });

    it('round-trips a second update into the same row (no duplicate)', async () => {
        await adapter.updateSyncStatus('kpi_weekly', 'completed');
        await adapter.updateSyncStatus('kpi_weekly', 'completed');

        const receipt = await adapter.getSyncStatus('kpi_weekly');
        expect(receipt.status).toBe('completed');

        // Read the raw table through a second connection to assert no duplicates
        const raw = new Database(tmpPath);
        const rows = raw.prepare('SELECT * FROM sync_status WHERE sync_type = ?').all('kpi_weekly');
        expect(rows).toHaveLength(1);
        raw.close();
    });

    it('still upserts correctly for the original seeded sync types', async () => {
        const before = await adapter.getSyncStatus('revenue');
        const beforeSync = before.last_sync;

        await adapter.updateSyncStatus('revenue', 'completed', null, 123456);

        const after = await adapter.getSyncStatus('revenue');
        expect(after.status).toBe('completed');
        expect(after.last_sync_block).toBe(123456);
        expect(after.last_sync).toBeGreaterThanOrEqual(beforeSync);

        // No duplicate row for the seeded type either
        const raw = new Database(tmpPath);
        const rows = raw.prepare('SELECT * FROM sync_status WHERE sync_type = ?').all('revenue');
        expect(rows).toHaveLength(1);
        raw.close();
    });

    it('stores the error message for failure receipts', async () => {
        await adapter.updateSyncStatus('kpi_monthly_failed', 'notified', 'Not enough historical data');

        const receipt = await adapter.getSyncStatus('kpi_monthly_failed');
        expect(receipt).not.toBeNull();
        expect(receipt.status).toBe('notified');
        expect(receipt.error_message).toBe('Not enough historical data');
    });
});

describe('supabase adapter upsert (receipt persistence)', () => {
    it('upserts the receipt with onConflict sync_type instead of a no-op update', async () => {
        await supabaseAdapter.updateSyncStatus('kpi_daily', 'completed', null, null);

        expect(supabaseUpsert).toHaveBeenCalledWith(
            expect.objectContaining({ sync_type: 'kpi_daily', status: 'completed' }),
            expect.objectContaining({ onConflict: 'sync_type' })
        );
        // The old .update().eq() form matched 0 rows on missing sync types and no-oped
        expect(supabaseUpdate).not.toHaveBeenCalled();
    });

    it('carries the error message in the upsert payload for failure receipts', async () => {
        await supabaseAdapter.updateSyncStatus('kpi_daily_failed', 'notified', 'Discord rejected the webhook');

        expect(supabaseUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                sync_type: 'kpi_daily_failed',
                status: 'notified',
                error_message: 'Discord rejected the webhook'
            }),
            expect.objectContaining({ onConflict: 'sync_type' })
        );
    });
});

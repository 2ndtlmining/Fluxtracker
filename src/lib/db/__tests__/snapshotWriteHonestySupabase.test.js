import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #220, Supabase side. The SQLite twin is covered against a real database in
 * snapshotWriteHonesty.test.js; PostgREST reports its failures as a `{ error }` in the
 * resolved response rather than a thrown exception, so the two adapters need separate
 * proof that a refused write reaches the caller.
 *
 * `PGRST204` is the real-world case: a new metric column ships before schemaMigrator has
 * added it, PostgREST's schema cache rejects the upsert, and the day is lost.
 */

/** Set by each test: the error PostgREST returns for the next write. */
let writeError = null;

vi.mock('../supabaseClient.js', () => {
    const from = () => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            single: () => Promise.resolve({ data: { id: 1, node_total: 3 }, error: null }),
            upsert: () => Promise.resolve({ error: writeError }),
            update: () => chain,
            then: (resolve) => Promise.resolve({ error: writeError }).then(resolve)
        };
        return chain;
    };
    return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

beforeEach(() => {
    writeError = null;
});

const snapshot = () => ({
    snapshot_date: '2026-09-22',
    timestamp: Date.now(),
    daily_revenue: 42,
    node_total: 7,
    sync_status: 'completed'
});

describe('createDailySnapshot surfaces a failed write (issue #220)', () => {
    it('rejects when PostgREST returns an error', async () => {
        writeError = { message: "PGRST204: Could not find the 'gaming_windrose' column" };

        await expect(adapter.createDailySnapshot(snapshot())).rejects.toThrow(/PGRST204/);
    });

    it('still resolves when the upsert succeeds', async () => {
        await expect(adapter.createDailySnapshot(snapshot())).resolves.toBeUndefined();
    });
});

describe('updateCurrentMetrics surfaces a failed write (issue #220)', () => {
    it('rejects when PostgREST returns an error', async () => {
        writeError = { message: 'permission denied for table current_metrics' };

        await expect(adapter.updateCurrentMetrics({ node_total: 5 })).rejects.toThrow(/permission denied/);
    });

    it('still resolves when the update succeeds', async () => {
        await expect(adapter.updateCurrentMetrics({ node_total: 5 })).resolves.toBeUndefined();
    });
});

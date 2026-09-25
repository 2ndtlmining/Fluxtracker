import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Median days left (migration 023), Supabase side: a deploy that lands BEFORE the owner
 * applies the migration must not lose the daily snapshot. PostgREST rejects a write that
 * names a column the table lacks (PGRST204), and createDailySnapshot lists its columns
 * explicitly -- so median_days_left is only named once it has a value, which it can only
 * get after migration 023 has added the column to current_metrics.
 */

let lastUpsert = null;
let lastUpdate = null;
let currentRow = { id: 1, node_total: 3 };

vi.mock('../supabaseClient.js', () => {
    const from = () => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            single: () => Promise.resolve({ data: currentRow, error: null }),
            maybeSingle: () => Promise.resolve({ data: currentRow, error: null }),
            upsert: (row) => { lastUpsert = row; return Promise.resolve({ error: null }); },
            update: (row) => { lastUpdate = row; return chain; },
            then: (resolve) => Promise.resolve({ error: null }).then(resolve)
        };
        return chain;
    };
    return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

beforeEach(() => {
    lastUpsert = null;
    lastUpdate = null;
    currentRow = { id: 1, node_total: 3 };
});

const snapshot = extra => ({ snapshot_date: '2026-09-26', timestamp: 1, daily_revenue: 1, sync_status: 'completed', ...extra });

describe('median_days_left before and after migration 023', () => {
    it('leaves the column out of the snapshot row while there is no value', async () => {
        await adapter.createDailySnapshot(snapshot({ median_days_left: null }));
        expect(lastUpsert).not.toHaveProperty('median_days_left');
    });

    it('writes it once there is a value', async () => {
        await adapter.createDailySnapshot(snapshot({ median_days_left: 15.5 }));
        expect(lastUpsert.median_days_left).toBe(15.5);
    });

    it('updateCurrentMetrics skips it while current_metrics has no such column', async () => {
        await adapter.updateCurrentMetrics({ unique_app_owners: 3, median_days_left: 15.5 });
        expect(lastUpdate).not.toHaveProperty('median_days_left');
    });

    it('updateCurrentMetrics writes it once the column exists', async () => {
        currentRow = { id: 1, node_total: 3, unique_app_owners: 1, median_days_left: null };
        await adapter.updateCurrentMetrics({ unique_app_owners: 3, median_days_left: 15.5 });
        expect(lastUpdate.median_days_left).toBe(15.5);
    });
});

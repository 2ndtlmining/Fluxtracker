import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Issue #430 — two overlapping updateCurrentMetrics() calls must both persist.
 *
 * It used to read the whole row and write every column back, so writer A's read, writer B's
 * read, A's write, B's write put A's columns back to their old values. The revenue scheduler
 * writes current_revenue and flux_price_usd from outside the sequential services cycle, so
 * the overlap was real. Now each call writes only the keys it was given.
 */

const updates = [];
vi.mock('../supabaseClient.js', () => {
    const from = () => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            maybeSingle: () => Promise.resolve({ data: { id: 1, node_total: 1, gaming_apps_total: 1, current_revenue: 1 }, error: null }),
            update: (row) => { updates.push(row); return chain; },
            then: (resolve) => Promise.resolve({ error: null }).then(resolve)
        };
        return chain;
    };
    return { supabase: { from } };
});

describe('Supabase updateCurrentMetrics writes only the given columns (issue #430)', () => {
    it('sends each writer\'s own columns and nothing else', async () => {
        const adapter = await import('../adapters/supabaseAdapter.js');
        await Promise.all([
            adapter.updateCurrentMetrics({ node_total: 5 }),
            adapter.updateCurrentMetrics({ gaming_apps_total: 7, current_revenue: null })
        ]);
        expect(updates).toHaveLength(2);
        expect(Object.keys(updates[0]).sort()).toEqual(['last_update', 'node_total']);
        // a null leaves the stored value alone, as before
        expect(Object.keys(updates[1]).sort()).toEqual(['gaming_apps_total', 'last_update']);
    });
});

describe('SQLite updateCurrentMetrics under overlap (issue #430)', () => {
    let dbDir, db;

    beforeAll(async () => {
        dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-race-'));
        process.env.DB_TYPE = 'sqlite';
        process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
        db = await import('../adapters/sqliteAdapter.js');
        await db.initDatabase();
    });

    afterAll(async () => {
        try { await db.closeDatabase(); } catch { /* best effort */ }
        try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
    });

    it('keeps both writers\' columns when two calls overlap', async () => {
        await db.updateCurrentMetrics({ node_total: 1, gaming_apps_total: 1, current_revenue: 10 });

        await Promise.all([
            db.updateCurrentMetrics({ node_total: 5 }),
            db.updateCurrentMetrics({ gaming_apps_total: 7 })
        ]);

        const row = await db.getCurrentMetrics();
        expect(row.node_total).toBe(5);
        expect(row.gaming_apps_total).toBe(7);
        expect(row.current_revenue).toBe(10); // untouched by either
    });
});

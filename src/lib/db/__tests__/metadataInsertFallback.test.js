import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #262: if the code reaches a Supabase database before migration 019 has added the
 * metadata columns, PostgREST rejects the whole insert. That must not stop the revenue sync:
 * the insert retries without the columns, and later chunks skip them straight away.
 */

let upserts = [];
let rejectMetadata = true;

vi.mock('../supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            upsert: rows => {
                upserts.push(rows);
                const hasMetadata = rows.some(r => 'msg_type' in r);
                if (rejectMetadata && hasMetadata) {
                    return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'enterprise' column of 'revenue_transactions' in the schema cache" } });
                }
                return Promise.resolve({ error: null });
            }
        })
    }
}));

const { insertTransactionsBatch } = await import('../adapters/supabaseAdapter.js');

const tx = i => ({
    txid: `tx-${i}`, address: 'dest', from_address: 'a', amount: 1, amount_usd: 1,
    block_height: 1, timestamp: 0, date: '2026-09-25', app_name: 'app',
    msg_type: 'register', enterprise: false, expire_blocks: 20160, instances: 1
});

describe('insertTransactionsBatch before migration 019', () => {
    beforeEach(() => { upserts = []; });

    it('retries without the metadata columns and succeeds', async () => {
        const ok = await insertTransactionsBatch([tx(1), tx(2)]);
        expect(ok).toBe(true);
        expect(upserts).toHaveLength(2);
        expect('msg_type' in upserts[1][0]).toBe(false);
        expect(upserts[1].map(r => r.txid)).toEqual(['tx-1', 'tx-2']);
    });

    it('then leaves the columns out from the start, without a failed attempt first', async () => {
        const ok = await insertTransactionsBatch([tx(3)]);
        expect(ok).toBe(true);
        expect(upserts).toHaveLength(1);
        expect('enterprise' in upserts[0][0]).toBe(false);
    });

    it('still reports a genuine failure', async () => {
        rejectMetadata = false;
        vi.resetModules();
        // A different error with the columns absent is returned as a failure, not retried.
        const { supabase } = await import('../supabaseClient.js');
        const original = supabase.from;
        supabase.from = () => ({ upsert: () => Promise.resolve({ error: { code: '23505', message: 'boom' } }) });
        const fresh = await import('../adapters/supabaseAdapter.js');
        expect(await fresh.insertTransactionsBatch([tx(4)])).toBe(false);
        supabase.from = original;
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #395: a Supabase database with migration 019 (message metadata) but not yet 026
 * (game_name) rejects an insert naming game_name. The sync must keep writing the four
 * metadata columns and leave out only game_name -- not fall back to dropping everything.
 */

let upserts = [];

vi.mock('../supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            upsert: rows => {
                upserts.push(rows);
                if (rows.some(r => 'game_name' in r)) {
                    return Promise.resolve({ error: { code: 'PGRST204', message: "Could not find the 'game_name' column of 'revenue_transactions' in the schema cache" } });
                }
                return Promise.resolve({ error: null });
            }
        })
    }
}));

const { insertTransactionsBatch } = await import('../adapters/supabaseAdapter.js');

const tx = i => ({
    txid: `tx-${i}`, address: 'dest', from_address: 'a', amount: 1, amount_usd: 1,
    block_height: 1, timestamp: 0, date: '2026-09-26', app_name: 'palworld1790087212677',
    msg_type: 'register', enterprise: false, expire_blocks: 20160, instances: 1, game_name: 'Palworld'
});

describe('insertTransactionsBatch with 019 but before 026', () => {
    beforeEach(() => { upserts = []; });

    it('retries without game_name only, keeping the message metadata', async () => {
        expect(await insertTransactionsBatch([tx(1)])).toBe(true);
        expect(upserts).toHaveLength(2);
        expect('game_name' in upserts[1][0]).toBe(false);
        expect(upserts[1][0]).toMatchObject({ msg_type: 'register', expire_blocks: 20160 });
    });

    it('then leaves game_name out from the start', async () => {
        expect(await insertTransactionsBatch([tx(2)])).toBe(true);
        expect(upserts).toHaveLength(1);
        expect('game_name' in upserts[0][0]).toBe(false);
        expect(upserts[0][0].msg_type).toBe('register');
    });
});

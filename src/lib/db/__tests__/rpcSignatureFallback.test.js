import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Deploy-order resilience for get_transactions_paginated.
 *
 * Migration 011 added p_from_addresses to the RPC. When code carrying the new argument was
 * deployed against a database that had not had the migration applied yet, PostgREST could
 * not find a function with that signature and returned PGRST202. The adapter logged the
 * error and returned an EMPTY result -- so the dashboard showed "0 transactions" next to a
 * healthy sync indicator, while 22,385 rows sat untouched in the table.
 *
 * Two defects, fixed here:
 *   1. A schema/deploy mismatch must not be indistinguishable from "there is no data".
 *   2. The new argument is optional by design (the migration gives it a SQL DEFAULT), so an
 *      un-migrated database should still serve unfiltered transactions rather than nothing.
 */

const rpc = vi.fn();
vi.mock('../supabaseClient.js', () => ({
    supabase: { rpc: (...args) => rpc(...args) }
}));

const { getTransactionsPaginated } = await import('../adapters/supabaseAdapter.js');

const ROWS = [
    { id: 1, txid: 'tx-a', amount: 10, total_count: 2 },
    { id: 2, txid: 'tx-b', amount: 20, total_count: 2 }
];

// PostgREST's "no function matches this signature" error.
const SIGNATURE_ERROR = {
    code: 'PGRST202',
    message: 'Could not find the function public.get_transactions_paginated(p_app, p_from_addresses, p_limit, p_offset, p_search) in the schema cache'
};

beforeEach(() => {
    rpc.mockReset();
});

describe('getTransactionsPaginated against an un-migrated database', () => {
    it('retries without the new argument instead of returning an empty table', async () => {
        rpc.mockResolvedValueOnce({ data: null, error: SIGNATURE_ERROR })
           .mockResolvedValueOnce({ data: ROWS, error: null });

        const result = await getTransactionsPaginated(1, 50, '', null, null);

        expect(rpc).toHaveBeenCalledTimes(2);
        // The retry must drop the argument the database does not know about.
        expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_from_addresses');
        expect(result.transactions).toHaveLength(2);
        expect(result.total).toBe(2);
    });

    it('does not silently drop an ACTIVE payer filter on the fallback path', async () => {
        // Serving unfiltered rows under a TEAM badge would be worse than an error: the user
        // would read someone else's payments as team-funded.
        rpc.mockResolvedValueOnce({ data: null, error: SIGNATURE_ERROR });

        await expect(getTransactionsPaginated(1, 50, '', null, ['t1team']))
            .rejects.toThrow(/migration/i);

        expect(rpc).toHaveBeenCalledTimes(1);
    });

    it('surfaces a non-signature error rather than reporting zero transactions', async () => {
        // A timeout or permission failure is not "no data" and must not render as an empty
        // table -- the UI has an error state for exactly this.
        rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } });

        await expect(getTransactionsPaginated(1, 50, '', null, null))
            .rejects.toThrow(/statement timeout/);
    });

    it('makes one call and no retry when the database is migrated', async () => {
        rpc.mockResolvedValue({ data: ROWS, error: null });

        const result = await getTransactionsPaginated(1, 50, '', null, null);

        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc.mock.calls[0][1]).toHaveProperty('p_from_addresses');
        expect(result.total).toBe(2);
    });

    it('still returns an empty list when the table genuinely has no matching rows', async () => {
        rpc.mockResolvedValue({ data: [], error: null });

        const result = await getTransactionsPaginated(1, 50, 'nothing-matches', null, null);

        expect(result.transactions).toEqual([]);
        expect(result.total).toBe(0);
    });
});

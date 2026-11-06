import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #567, the Supabase half. A response is capped at db-max-rows (1000), so the affected
 * dates must be paged, and the delete must not depend on getting its rows back: 1,632 rows
 * are due on the first run. A failed read must leave the table untouched.
 */

let pages = [];
let readError = null;
let deleteResult = {};
let deleteCalls = [];
let ranges = [];

vi.mock('../supabaseClient.js', () => {
    const from = (table) => {
        const chain = {
            select: () => chain,
            lt: (column, value) => { chain.filter = [column, value]; return chain; },
            order: () => chain,
            range: (start, end) => {
                ranges.push([start, end]);
                return Promise.resolve(readError ? { data: null, error: readError } : { data: pages.shift() ?? [], error: null });
            },
            delete: (options) => ({
                lt: (column, value) => {
                    deleteCalls.push({ table, column, value, options });
                    return Promise.resolve(deleteResult);
                }
            })
        };
        return chain;
    };
    return { supabase: { from } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

const rows = (count, date) => Array.from({ length: count }, () => ({ date }));

beforeEach(() => {
    pages = [];
    readError = null;
    deleteResult = { count: 0, error: null };
    deleteCalls = [];
    ranges = [];
});

describe('deletePaymentsBelow (supabase)', () => {
    it('pages past the row cap and takes the deleted count from the server', async () => {
        pages = [rows(1000, '2026-11-06'), rows(632, '2026-09-10')];
        deleteResult = { count: 1632, error: null };

        const result = await adapter.deletePaymentsBelow(0.1);

        expect(ranges).toEqual([[0, 999], [1000, 1999]]);
        expect(deleteCalls).toEqual([{
            table: 'revenue_transactions',
            column: 'amount',
            value: 0.1,
            options: { count: 'exact' }
        }]);
        expect(result.deleted).toBe(1632);
        expect(result.dates.sort()).toEqual(['2026-09-10', '2026-11-06']);
    });

    it('does not send a delete when nothing is under the cutoff', async () => {
        expect(await adapter.deletePaymentsBelow(0.1)).toEqual({ deleted: 0, dates: [] });
        expect(deleteCalls).toEqual([]);
    });

    it('deletes nothing when the dates cannot be read', async () => {
        readError = { message: 'timeout' };

        await expect(adapter.deletePaymentsBelow(0.1)).rejects.toThrow('timeout');
        expect(deleteCalls).toEqual([]);
    });

    it('reports a failed delete', async () => {
        pages = [rows(1, '2026-11-06')];
        deleteResult = { count: null, error: { message: 'denied' } };

        await expect(adapter.deletePaymentsBelow(0.1)).rejects.toThrow('denied');
    });
});

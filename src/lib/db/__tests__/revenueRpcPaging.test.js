import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Issue #227 item 2, plus the row-cap trap it sits next to.
 *
 * getRevenueFromAddressesForDateRange() paged every matching row back to Node to add up a
 * SUM the database can do itself — ceil(N/1000) sequential round trips with every row
 * transferred, on an endpoint polled by every open tab. Migration 010 already ships the
 * RPC that does it server-side.
 *
 * The four daily-revenue RPCs have the other half of the problem: they return one row per
 * day and none of them paged. PostgREST caps an RPC response at db-max-rows (1000) and
 * truncates silently, exactly as it does a table read, so at 836 days of history the
 * revenue charts were roughly 160 days from quietly losing their oldest data. That is the
 * bug #232 swept out of the table reads; these were missed because they are rpc() calls.
 */

const HARD_CAP = 1000;

/** Rows each RPC serves, set per test. */
let rpcRows = [];
let rpcCalls = [];
/** Rows the table "contains" for the head-count path. */
let tableCount = 0;
let selectCalls = [];

vi.mock('../supabaseClient.js', () => {
    const rpc = (name, params, opts) => {
        const chain = {
            range: (from, to) => {
                rpcCalls.push({ name, params, from, to });
                const width = Math.min(to - from + 1, HARD_CAP);
                return Promise.resolve({ data: rpcRows.slice(from, from + width), error: null });
            },
            // Awaiting without .range() is the silent-truncation case.
            then: (resolve) => {
                rpcCalls.push({ name, params, from: null, to: null });
                return Promise.resolve({ data: rpcRows.slice(0, HARD_CAP), error: null }).then(resolve);
            }
        };
        return chain;
    };

    const from = () => {
        const chain = {
            _head: false,
            select: (_c, o) => { if (o?.head) chain._head = true; selectCalls.push(o); return chain; },
            gte: () => chain, lte: () => chain, in: () => chain, eq: () => chain,
            order: () => chain, limit: () => chain,
            range: (f, t) => Promise.resolve({ data: [], error: null }),
            then: (resolve) => Promise.resolve(
                chain._head ? { data: null, count: tableCount, error: null } : { data: [], error: null }
            ).then(resolve)
        };
        return chain;
    };

    return { supabase: { from, rpc } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

const days = (n, key = 'daily_revenue') =>
    Array.from({ length: n }, (_, i) => ({ date: `day-${i}`, [key]: 10 }));

beforeEach(() => {
    rpcRows = [];
    rpcCalls = [];
    selectCalls = [];
    tableCount = 0;
});

describe('daily-revenue RPCs page past the 1000-row cap (issue #227)', () => {
    const cases = [
        ['getDailyRevenueInRange', 'daily_revenue', (a) => a.getDailyRevenueInRange('2024-01-01', '2026-12-31')],
        ['getDailyRevenueUSDInRange', 'daily_revenue_usd', (a) => a.getDailyRevenueUSDInRange('2024-01-01', '2026-12-31')],
        ['getDailyRevenueFromAddressesInRange', 'daily_revenue', (a) => a.getDailyRevenueFromAddressesInRange('2024-01-01', '2026-12-31', ['addr'])],
        ['getDailyRevenueUSDFromAddressesInRange', 'daily_revenue_usd', (a) => a.getDailyRevenueUSDFromAddressesInRange('2024-01-01', '2026-12-31', ['addr'])]
    ];

    for (const [name, key, call] of cases) {
        it(`${name} returns every day, not the first 1000`, async () => {
            // 2,400 days is about six and a half years — reachable, and the point is that
            // the failure is silent when it arrives.
            rpcRows = days(2400, key);

            const rows = await call(adapter);

            expect(rows).toHaveLength(2400);
        });
    }

    it('stops after a short page rather than looping forever', async () => {
        rpcRows = days(1200);

        await adapter.getDailyRevenueInRange('2024-01-01', '2026-12-31');

        expect(rpcCalls).toHaveLength(2);
    });

    it('handles an empty result', async () => {
        rpcRows = [];

        await expect(adapter.getDailyRevenueInRange('2024-01-01', '2024-01-02')).resolves.toEqual([]);
    });
});

describe('getRevenueForDateRange -- the headline revenue figure (issue #227)', () => {
    it('sums every day, not the first 1000', async () => {
        // The dashboard's revenue card, the KPI report and every daily snapshot read this.
        // It summed the RPC's rows client-side with no paging, so past 1000 days it would
        // have under-reported the total with nothing to show for it.
        rpcRows = days(2400);

        await expect(adapter.getRevenueForDateRange('2020-01-01', '2026-12-31')).resolves.toBe(24000);
    });

    it('returns 0 for a range with no revenue', async () => {
        rpcRows = [];

        await expect(adapter.getRevenueForDateRange('2026-09-01', '2026-09-02')).resolves.toBe(0);
    });
});

describe('getRevenueFromAddressesForDateRange uses the RPC (issue #227)', () => {
    it('sums server-side instead of paging every matching row', async () => {
        rpcRows = [
            { date: '2026-09-01', daily_revenue: 100.5 },
            { date: '2026-09-02', daily_revenue: 49.5 }
        ];
        tableCount = 7;

        const result = await adapter.getRevenueFromAddressesForDateRange('2026-09-01', '2026-09-02', ['addr-1']);

        expect(result).toEqual({ revenue: 150, payments: 7 });
        expect(rpcCalls[0].name).toBe('get_daily_revenue_from_addresses_in_range');
    });

    it('counts payments with a head request, transferring no rows', async () => {
        rpcRows = [{ date: '2026-09-01', daily_revenue: 10 }];
        tableCount = 4;

        await adapter.getRevenueFromAddressesForDateRange('2026-09-01', '2026-09-01', ['addr-1']);

        expect(selectCalls.some(o => o?.head === true && o?.count === 'exact')).toBe(true);
    });

    it('still short-circuits on an empty address list without touching the database', async () => {
        const result = await adapter.getRevenueFromAddressesForDateRange('2026-09-01', '2026-09-02', []);

        expect(result).toEqual({ revenue: 0, payments: 0 });
        expect(rpcCalls).toHaveLength(0);
    });

    it('pages the RPC too, so a long range is not truncated', async () => {
        rpcRows = days(2400);
        tableCount = 99;

        const result = await adapter.getRevenueFromAddressesForDateRange('2020-01-01', '2026-12-31', ['addr-1']);

        expect(result.revenue).toBe(24000);
    });
});

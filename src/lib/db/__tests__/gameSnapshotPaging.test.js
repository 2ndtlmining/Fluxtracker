import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PostgREST caps every response at db-max-rows (1000), silently. A year of history times a
 * dozen games is several thousand rows, so getGameSnapshotHistory pages with .range() --
 * this test is what proves the paging loop returns the whole range rather than the first
 * page. It mocks supabaseClient rather than talking to a real project, so the cap can be
 * simulated exactly.
 */

const PAGE_SIZE = 1000;
const ranges = [];
let totalRows = 0;

vi.mock('../supabaseClient.js', () => {
    const builder = () => {
        const chain = {
            select: () => chain,
            gte: () => chain,
            lte: () => chain,
            order: () => chain,
            range: (from, to) => {
                ranges.push([from, to]);
                const rows = [];
                for (let i = from; i <= Math.min(to, totalRows - 1); i++) {
                    rows.push({
                        snapshot_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
                        game_name: `Game${i % 12}`,
                        instance_count: i
                    });
                }
                return Promise.resolve({ data: rows, error: null });
            }
        };
        return chain;
    };
    return { supabase: { from: builder } };
});

const { getGameSnapshotHistory } = await import('../adapters/supabaseAdapter.js');

beforeEach(() => {
    ranges.length = 0;
});

describe('getGameSnapshotHistory paging', () => {
    it('returns every row of a multi-page range, not just the first 1000', async () => {
        totalRows = 2400;

        const rows = await getGameSnapshotHistory('2026-01-01', '2026-12-31');

        expect(rows).toHaveLength(2400);
        expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('stops cleanly when the row count is an exact multiple of the page size', async () => {
        totalRows = 2 * PAGE_SIZE;

        const rows = await getGameSnapshotHistory('2026-01-01', '2026-12-31');

        // Third page comes back empty -- the loop must break on it rather than spin.
        expect(rows).toHaveLength(2000);
        expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('makes a single request when the range fits in one page', async () => {
        totalRows = 42;

        const rows = await getGameSnapshotHistory('2026-09-01', '2026-09-14');

        expect(rows).toHaveLength(42);
        expect(ranges).toEqual([[0, 999]]);
    });

    it('is empty, not a throw, when the range holds no rows', async () => {
        totalRows = 0;

        await expect(getGameSnapshotHistory('2020-01-01', '2020-01-02')).resolves.toEqual([]);
    });
});

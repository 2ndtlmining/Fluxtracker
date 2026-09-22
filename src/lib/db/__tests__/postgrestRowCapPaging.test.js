import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * PostgREST caps EVERY response at db-max-rows (1000) and truncates silently -- `.limit(n)`
 * with n > 1000 is a no-op, and a plain `.select()` just stops at 1000 with no error. The
 * only way past it is a `.range()` paging loop (see getAllSnapshots / exportAllRepoSnapshots).
 *
 * Issues #217, #222 and #227 item 3 are the same bug in four more places. This mock enforces
 * the cap the way the real server does, so a missing `.range()` fails here instead of
 * silently losing rows in production.
 */

const HARD_CAP = 1000;

/** Row stores the mock serves, keyed by table. Tests set these. */
const tables = {
    daily_snapshots: [],
    revenue_transactions: [],
    repo_snapshots: [],
    node_ip_classification: []
};

/** Every `.update()` the adapter issues, so the category tests can assert what was touched. */
let updates = [];
/** Distinct image list the get_distinct_repos RPC returns. */
let distinctRepos = [];
/** Rows each set-returning RPC serves, keyed by RPC name. */
let rpcRows = {};

vi.mock('../supabaseClient.js', () => {
    const from = (table) => {
        const chain = {
            _rows: () => tables[table] || [],
            _update: null,
            _eqImage: null,
            _head: false,
            _ordered: false,
            select: (_cols, opts) => {
                if (opts?.head) chain._head = true;
                return chain;
            },
            eq: (col, val) => {
                if (col === 'image_name') chain._eqImage = val;
                return chain;
            },
            neq: () => chain,
            not: () => chain,
            is: () => chain,
            gte: () => chain,
            lte: () => chain,
            order: () => {
                chain._ordered = true;
                return chain;
            },
            limit: () => chain,
            update: (patch) => {
                chain._update = patch;
                return chain;
            },
            range: (fromIdx, toIdx) => {
                // Offset paging with no ORDER BY can skip or repeat rows between pages (#313).
                if (!chain._ordered) {
                    return Promise.resolve({ data: null, error: { message: `unordered .range() on ${table}` } });
                }
                const all = chain._rows();
                const width = Math.min(toIdx - fromIdx + 1, HARD_CAP);
                return Promise.resolve({ data: all.slice(fromIdx, fromIdx + width), error: null });
            },
            // Awaiting the chain with no .range() is the silent-truncation case.
            then: (resolve) => {
                if (chain._update) {
                    updates.push({ table, patch: chain._update, imageName: chain._eqImage });
                    return Promise.resolve({ data: null, error: null }).then(resolve);
                }
                // head:true returns the real count, uncapped — db-max-rows caps rows, not counts.
                if (chain._head) {
                    return Promise.resolve({ data: null, count: chain._rows().length, error: null }).then(resolve);
                }
                return Promise.resolve({ data: chain._rows().slice(0, HARD_CAP), error: null }).then(resolve);
            }
        };
        return chain;
    };

    // RPC results are capped exactly like table reads -- this mock used to hand back the whole
    // distinct-image list in one go, which is how #304 passed its own regression test.
    const rpc = (name) => {
        const rows = name === 'get_distinct_repos'
            ? distinctRepos.map(image_name => ({ image_name }))
            : rpcRows[name];
        const result = (data) => rows === undefined
            ? { data: null, error: { message: `unmocked rpc ${name}` } }
            : { data, error: null };
        return {
            range: (fromIdx, toIdx) => {
                const width = Math.min(toIdx - fromIdx + 1, HARD_CAP);
                return Promise.resolve(result((rows || []).slice(fromIdx, fromIdx + width)));
            },
            then: (resolve) => Promise.resolve(result((rows || []).slice(0, HARD_CAP))).then(resolve)
        };
    };

    return { supabase: { from, rpc } };
});

const adapter = await import('../adapters/supabaseAdapter.js');

const snapshots = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i, snapshot_date: `day-${i}`, total_nodes: i }));

const transactions = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: i, txid: `tx-${i}`, block_height: 1000 + i, date: '2026-09-01', app_name: `app-${i}`, app_type: null }));

beforeEach(() => {
    tables.daily_snapshots = [];
    tables.revenue_transactions = [];
    tables.repo_snapshots = [];
    tables.node_ip_classification = [];
    updates = [];
    distinctRepos = [];
    rpcRows = {};
});

describe('daily_snapshots reads page past the 1000-row cap (issue #217)', () => {
    it('getSnapshotsInRange returns every day in the range, not the first 1000', async () => {
        tables.daily_snapshots = snapshots(2400);

        const rows = await adapter.getSnapshotsInRange('2020-01-01', '2026-12-31');

        expect(rows).toHaveLength(2400);
    });

    it('getLastNSnapshots(n) returns n rows when n exceeds the cap', async () => {
        tables.daily_snapshots = snapshots(3000);

        const rows = await adapter.getLastNSnapshots(2500);

        expect(rows).toHaveLength(2500);
    });

    it('getLastNSnapshots does not over-fetch when the table is smaller than n', async () => {
        tables.daily_snapshots = snapshots(42);

        const rows = await adapter.getLastNSnapshots(9999);

        expect(rows).toHaveLength(42);
    });
});

describe('revenue_transactions reads page past the cap (issue #227 item 3)', () => {
    it('getTransactionsByDate returns every transaction for the day', async () => {
        tables.revenue_transactions = transactions(2400);

        const rows = await adapter.getTransactionsByDate('2026-09-01');

        expect(rows).toHaveLength(2400);
    });

    it('getTransactionsByBlockRange returns every transaction in the range', async () => {
        tables.revenue_transactions = transactions(1500);

        const rows = await adapter.getTransactionsByBlockRange(1000, 9999);

        expect(rows).toHaveLength(1500);
    });

    it('getUndeterminedAppNames sees names beyond the first 1000 rows', async () => {
        tables.revenue_transactions = transactions(2400);

        const names = await adapter.getUndeterminedAppNames();

        expect(names).toHaveLength(2400);
        expect(names).toContain('app-2399');
    });
});

describe('repo category writes cover every distinct image (issue #222)', () => {
    // repo_snapshots is one row per image per day, so the row count dwarfs the image count.
    // Reading the image list off the rows caps at 1000 rows -- a few days of one image --
    // while the distinct-image RPC returns the whole list in one bounded response.
    const images = (n) => Array.from({ length: n }, (_, i) => `demo/minecraft-${i}`);

    it('recategorizeAllRepos categorizes every distinct image, not just those in the first 1000 rows', async () => {
        distinctRepos = images(1200);
        tables.repo_snapshots = Array.from({ length: 50000 }, (_, i) => ({ id: i, image_name: `demo/minecraft-${i % 1200}` }));

        const result = await adapter.recategorizeAllRepos();

        const touched = new Set(updates.filter(u => u.imageName).map(u => u.imageName));
        expect(touched.size).toBe(1200);
        expect(touched.has('demo/minecraft-1199')).toBe(true);
        expect(result.resetCount).toBe(1200);
    });

    it('backfillRepoCategories drains a backlog larger than the cap', async () => {
        distinctRepos = images(1200);
        tables.repo_snapshots = Array.from({ length: 50000 }, (_, i) => ({ id: i, image_name: `demo/minecraft-${i % 1200}` }));

        const count = await adapter.backfillRepoCategories();

        const touched = new Set(updates.filter(u => u.imageName).map(u => u.imageName));
        expect(touched.size).toBe(1200);
        expect(count).toBe(1200);
    });

    it('recategorizeAllRepos never blanks the whole table first (issue #304)', async () => {
        // The old code nulled every row, then restored what the capped RPC returned. Every
        // write must now target one image -- a crash midway leaves no blank categories.
        distinctRepos = [...images(3), 'nothing/matches-this'];

        await adapter.recategorizeAllRepos();

        expect(updates.every(u => u.imageName)).toBe(true);
        const unmatched = updates.find(u => u.imageName === 'nothing/matches-this');
        expect(unmatched.patch).toEqual({ category: null });
    });

    it('recategorizeAllRepos refuses to run on an empty image list', async () => {
        distinctRepos = [];

        await expect(adapter.recategorizeAllRepos()).rejects.toThrow(/no images/);
        expect(updates).toHaveLength(0);
    });
});

describe('set-returning RPCs page past the cap (issues #304, #306)', () => {
    const days = (n) => Array.from({ length: n }, (_, i) => ({
        date: `d-${String(i).padStart(4, '0')}`, daily_revenue: 1, daily_revenue_usd: 1
    }));

    it('getDistinctRepos returns every image, not the first 1000', async () => {
        distinctRepos = Array.from({ length: 1420 }, (_, i) => `img-${i}`);

        const repos = await adapter.getDistinctRepos();

        expect(repos).toHaveLength(1420);
        expect(repos).toContain('img-1419');
    });

    it('getDailyRevenueFromTransactions keeps the NEWEST days past 1000 (ascending RPC)', async () => {
        rpcRows.get_daily_revenue = days(1200);

        const rows = await adapter.getDailyRevenueFromTransactions(9999);

        expect(rows).toHaveLength(1200);
        expect(rows.at(-1).date).toBe('d-1199');
    });

    it('getDailyRevenueUSDFromTransactions keeps the newest days too', async () => {
        rpcRows.get_daily_revenue_usd = days(1200);

        const rows = await adapter.getDailyRevenueUSDFromTransactions(9999);

        expect(rows).toHaveLength(1200);
    });

    it('getReposByCategory and getCategoryHistory page', async () => {
        rpcRows.get_repos_by_category = days(1500);
        rpcRows.get_category_history = days(1500);

        expect(await adapter.getReposByCategory('gaming')).toHaveLength(1500);
        expect(await adapter.getCategoryHistory('gaming', 1500)).toHaveLength(1500);
    });
});

describe('paged reads carry a total order (issue #313)', () => {
    it('getAllNodeIpClassifications pages with an ORDER BY', async () => {
        tables.node_ip_classification = Array.from({ length: 2631 }, (_, i) => ({ ip: `ip-${i}`, org: 'x' }));

        const rows = await adapter.getAllNodeIpClassifications();

        expect(rows).toHaveLength(2631);
    });

    it('getRevenueForBlockRange pages with an ORDER BY', async () => {
        tables.revenue_transactions = Array.from({ length: 2500 }, (_, i) => ({ id: i, amount: 2 }));

        expect(await adapter.getRevenueForBlockRange(0, 1e9)).toBe(5000);
    });
});

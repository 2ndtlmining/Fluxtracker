import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Issue #151, the Supabase half. The generic create/read pair builds its table and column
 * names from the dimension whitelist, and a wrong name there fails silently in production --
 * an upsert into a table that does not exist is an error object the caller may swallow, and
 * a select of a column that does not exist comes back empty rather than loudly.
 *
 * So: assert the exact table, the exact upsert conflict target, the exact selected columns
 * and the paging, against a mocked client.
 */

const calls = [];
let pages = [];

vi.mock('../supabaseClient.js', () => {
    const from = (table) => {
        const call = { table, select: null, upsert: null, conflict: null, ranges: [] };
        calls.push(call);

        const chain = {
            select: (columns) => { call.select = columns; return chain; },
            upsert: (rows, options) => {
                call.upsert = rows;
                call.conflict = options?.onConflict ?? null;
                return Promise.resolve({ error: null });
            },
            gte: () => chain,
            lte: () => chain,
            order: () => chain,
            range: (start, end) => {
                call.ranges.push([start, end]);
                return Promise.resolve({ data: pages.shift() ?? [], error: null });
            }
        };
        return chain;
    };

    return { supabase: { from } };
});

const adapter = await import('../adapters/supabaseAdapter.js');
const { BREAKDOWN_DIMENSIONS } = await import('../../decentralizationDimensions.js');

beforeEach(() => {
    calls.length = 0;
    pages = [];
});

describe('Supabase writes resolve names through the whitelist', () => {
    it('upserts country into its own table, on its own conflict key', async () => {
        await adapter.createDecentralizationDimensionSnapshots('country', '2026-09-01', [
            { country: 'Germany', countryCode: 'DE', count: 45 }
        ]);

        expect(calls[0].table).toBe('decentralization_country_snapshots');
        expect(calls[0].conflict).toBe('snapshot_date,country');
        expect(calls[0].upsert[0]).toMatchObject({
            snapshot_date: '2026-09-01',
            country: 'Germany',
            country_code: 'DE',
            node_count: 45
        });
    });

    it('upserts continent into its own table, on its own conflict key', async () => {
        await adapter.createDecentralizationDimensionSnapshots('continent', '2026-09-01', [
            { continent: 'Europe', continentCode: 'EU', count: 90 }
        ]);

        expect(calls[0].table).toBe('decentralization_continent_snapshots');
        expect(calls[0].conflict).toBe('snapshot_date,continent');
        expect(calls[0].upsert[0].continent_code).toBe('EU');
    });

    it('omits the code column for a dimension that has none', async () => {
        await adapter.createDecentralizationDimensionSnapshots('datacenter', '2026-09-01', [
            { org: 'Hetzner', count: 45 }
        ]);

        expect(calls[0].table).toBe('decentralization_snapshots');
        expect(Object.keys(calls[0].upsert[0])).toEqual(['snapshot_date', 'org', 'node_count', 'created_at']);
    });

    it('writes a null code rather than dropping the column', async () => {
        await adapter.createDecentralizationDimensionSnapshots('country', '2026-09-01', [
            { country: '(unknown)', countryCode: null, count: 7 }
        ]);

        expect(calls[0].upsert[0].country_code).toBeNull();
    });

    it('refuses an unknown dimension before touching the client', async () => {
        await expect(
            adapter.createDecentralizationDimensionSnapshots('asn', '2026-09-01', [{ org: 'x', count: 1 }])
        ).rejects.toThrow(/Unknown decentralization dimension/);

        expect(calls).toHaveLength(0);
    });

    it('does not call the client at all for an empty breakdown', async () => {
        await adapter.createDecentralizationDimensionSnapshots('country', '2026-09-01', []);

        expect(calls).toHaveLength(0);
    });
});

describe('Supabase reads resolve names through the whitelist', () => {
    it('selects exactly the dimension\'s columns', async () => {
        pages = [[]];
        await adapter.getDecentralizationDimensionSnapshotHistory('country', '2026-09-01', '2026-09-30');

        expect(calls[0].table).toBe('decentralization_country_snapshots');
        expect(calls[0].select).toBe('snapshot_date, country, country_code, node_count');
    });

    it('leaves the code column out of the select for the datacenter dimension', async () => {
        pages = [[]];
        await adapter.getDecentralizationDimensionSnapshotHistory('datacenter', '2026-09-01', '2026-09-30');

        expect(calls[0].select).toBe('snapshot_date, org, node_count');
    });

    it('pages past PostgREST\'s 1000-row cap instead of truncating', async () => {
        // The cap applies to every response, silently -- a year of history times dozens of
        // countries goes over it, and a missing .range() loop would just lose the tail.
        const full = new Array(1000).fill({ snapshot_date: '2026-09-01', country: 'Germany', country_code: 'DE', node_count: 1 });
        pages = [full, [{ snapshot_date: '2026-09-02', country: 'France', country_code: 'FR', node_count: 2 }]];

        const rows = await adapter.getDecentralizationDimensionSnapshotHistory('country', '2026-01-01', '2026-12-31');

        // Each page is a fresh .from() chain, so collect the ranges across all of them.
        const ranges = calls.flatMap(call => call.ranges);
        expect(rows).toHaveLength(1001);
        expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    });

    it('refuses an unknown dimension before touching the client', async () => {
        await expect(
            adapter.getDecentralizationDimensionSnapshotHistory('country; DROP TABLE daily_snapshots', '2026-09-01', '2026-09-02')
        ).rejects.toThrow(/Unknown decentralization dimension/);

        expect(calls).toHaveLength(0);
    });
});

describe('dimension names live in exactly one place', () => {
    // The point of the registry: adding a dimension is one entry, and no module outside it
    // should be naming a snapshot table. If this fails, a copy has crept back in.
    const roots = [
        'src/lib/db/adapters/sqliteAdapter.js',
        'src/lib/db/adapters/supabaseAdapter.js',
        'src/lib/services/decentralizationService.js',
        'src/lib/db/snapshotManager.js'
    ];

    /**
     * Creating the table is the one place a name legitimately appears outside the registry:
     * sqliteAdapter owns the schema. Anything else -- a SELECT, an INSERT, an upsert target --
     * is a copy that has crept back in.
     */
    const isSchemaOrComment = (line) =>
        /CREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)/i.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line);

    for (const { key, table } of Object.values(BREAKDOWN_DIMENSIONS)) {
        it(`queries ${table} only through the registry (${key})`, () => {
            for (const file of roots) {
                const offenders = fs.readFileSync(path.resolve(file), 'utf8')
                    .split('\n')
                    .filter(line => line.includes(table) && !isSchemaOrComment(line));

                expect(offenders, `${file} names ${table} outside the registry`).toEqual([]);
            }
        });
    }
});

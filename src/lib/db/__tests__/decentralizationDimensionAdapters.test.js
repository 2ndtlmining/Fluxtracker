import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #151: one generic create/read pair now serves every dimension in both adapters, in
 * place of three copies each. Two things have to hold for that to be safe:
 *
 * - every dimension still round-trips through REAL SQLite, including the code column that
 *   only some dimensions have (a wrong table or column name fails silently in production,
 *   which is exactly what a generic implementation risks); and
 * - the table and column names come from the whitelist, never from the caller -- SQL
 *   identifiers cannot be bound as parameters.
 *
 * Same real-temp-database pattern as decentralizationSnapshots.test.js.
 */

const tmpPath = path.join(os.tmpdir(), `decentralization-dimensions-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');
const { BREAKDOWN_DIMENSIONS } = await import('../../decentralizationDimensions.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

/** One fixture row per dimension, in the shape its breakdown produces. */
const FIXTURES = {
    datacenter: [
        { org: 'Hetzner Online GmbH', count: 45 },
        { org: '(independent)', count: 122 }
    ],
    country: [
        { country: 'Germany', countryCode: 'DE', count: 45 },
        { country: '(unknown)', countryCode: null, count: 7 }
    ],
    continent: [
        { continent: 'Europe', continentCode: 'EU', count: 90 },
        { continent: '(unknown)', continentCode: null, count: 7 }
    ]
};

describe('the generic adapter pair, per dimension', () => {
    for (const [key, breakdown] of Object.entries(FIXTURES)) {
        const dimension = BREAKDOWN_DIMENSIONS[key];

        it(`round-trips the ${key} dimension through its own table`, async () => {
            const written = await adapter.createDecentralizationDimensionSnapshots(key, '2026-09-01', breakdown);
            expect(written).toBe(breakdown.length);

            const rows = await adapter.getDecentralizationDimensionSnapshotHistory(key, '2026-09-01', '2026-09-01');

            expect(rows).toHaveLength(breakdown.length);
            expect(rows.map(row => row[dimension.nameColumn]).sort())
                .toEqual(breakdown.map(item => item[dimension.nameField]).sort());
            expect(rows.map(row => row.node_count).sort((a, b) => a - b))
                .toEqual(breakdown.map(item => item.count).sort((a, b) => a - b));
        });

        if (dimension.codeColumn) {
            it(`stores the ${key} code, including a null one`, async () => {
                await adapter.createDecentralizationDimensionSnapshots(key, '2026-09-04', breakdown);
                const rows = await adapter.getDecentralizationDimensionSnapshotHistory(key, '2026-09-04', '2026-09-04');

                const named = rows.find(row => row[dimension.nameColumn] === breakdown[0][dimension.nameField]);
                const sentinel = rows.find(row => row[dimension.nameColumn] === '(unknown)');

                expect(named[dimension.codeColumn]).toBe(breakdown[0][dimension.codeField]);
                expect(sentinel[dimension.codeColumn]).toBeNull();
            });
        }

        it(`upserts the ${key} dimension rather than duplicating a date`, async () => {
            await adapter.createDecentralizationDimensionSnapshots(key, '2026-09-02', breakdown);
            const updated = breakdown.map(item => ({ ...item, count: item.count + 10 }));
            await adapter.createDecentralizationDimensionSnapshots(key, '2026-09-02', updated);

            const rows = await adapter.getDecentralizationDimensionSnapshotHistory(key, '2026-09-02', '2026-09-02');

            expect(rows).toHaveLength(breakdown.length);
            expect(rows.map(row => row.node_count).sort((a, b) => a - b))
                .toEqual(updated.map(item => item.count).sort((a, b) => a - b));
        });

        it(`orders ${key} rows by date then node_count desc`, async () => {
            await adapter.createDecentralizationDimensionSnapshots(key, '2026-09-11', breakdown);
            const rows = await adapter.getDecentralizationDimensionSnapshotHistory(key, '2026-09-11', '2026-09-11');

            const counts = rows.map(row => row.node_count);
            expect(counts).toEqual([...counts].sort((a, b) => b - a));
        });

        it(`writes nothing for an empty ${key} breakdown`, async () => {
            await expect(adapter.createDecentralizationDimensionSnapshots(key, '2026-09-20', [])).resolves.toBe(0);
            await expect(adapter.createDecentralizationDimensionSnapshots(key, '2026-09-20', null)).resolves.toBe(0);
        });
    }

    it('refuses an unknown dimension instead of building a query from it', async () => {
        await expect(
            adapter.createDecentralizationDimensionSnapshots('nope', '2026-09-01', [{ org: 'x', count: 1 }])
        ).rejects.toThrow(/Unknown decentralization dimension/);

        await expect(
            adapter.getDecentralizationDimensionSnapshotHistory('country; DROP TABLE daily_snapshots', '2026-09-01', '2026-09-01')
        ).rejects.toThrow(/Unknown decentralization dimension/);
    });
});

describe('the named wrappers still behave as before', () => {
    it('writes country through the same table the generic call uses', async () => {
        await adapter.createDecentralizationCountrySnapshots('2026-09-03', [
            { country: 'Finland', countryCode: 'FI', count: 12 }
        ]);

        const viaNamed = await adapter.getDecentralizationCountrySnapshotHistory('2026-09-03', '2026-09-03');
        const viaGeneric = await adapter.getDecentralizationDimensionSnapshotHistory('country', '2026-09-03', '2026-09-03');

        expect(viaNamed).toEqual(viaGeneric);
        expect(viaNamed[0]).toMatchObject({ country: 'Finland', country_code: 'FI', node_count: 12 });
    });

    it('writes continent through the same table the generic call uses', async () => {
        await adapter.createDecentralizationContinentSnapshots('2026-09-03', [
            { continent: 'Oceania', continentCode: 'OC', count: 4 }
        ]);

        expect(await adapter.getDecentralizationContinentSnapshotHistory('2026-09-03', '2026-09-03'))
            .toEqual(await adapter.getDecentralizationDimensionSnapshotHistory('continent', '2026-09-03', '2026-09-03'));
    });

    it('keeps the datacenter dimension on its own table, with no code column', async () => {
        await adapter.createDecentralizationSnapshots('2026-09-05', [{ org: 'Scaleway', count: 9 }]);

        const rows = await adapter.getDecentralizationSnapshotHistory('2026-09-05', '2026-09-05');

        expect(rows[0]).toEqual({ snapshot_date: '2026-09-05', org: 'Scaleway', node_count: 9 });
    });
});

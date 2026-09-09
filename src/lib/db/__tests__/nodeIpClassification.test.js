import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Decentralization metric (issue #108): node_ip_classification is where classified
 * node IPs are cached. Runs the REAL sqliteAdapter functions against a real temp-file
 * database, same pattern as syncStatusReceipts.test.js -- DB_PATH must be set before the
 * dynamic import since sqliteAdapter reads it at module load. Each test uses IPs unique to
 * itself (rather than clearing the table between tests) since the adapter exposes no
 * table-reset hook and the table is additive by design.
 */

const tmpPath = path.join(os.tmpdir(), `node-ip-classification-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

/** Only the rows this test itself just wrote, filtered out of the whole-table read. */
async function readBack(ips) {
    const wanted = new Set(ips);
    const all = await adapter.getAllNodeIpClassifications();
    return all.filter(row => wanted.has(row.ip)).sort((a, b) => a.ip.localeCompare(b.ip));
}

describe('getAllNodeIpClassifications / upsertNodeIpClassifications', () => {
    it('round-trips a classification through upsert and read', async () => {
        const classifiedAt = Date.now();
        await adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.1', asn: 24940, org: 'Hetzner Online GmbH', isDatacenter: true, classifiedAt }
        ]);

        expect(await readBack(['10.10.10.1'])).toEqual([{ ip: '10.10.10.1', isDatacenter: true, classifiedAt }]);
    });

    it('stores isDatacenter=false as a real false, not just falsy', async () => {
        await adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.2', asn: 12322, org: 'Free SAS', isDatacenter: false, classifiedAt: Date.now() }
        ]);

        const [row] = await readBack(['10.10.10.2']);

        expect(row.isDatacenter).toBe(false);
    });

    it('bulk-upserts multiple rows in one call', async () => {
        const classifiedAt = Date.now();
        await adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.3', asn: 1, org: 'A', isDatacenter: true, classifiedAt },
            { ip: '10.10.10.4', asn: 2, org: 'B', isDatacenter: false, classifiedAt },
            { ip: '10.10.10.5', asn: 3, org: 'C', isDatacenter: true, classifiedAt }
        ]);

        const rows = await readBack(['10.10.10.3', '10.10.10.4', '10.10.10.5']);

        expect(rows.map(r => r.ip)).toEqual(['10.10.10.3', '10.10.10.4', '10.10.10.5']);
    });

    it('re-classifying an existing IP updates it in place rather than duplicating', async () => {
        await adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.6', asn: 1, org: 'Old Org', isDatacenter: false, classifiedAt: 1000 }
        ]);
        await adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.6', asn: 2, org: 'New Org', isDatacenter: true, classifiedAt: 2000 }
        ]);

        expect(await readBack(['10.10.10.6'])).toEqual([{ ip: '10.10.10.6', isDatacenter: true, classifiedAt: 2000 }]);
    });

    it('handles a missing/null asn or org without throwing', async () => {
        await expect(adapter.upsertNodeIpClassifications([
            { ip: '10.10.10.7', asn: null, org: null, isDatacenter: false, classifiedAt: Date.now() }
        ])).resolves.not.toThrow();
    });

    it('is a no-op for an empty or missing array', async () => {
        await expect(adapter.upsertNodeIpClassifications([])).resolves.toBe(0);
        await expect(adapter.upsertNodeIpClassifications(null)).resolves.toBe(0);
    });

    it('returns [] when nothing matches (a fresh IP with no classification yet)', async () => {
        expect(await readBack(['10.10.10.254'])).toEqual([]);
    });
});

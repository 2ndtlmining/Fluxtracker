import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Issue #311 — every table in the backup set must survive export -> wipe -> import unchanged.
 *
 * The decentralization tables are the risky ones: they are exported as table rows
 * (`country_code`, `node_count`) but re-imported through the per-date snapshot writer, which
 * takes breakdown items (`countryCode`, `count`). A mapping slip there would restore a
 * backup "successfully" with every code or count missing. This runs the real SQLite adapter.
 */

let dbDir, dbPath, BACKUP_TABLES, adapter;

beforeAll(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-roundtrip-'));
    dbPath = path.join(dbDir, 'test.sqlite3');
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = dbPath;
    adapter = await import('../adapters/sqliteAdapter.js');
    await adapter.initDatabase();
    ({ BACKUP_TABLES } = await import('../../services/backupTables.js'));

    await adapter.createDecentralizationDimensionSnapshots('datacenter', '2026-09-21', [
        { org: 'Hetzner Online GmbH', count: 777 }, { org: '(independent)', count: 1100 }
    ]);
    await adapter.createDecentralizationDimensionSnapshots('country', '2026-09-21', [
        { country: 'Germany', countryCode: 'DE', count: 900 }, { country: '(unknown)', countryCode: null, count: 4 }
    ]);
    await adapter.createDecentralizationDimensionSnapshots('country', '2026-09-22', [
        { country: 'Germany', countryCode: 'DE', count: 910 }
    ]);
    await adapter.createDecentralizationDimensionSnapshots('continent', '2026-09-22', [
        { continent: 'Europe', continentCode: 'EU', count: 1900 }
    ]);
    await adapter.upsertNodeIpClassifications([
        { ip: '10.0.0.1', asn: 24940, org: 'Hetzner Online GmbH', isDatacenter: true, classifiedAt: 1,
          country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' }
    ]);
});

afterAll(() => {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

const tablesUnderTest = ['decentralization_snapshots', 'decentralization_country_snapshots',
    'decentralization_continent_snapshots', 'node_ip_classification'];

describe('backup tables round-trip through export -> wipe -> import (issue #311)', () => {
    it.each(tablesUnderTest)('%s comes back identical', async (table) => {
        const entry = BACKUP_TABLES.find(t => t.table === table);
        const before = await entry.exportRows();
        expect(before.length).toBeGreaterThan(0);

        const raw = new Database(dbPath);
        raw.prepare(`DELETE FROM ${table}`).run();
        raw.close();
        expect(await entry.exportRows()).toHaveLength(0);

        await entry.importRows(JSON.parse(JSON.stringify(before))); // as it would arrive from R2
        expect(await entry.exportRows()).toEqual(before);
    });

    it('every backed-up table has an export and an import', () => {
        for (const entry of BACKUP_TABLES) {
            expect(typeof entry.exportRows).toBe('function');
            expect(typeof entry.importRows).toBe('function');
        }
    });
});

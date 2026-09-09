import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Decentralization historical snapshots (issue #108 Phase 3): decentralization_snapshots
 * is where the daily per-provider breakdown is stored. Runs the REAL sqliteAdapter
 * functions against a real temp-file database, same pattern as nodeIpClassification.test.js.
 */

const tmpPath = path.join(os.tmpdir(), `decentralization-snapshots-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await adapter.initDatabase();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('createDecentralizationSnapshots / getDecentralizationSnapshotHistory', () => {
    it('round-trips a per-provider breakdown for one date', async () => {
        await adapter.createDecentralizationSnapshots('2026-09-01', [
            { org: 'Hetzner Online GmbH', count: 45 },
            { org: 'OVH SAS', count: 31 },
            { org: '(independent)', count: 122 }
        ]);

        const rows = await adapter.getDecentralizationSnapshotHistory('2026-09-01', '2026-09-01');

        expect(rows.map(r => ({ org: r.org, count: r.node_count })).sort((a, b) => a.org.localeCompare(b.org))).toEqual([
            { org: '(independent)', count: 122 },
            { org: 'Hetzner Online GmbH', count: 45 },
            { org: 'OVH SAS', count: 31 }
        ]);
    });

    it('is ordered by date then node_count desc within a date', async () => {
        await adapter.createDecentralizationSnapshots('2026-09-02', [
            { org: 'Small Provider', count: 3 },
            { org: 'Big Provider', count: 99 }
        ]);

        const rows = await adapter.getDecentralizationSnapshotHistory('2026-09-02', '2026-09-02');

        expect(rows.map(r => r.org)).toEqual(['Big Provider', 'Small Provider']);
    });

    it('re-snapshotting the same date updates counts in place rather than duplicating', async () => {
        await adapter.createDecentralizationSnapshots('2026-09-03', [{ org: 'Provider X', count: 10 }]);
        await adapter.createDecentralizationSnapshots('2026-09-03', [{ org: 'Provider X', count: 15 }]);

        const rows = await adapter.getDecentralizationSnapshotHistory('2026-09-03', '2026-09-03');

        expect(rows).toEqual([expect.objectContaining({ org: 'Provider X', node_count: 15 })]);
    });

    it('filters correctly to an inclusive date range', async () => {
        await adapter.createDecentralizationSnapshots('2026-09-10', [{ org: 'Range Test', count: 1 }]);
        await adapter.createDecentralizationSnapshots('2026-09-11', [{ org: 'Range Test', count: 2 }]);
        await adapter.createDecentralizationSnapshots('2026-09-12', [{ org: 'Range Test', count: 3 }]);

        const rows = await adapter.getDecentralizationSnapshotHistory('2026-09-10', '2026-09-11');

        expect(rows.map(r => r.snapshot_date)).toEqual(['2026-09-10', '2026-09-11']);
    });

    it('is a no-op for an empty or missing breakdown', async () => {
        await expect(adapter.createDecentralizationSnapshots('2026-09-20', [])).resolves.toBe(0);
        await expect(adapter.createDecentralizationSnapshots('2026-09-20', null)).resolves.toBe(0);
    });

    it('returns [] for a date range with nothing snapshotted', async () => {
        expect(await adapter.getDecentralizationSnapshotHistory('2020-01-01', '2020-01-02')).toEqual([]);
    });
});

describe('daily_snapshots decentralization columns (schemaMigrator FIXED_COLUMNS)', () => {
    it('the three new columns exist on daily_snapshots after schema migration', async () => {
        const columns = adapter.getDb().pragma('table_info(daily_snapshots)').map(c => c.name);
        expect(columns).toContain('decentralization_datacenter_count');
        expect(columns).toContain('decentralization_independent_count');
        expect(columns).toContain('decentralization_datacenter_percent');
    });
});

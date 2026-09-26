import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Issue #389: getSnapshotsInRange can read a named subset of columns instead of all ~64.
const tmpPath = path.join(os.tmpdir(), `snapshot-columns-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const a = await import('../adapters/sqliteAdapter.js');

beforeAll(async () => {
    await a.initDatabase();
    a.getDb().prepare(`INSERT INTO daily_snapshots (snapshot_date, timestamp, created_at, node_total, gaming_instances_total) VALUES ('2026-09-01', 0, 0, 100, 7)`).run();
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

describe('getSnapshotsInRange columns (#389)', () => {
    it('returns every column by default', async () => {
        const [row] = await a.getSnapshotsInRange('2026-09-01', '2026-09-30');
        expect(Object.keys(row).length).toBeGreaterThan(20);
    });

    it('returns only the named columns', async () => {
        const rows = await a.getSnapshotsInRange('2026-09-01', '2026-09-30', ['snapshot_date', 'gaming_instances_total']);
        expect(rows).toEqual([{ snapshot_date: '2026-09-01', gaming_instances_total: 7 }]);
    });

    it('refuses anything that is not a plain column name', async () => {
        await expect(a.getSnapshotsInRange('2026-09-01', '2026-09-30', ['node_total; DROP TABLE x'])).rejects.toThrow(/Invalid column/);
    });
});

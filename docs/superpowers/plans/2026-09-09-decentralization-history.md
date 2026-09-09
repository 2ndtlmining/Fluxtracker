# Decentralization Historical Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot the Decentralization metric (issue #108) daily — per-provider breakdown plus headline %/counts — graph it historically, export it to CSV, wire it into the `vs D/W/M/Q/Y` comparison toggle, and add it to the KPI report across all five timeframes.

**Architecture:** Two additive storage changes (3 nullable columns on `daily_snapshots` for the headline numbers, one new `decentralization_snapshots` table shaped like `repo_snapshots` for the unbounded per-provider breakdown), collected once daily inside the existing `snapshotManager.takeSnapshot()` cycle from `decentralizationService`'s already-live cache. Every consumer (chart, comparison endpoint, CSV, KPI) reads from this storage through the existing per-subsystem patterns already used for every other metric in this codebase — no new architectural concept anywhere.

**Tech Stack:** SvelteKit, Express, SQLite (better-sqlite3) / Supabase (Postgres) dual adapter, Chart.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-decentralization-history-design.md`

## Global Constraints

- `daily_snapshots` schema changes must be strictly additive and nullable — no default value that would backfill existing rows with a misleading `0`, nothing that reads the table today may break.
- The per-provider breakdown table stores **every** classified provider each day, not just the top 3 — capping happens at read time (chart, KPI, CSV), never at collection time.
- `Decentralization %` / `% Independent` are **not** stored — both are `100 - decentralization_datacenter_percent`, computed where displayed.
- `BusiestNodeCard` gets **no** comparison-toggle wiring (a single live node has no meaningful "vs N days ago"); `DecentralizationCard` **does** get it, same as `StatCard`'s Total App Instances already has.
- KPI report depth: headline `% Datacenter` (period-averaged, fits the existing `SECTIONS` machinery) + top 3 providers (a separate computation, not a `SECTIONS` metric) — not the full breakdown.
- All new DB reads that can return more than 1000 rows must page past PostgREST's cap on the Supabase side (`exportAllRepoSnapshots()` is the template).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/adapters/sqliteAdapter.js` | New `decentralization_snapshots` table in `createSchema()`; new `createDecentralizationSnapshots`/`getDecentralizationSnapshotHistory` functions; 3 new keys in `createDailySnapshot()`'s `row` object |
| `src/lib/db/adapters/supabaseAdapter.js` | Same two new functions (Supabase shape); same 3 new keys in `createDailySnapshot()`'s `row` object |
| `src/lib/db/database.js` | Re-export the two new functions |
| `src/lib/db/schemaMigrator.js` | 3 new entries in `FIXED_COLUMNS` for the `daily_snapshots` headline columns (self-healing on both backends, no manual migration needed for these) |
| `supabase/migrations/008_decentralization_snapshots.sql` | New migration: the `decentralization_snapshots` table only (the 3 `daily_snapshots` columns are handled by `schemaMigrator`, not a migration file) |
| `src/lib/services/decentralizationService.js` | New `getFullDatacenterBreakdown()` — the un-capped per-provider list the snapshot collector needs |
| `src/lib/db/snapshotManager.js` | `takeSnapshot()` writes the 3 headline columns + calls `createDecentralizationSnapshots()` |
| `src/server.js` | `/api/analytics/comparison/:days` gains a `decentralization` change; new `GET /api/decentralization/history` endpoint for CSV |
| `src/lib/components/DecentralizationCard.svelte` | Change/trend indicator (comparison toggle); CSV export button |
| `src/routes/+page.svelte` | Wires `comparison.changes.decentralization` into `DecentralizationCard` |
| `src/lib/components/Chart.svelte` | New `decentralization` category (5 metrics), `invert` flag support in the 3 value-computation sites |
| `src/lib/kpi/metrics.js` | New `decentralization` `SECTIONS` entry; new `computeTopDatacentersForPeriod()` helper |
| `src/lib/services/kpiService.js` | Fetches `decentralization_snapshots` history for the current period, computes top 3, attaches to the report |
| `src/lib/kpi/discord.js` | Renders the top-3 block into the Decentralization section's field |

---

### Task 1: Storage — schema, adapters, router

**Files:**
- Modify: `src/lib/db/adapters/sqliteAdapter.js`
- Modify: `src/lib/db/adapters/supabaseAdapter.js`
- Modify: `src/lib/db/database.js`
- Modify: `src/lib/db/schemaMigrator.js`
- Create: `supabase/migrations/008_decentralization_snapshots.sql`
- Create: `src/lib/db/__tests__/decentralizationSnapshots.test.js`

**Interfaces:**
- Produces: `createDecentralizationSnapshots(snapshotDate: string, breakdown: Array<{org: string, count: number}>) => Promise<number>` (rows written)
- Produces: `getDecentralizationSnapshotHistory(startDate: string, endDate: string) => Promise<Array<{snapshot_date: string, org: string, node_count: number}>>`, inclusive range, ordered by date asc then node_count desc
- Produces (schemaMigrator): `daily_snapshots.decentralization_datacenter_count` (INTEGER, nullable), `daily_snapshots.decentralization_independent_count` (INTEGER, nullable), `daily_snapshots.decentralization_datacenter_percent` (REAL/DOUBLE PRECISION, nullable) — self-added on both backends at boot, no manual step

**Verified fact this task relies on:** `createDailySnapshot()` in both adapters is a **hard-coded** object literal (not a generic spread) — confirmed by reading both files. Task 3 (not this one) is where the 3 new keys get added to that literal; this task only creates the columns and the per-provider table/functions.

- [ ] **Step 1: Add the `decentralization_snapshots` table to SQLite's `createSchema()`**

In `src/lib/db/adapters/sqliteAdapter.js`, inside `createSchema()`, right after the existing `repo_snapshots` table + its indexes (search for `idx_repo_category`):

```js
    d.exec(`
        CREATE TABLE IF NOT EXISTS decentralization_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            org TEXT NOT NULL,
            node_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, org)
        )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_snapshot_date ON decentralization_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_org ON decentralization_snapshots(org)`);
```

- [ ] **Step 2: Add the 3 headline columns to `schemaMigrator.js`'s `FIXED_COLUMNS`**

In `src/lib/db/schemaMigrator.js`, extend the `FIXED_COLUMNS` array (top of the file):

```js
const FIXED_COLUMNS = [
    { name: 'gitapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'dockerapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'gitapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    { name: 'dockerapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    // No DEFAULT on these three, deliberately: an existing row must read back NULL
    // ("not classified yet"), never a fabricated 0% that would misreport as a real
    // reading. Every other FIXED_COLUMNS entry defaults to 0 because 0 IS a valid
    // reading for those; it is not for a percent this feature hasn't computed yet.
    { name: 'decentralization_datacenter_count', type: 'INTEGER' },
    { name: 'decentralization_independent_count', type: 'INTEGER' },
    { name: 'decentralization_datacenter_percent', type: 'DOUBLE PRECISION' },
];
```

This targets both `current_metrics` and `daily_snapshots` on both backends automatically (the existing `migrateSchema()` loop already iterates `targetTables = ['current_metrics', 'daily_snapshots']` for every `FIXED_COLUMNS` entry) — no other change needed in this file. `current_metrics` picking up these columns too is harmless; nothing in this feature reads decentralization data from `current_metrics` (the "current" reading always comes live from `decentralizationService`), so an unused column there costs nothing.

- [ ] **Step 3: Write the Supabase migration for the new table**

Create `supabase/migrations/008_decentralization_snapshots.sql`:

```sql
-- Per-provider decentralization breakdown, one row per (date, org) -- issue #108 Phase 3.
-- The 3 headline daily_snapshots columns are added by schemaMigrator.js at boot (both
-- backends, self-healing), not by a migration file -- this migration is only the new table.

CREATE TABLE IF NOT EXISTS decentralization_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date TEXT NOT NULL,
    org TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, org)
);

CREATE INDEX IF NOT EXISTS idx_decentralization_snapshot_date ON decentralization_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_decentralization_org ON decentralization_snapshots(org);

ALTER TABLE decentralization_snapshots ENABLE ROW LEVEL SECURITY;
```

This needs manual application in the Supabase SQL Editor once merged, same as `007_node_ip_classification.sql` was — flag this to the user at the end, same as last time.

- [ ] **Step 4: Add the two SQLite functions**

In `src/lib/db/adapters/sqliteAdapter.js`, at the end of the file (after `upsertNodeIpClassifications`):

```js
// ============================================
// DECENTRALIZATION SNAPSHOTS (historical per-provider breakdown, issue #108 Phase 3)
// ============================================

export async function createDecentralizationSnapshots(snapshotDate, breakdown) {
    if (!breakdown || breakdown.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO decentralization_snapshots (snapshot_date, org, node_count, created_at)
        VALUES (@snapshot_date, @org, @node_count, @created_at)
        ON CONFLICT(snapshot_date, org) DO UPDATE SET
            node_count = @node_count
    `);

    const insertAll = getDb().transaction((items) => {
        for (const item of items) {
            stmt.run({
                snapshot_date: snapshotDate,
                org: item.org,
                node_count: item.count,
                created_at: Date.now()
            });
        }
    });

    insertAll(breakdown);
    return breakdown.length;
}

/** Inclusive date range, ordered by date then node_count desc -- backs the CSV export
 *  and the KPI top-3-for-period computation. */
export async function getDecentralizationSnapshotHistory(startDate, endDate) {
    return getDb().prepare(`
        SELECT snapshot_date, org, node_count
        FROM decentralization_snapshots
        WHERE snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC, node_count DESC
    `).all(startDate, endDate);
}
```

- [ ] **Step 5: Add the two Supabase functions**

In `src/lib/db/adapters/supabaseAdapter.js`, at the end of the file (after `upsertNodeIpClassifications`, before `closeDatabase`):

```js
// ============================================
// DECENTRALIZATION SNAPSHOTS (historical per-provider breakdown, issue #108 Phase 3)
// ============================================

export async function createDecentralizationSnapshots(snapshotDate, breakdown) {
    if (!breakdown || breakdown.length === 0) return 0;

    const rows = breakdown.map(item => ({
        snapshot_date: snapshotDate,
        org: item.org,
        node_count: item.count,
        created_at: Date.now()
    }));

    const { error } = await supabase
        .from('decentralization_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,org' });

    if (error) throw new Error(`Upsert decentralization_snapshots failed: ${error.message}`);
    return rows.length;
}

/** Must page — see exportAllRepoSnapshots() for the identical pattern. A long date
 *  range times dozens of providers can exceed PostgREST's 1000-row cap. */
export async function getDecentralizationSnapshotHistory(startDate, endDate) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('decentralization_snapshots')
            .select('snapshot_date, org, node_count')
            .gte('snapshot_date', startDate)
            .lte('snapshot_date', endDate)
            .order('snapshot_date', { ascending: true })
            .order('node_count', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Fetch decentralization_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}
```

- [ ] **Step 6: Re-export both functions from `database.js`**

In `src/lib/db/database.js`, in the `export const { ... } = adapter;` block, after the `// Node IP classification (issue #108)` pair:

```js
    // Decentralization snapshots (historical, issue #108 Phase 3)
    createDecentralizationSnapshots,
    getDecentralizationSnapshotHistory,
```

(No comma inside that comment — the `adapterRouter.test.js` parser splits the block on every comma including ones inside comments; keep new comment lines comma-free, matching the fix already made for the Node IP classification comment above it.)

- [ ] **Step 7: Write the failing test**

Create `src/lib/db/__tests__/decentralizationSnapshots.test.js`, following `nodeIpClassification.test.js`'s exact pattern (real temp-file SQLite DB, real adapter import, unique keys per test instead of a table-reset hook):

```js
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
```

- [ ] **Step 8: Run the test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run src/lib/db/__tests__/decentralizationSnapshots.test.js`
Expected first: FAIL (functions/columns don't exist yet). After Steps 1-6: PASS.

If Step 8's last test fails because `getDb` isn't exported from `sqliteAdapter.js`: check the exports at the top of `sqliteAdapter.js` — `nodeIpClassification.test.js` never needed `getDb()` (it uses unique IPs per test instead), so this may be the first test file that needs it. If it is not exported, export it (`export function getDb() { ... }` around wherever the internal db accessor already exists) rather than reimplementing schema introspection.

- [ ] **Step 9: Run the full suite and commit**

```bash
npx vitest run
git add src/lib/db/adapters/sqliteAdapter.js src/lib/db/adapters/supabaseAdapter.js src/lib/db/database.js src/lib/db/schemaMigrator.js supabase/migrations/008_decentralization_snapshots.sql src/lib/db/__tests__/decentralizationSnapshots.test.js
git commit -m "feat: decentralization_snapshots table + daily_snapshots headline columns (issue #108)"
```

---

### Task 2: `decentralizationService.getFullDatacenterBreakdown()`

**Files:**
- Modify: `src/lib/services/decentralizationService.js`
- Modify: `src/lib/services/__tests__/decentralizationService.test.js`

**Interfaces:**
- Consumes: nothing new — reuses the same in-memory classification state `computeAndCacheStats`/`getDecentralizationStats` already read (`getAllNodeIpClassifications()` from `database.js`, `getCachedNetworkNodeIps()` from `busiestNodeService.js`)
- Produces: `getFullDatacenterBreakdown(): Promise<Array<{org: string, count: number}>>` — every distinct org among datacenter-classified candidate nodes (uncapped), plus one entry `{org: '(independent)', count: <non-datacenter classified count>}`. Consumed by Task 3's snapshot collector.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/services/__tests__/decentralizationService.test.js` (same file, same mocks already set up at the top — `getCachedNetworkNodeIps`, `getAllNodeIpClassifications`):

```js
describe('getFullDatacenterBreakdown', () => {
    it('returns every distinct datacenter org uncapped, plus the (independent) bucket', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1', '2', '3', '4', '5', '6']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1', org: 'Provider A', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '2', org: 'Provider B', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '3', org: 'Provider C', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '4', org: 'Provider D', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '5', org: 'Free SAS', isDatacenter: false, classifiedAt: Date.now() },
            { ip: '6', org: 'KPN B.V.', isDatacenter: false, classifiedAt: Date.now() }
        ]);

        const breakdown = await getFullDatacenterBreakdown();

        expect(breakdown).toEqual(expect.arrayContaining([
            { org: 'Provider A', count: 1 },
            { org: 'Provider B', count: 1 },
            { org: 'Provider C', count: 1 },
            { org: 'Provider D', count: 1 },
            { org: '(independent)', count: 2 }
        ]));
        expect(breakdown).toHaveLength(5); // not capped at 3, unlike topDatacenters
    });

    it('groups a missing/null org under "Unknown"', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1', org: null, isDatacenter: true, classifiedAt: Date.now() }
        ]);

        const breakdown = await getFullDatacenterBreakdown();

        expect(breakdown).toEqual([{ org: 'Unknown', count: 1 }]);
    });

    it('omits the (independent) entry entirely when nothing has been classified as non-datacenter', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1', org: 'Provider A', isDatacenter: true, classifiedAt: Date.now() }
        ]);

        const breakdown = await getFullDatacenterBreakdown();

        expect(breakdown.find(b => b.org === '(independent)')).toBeUndefined();
    });

    it('returns [] when nothing is classified yet', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1']);
        getAllNodeIpClassifications.mockResolvedValue([]);

        expect(await getFullDatacenterBreakdown()).toEqual([]);
    });

    it('only counts candidates still in the current network node-IP set', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1', org: 'Provider A', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '9', org: 'Provider B', isDatacenter: true, classifiedAt: Date.now() } // no longer a live node
        ]);

        const breakdown = await getFullDatacenterBreakdown();

        expect(breakdown).toEqual([{ org: 'Provider A', count: 1 }]);
    });
});
```

Add `getFullDatacenterBreakdown` to the `import { ... } from '../decentralizationService.js';` line at the top of the test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/__tests__/decentralizationService.test.js`
Expected: FAIL with "getFullDatacenterBreakdown is not a function" (or similar) on the new tests; existing tests still pass.

- [ ] **Step 3: Implement**

In `src/lib/services/decentralizationService.js`, add after `computeTopDatacenters` (reuses the same "filter to candidate set + group by org" shape, but uncapped and independent-inclusive):

```js
/**
 * Every distinct datacenter org's count, uncapped (unlike topDatacenters, which caps at
 * 3 for the live card), plus the non-datacenter classified count under the reserved
 * '(independent)' sentinel org. Used only by the daily snapshot collector -- the live
 * card's getDecentralizationStats() is unaffected by this function.
 */
export async function getFullDatacenterBreakdown() {
    const candidateIps = getCachedNetworkNodeIps();
    const candidateSet = new Set(candidateIps);
    const allClassifications = await getAllNodeIpClassifications();
    const relevant = allClassifications.filter(row => candidateSet.has(row.ip));

    const counts = new Map();
    let independentCount = 0;

    for (const row of relevant) {
        if (row.isDatacenter) {
            const key = row.org || 'Unknown';
            counts.set(key, (counts.get(key) || 0) + 1);
        } else {
            independentCount++;
        }
    }

    const breakdown = [...counts.entries()].map(([org, count]) => ({ org, count }));
    if (independentCount > 0) breakdown.push({ org: '(independent)', count: independentCount });
    return breakdown;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/__tests__/decentralizationService.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/decentralizationService.js src/lib/services/__tests__/decentralizationService.test.js
git commit -m "feat: decentralizationService.getFullDatacenterBreakdown() for daily snapshots"
```

---

### Task 3: Hook into the daily snapshot cycle

**Files:**
- Modify: `src/lib/db/adapters/sqliteAdapter.js` (the `createDailySnapshot()` `row` object)
- Modify: `src/lib/db/adapters/supabaseAdapter.js` (the `createDailySnapshot()` `row` object)
- Modify: `src/lib/db/snapshotManager.js`
- Modify: `src/lib/db/__tests__/snapshotManager.test.js`

**Interfaces:**
- Consumes: `getDecentralizationStats()` and `getFullDatacenterBreakdown()` from Task 2, `createDecentralizationSnapshots()` from Task 1 (via `database.js`)
- Produces: nothing new for later tasks — this is where collection actually happens

- [ ] **Step 1: Add the 3 keys to both adapters' `createDailySnapshot()` `row` object**

In `src/lib/db/adapters/sqliteAdapter.js`, in `createDailySnapshot()`, add right before `sync_status: snapshot.sync_status || 'completed',`:

```js
        decentralization_datacenter_count: snapshot.decentralization_datacenter_count ?? null,
        decentralization_independent_count: snapshot.decentralization_independent_count ?? null,
        decentralization_datacenter_percent: snapshot.decentralization_datacenter_percent ?? null,
```

In `src/lib/db/adapters/supabaseAdapter.js`, in `createDailySnapshot()`, same insertion point (right before `sync_status: snapshot.sync_status || 'completed',`), same three lines (the Supabase `row` object doesn't use `?? null` elsewhere, but these three should — `undefined` reaching `supabase.upsert()` silently omits the column from the payload rather than writing `NULL`, which would leave a stale value on a re-run rather than correctly clearing it back to "not classified yet"):

```js
        decentralization_datacenter_count: snapshot.decentralization_datacenter_count ?? null,
        decentralization_independent_count: snapshot.decentralization_independent_count ?? null,
        decentralization_datacenter_percent: snapshot.decentralization_datacenter_percent ?? null,
```

- [ ] **Step 2: Write the failing test**

In `src/lib/db/__tests__/snapshotManager.test.js`, add the new mock and import:

```js
vi.mock('../../services/decentralizationService.js', () => ({
    getDecentralizationStats: vi.fn(),
    getFullDatacenterBreakdown: vi.fn(() => Promise.resolve([])),
}));
```

Add `createDecentralizationSnapshots: vi.fn()` to the existing `vi.mock('../database.js', ...)` block, and add these two imports near the existing `import { createDailySnapshot, ... } from '../database.js';` block:

```js
import { getDecentralizationStats, getFullDatacenterBreakdown } from '../../services/decentralizationService.js';
import { createDecentralizationSnapshots } from '../database.js'; // add to the existing named import instead if one already exists for database.js
```

Then add tests (find the `describe('snapshotManager', ...)` block and the existing `beforeEach` that sets up `getCurrentMetrics.mockResolvedValue(makeValidMetrics())`-style defaults — add a similar default for `getDecentralizationStats` there, e.g. `getDecentralizationStats.mockResolvedValue({ datacenterCount: 40, classifiedCount: 100, datacenterPercent: 40 });`):

```js
describe('decentralization snapshot collection', () => {
    it('writes the headline decentralization columns onto the daily snapshot', async () => {
        getCurrentMetrics.mockResolvedValue(makeValidMetrics());
        getDecentralizationStats.mockResolvedValue({ datacenterCount: 45, classifiedCount: 100, datacenterPercent: 45 });
        getFullDatacenterBreakdown.mockResolvedValue([{ org: 'Hetzner', count: 45 }, { org: '(independent)', count: 55 }]);

        await takeManualSnapshot();

        const [snapshotData] = createDailySnapshot.mock.calls[0];
        expect(snapshotData.decentralization_datacenter_count).toBe(45);
        expect(snapshotData.decentralization_independent_count).toBe(55);
        expect(snapshotData.decentralization_datacenter_percent).toBe(45);
    });

    it('writes null (not 0) for the headline columns when nothing is classified yet', async () => {
        getCurrentMetrics.mockResolvedValue(makeValidMetrics());
        getDecentralizationStats.mockResolvedValue({ datacenterCount: 0, classifiedCount: 0, datacenterPercent: null });
        getFullDatacenterBreakdown.mockResolvedValue([]);

        await takeManualSnapshot();

        const [snapshotData] = createDailySnapshot.mock.calls[0];
        expect(snapshotData.decentralization_datacenter_count).toBeNull();
        expect(snapshotData.decentralization_independent_count).toBeNull();
        expect(snapshotData.decentralization_datacenter_percent).toBeNull();
    });

    it('calls createDecentralizationSnapshots with the full breakdown for the snapshot date', async () => {
        getCurrentMetrics.mockResolvedValue(makeValidMetrics());
        getDecentralizationStats.mockResolvedValue({ datacenterCount: 45, classifiedCount: 100, datacenterPercent: 45 });
        const breakdown = [{ org: 'Hetzner', count: 45 }, { org: '(independent)', count: 55 }];
        getFullDatacenterBreakdown.mockResolvedValue(breakdown);

        const result = await takeManualSnapshot();

        expect(createDecentralizationSnapshots).toHaveBeenCalledWith(result.snapshotDate, breakdown);
    });

    it('skips createDecentralizationSnapshots when the breakdown is empty, without failing the snapshot', async () => {
        getCurrentMetrics.mockResolvedValue(makeValidMetrics());
        getDecentralizationStats.mockResolvedValue({ datacenterCount: 0, classifiedCount: 0, datacenterPercent: null });
        getFullDatacenterBreakdown.mockResolvedValue([]);

        const result = await takeManualSnapshot();

        expect(result.success).toBe(true);
        expect(createDecentralizationSnapshots).not.toHaveBeenCalled();
    });

    it('a decentralizationService failure does not block the daily_snapshots row from being written', async () => {
        getCurrentMetrics.mockResolvedValue(makeValidMetrics());
        getDecentralizationStats.mockRejectedValue(new Error('decentralization cache unavailable'));
        getFullDatacenterBreakdown.mockResolvedValue([]);

        const result = await takeManualSnapshot();

        expect(result.success).toBe(true);
        const [snapshotData] = createDailySnapshot.mock.calls[0];
        expect(snapshotData.decentralization_datacenter_percent).toBeNull();
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/db/__tests__/snapshotManager.test.js`
Expected: FAIL (the collection code doesn't exist in `takeSnapshot()` yet).

- [ ] **Step 4: Implement**

In `src/lib/db/snapshotManager.js`, add the two new imports at the top:

```js
import { getDecentralizationStats, getFullDatacenterBreakdown } from '../services/decentralizationService.js';
```

and add `createDecentralizationSnapshots` to the existing `import { createDailySnapshot, createRepoSnapshots, ... } from './database.js';` block.

Inside `takeSnapshot()`, before the `snapshotData = { ... }` object literal is built, fetch decentralization data with its own try/catch so a failure there degrades to `null` rather than aborting the whole snapshot (matches this task's "does not block" test):

```js
        let decentralization = null;
        let decentralizationBreakdown = [];
        try {
            decentralization = await getDecentralizationStats();
            decentralizationBreakdown = await getFullDatacenterBreakdown();
        } catch (error) {
            log.warn(`Decentralization data unavailable for this snapshot: ${error.message}`);
        }
```

Add three keys to the `snapshotData` object literal (alongside the existing `node_total`/`sync_status` keys):

```js
            decentralization_datacenter_count: decentralization?.datacenterCount ?? null,
            decentralization_independent_count:
                decentralization?.classifiedCount != null && decentralization?.datacenterCount != null
                    ? decentralization.classifiedCount - decentralization.datacenterCount
                    : null,
            decentralization_datacenter_percent: decentralization?.datacenterPercent ?? null,
```

After `await createDailySnapshot(snapshotData);` and before the repo-counts block, add:

```js
        // Per-provider breakdown -- best-effort, same posture as the repo-snapshot write
        // immediately below: never blocks the headline daily_snapshots row.
        if (decentralizationBreakdown.length > 0) {
            try {
                await createDecentralizationSnapshots(snapshotDate, decentralizationBreakdown);
            } catch (error) {
                log.warn(`Decentralization snapshot write failed: ${error.message}`);
            }
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/db/__tests__/snapshotManager.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 6: Run the full suite and commit**

```bash
npx vitest run
git add src/lib/db/adapters/sqliteAdapter.js src/lib/db/adapters/supabaseAdapter.js src/lib/db/snapshotManager.js src/lib/db/__tests__/snapshotManager.test.js
git commit -m "feat: collect decentralization data into the daily snapshot cycle"
```

---

### Task 4: `vs D/W/M/Q/Y` comparison toggle

**Files:**
- Modify: `src/server.js`
- Modify: `src/lib/components/DecentralizationCard.svelte`
- Modify: `src/routes/+page.svelte`

**Interfaces:**
- Consumes: `getDecentralizationStats()` (already imported in `server.js`), `pastSnapshot.decentralization_datacenter_percent` (from Task 1/3's new column)
- Produces: `response.changes.decentralization = {change: number, trend: 'up'|'down'|'neutral'}` from `/api/analytics/comparison/:days`

- [ ] **Step 1: Add the comparison to `/api/analytics/comparison/:days`**

In `src/server.js`, inside the `if (pastSnapshot) { ... }` block of the comparison endpoint (alongside the existing `response.changes.cpu = calculateChange(...)` line), add:

```js
            // Decentralization (issue #108 Phase 3): "current" reads live from
            // decentralizationService rather than rawCurrent/current_metrics, since that's
            // where the always-fresh reading actually lives -- same reasoning /api/decentralization
            // already uses.
            const liveDecentralization = await getDecentralizationStats();
            response.changes.decentralization = calculateChange(
                liveDecentralization.datacenterPercent ?? 0,
                pastSnapshot.decentralization_datacenter_percent
            );
```

`getDecentralizationStats` is already imported in `server.js` (added when `/api/decentralization` was built). `calculateChange()`'s existing `if (!past || past === 0) return { change: 0, trend: 'neutral' }` guard already handles a `NULL`/pre-this-feature historical row gracefully — no extra null-check needed here.

- [ ] **Step 2: Give `DecentralizationCard` a change/trend indicator**

In `src/lib/components/DecentralizationCard.svelte`, add a new prop and render it next to the headline percent, following `CloudCard.svelte`'s exact `trend-arrow`/up/down/neutral pattern:

```js
  export let comparison = null; // { change: number, trend: 'up'|'down'|'neutral' } | null
```

In the markup, inside the existing `.metric-heading` div for "In known datacenters" (alongside `.metric-value`), add:

```svelte
      {#if comparison}
        <span class="metric-trend" class:up={comparison.trend === 'up'} class:down={comparison.trend === 'down'} class:neutral={comparison.trend === 'neutral'}>
          {#if comparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if comparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
          {comparison.change >= 0 ? '+' : ''}{comparison.change.toFixed(1)}%
        </span>
      {/if}
```

Add matching CSS (mirrors `CloudCard.svelte`'s `.metric-change`/`.trend-arrow`/`.up`/`.down`/`.neutral` rules — copy those rules' colors/sizing, renamed to `.metric-trend` to avoid colliding with this file's existing `.metric-value`/`.metric-detail` class names).

- [ ] **Step 3: Wire it from `+page.svelte`**

In `src/routes/+page.svelte`, add a reactive comparison object next to the existing `cpuComparison`/`ramComparison`/`storageComparison` declarations:

```js
  $: decentralizationComparison = comparison ? {
    change: comparison.changes.decentralization?.change || 0,
    trend: comparison.changes.decentralization?.trend || 'neutral'
  } : null;
```

Pass it to the card:

```svelte
      <DecentralizationCard stats={decentralizationStats} loading={decentralizationLoading} error={decentralizationError} comparison={decentralizationComparison} />
```

- [ ] **Step 4: Manual verification (no automated test for this task — matches how `cpuComparison`/`ramComparison` have none today)**

Start the real server (`DB_TYPE=sqlite node src/server.js`), hit `GET /api/analytics/comparison/7` (or any `days` value with an existing 7-day-old snapshot in the temp DB), confirm the response includes a `changes.decentralization` object shaped `{change, trend}` and does not error when `pastSnapshot.decentralization_datacenter_percent` is `NULL` (a snapshot taken before this feature shipped).

- [ ] **Step 5: Run the full suite and commit**

```bash
npx vitest run
npm run build
git add src/server.js src/lib/components/DecentralizationCard.svelte src/routes/+page.svelte
git commit -m "feat: wire Decentralization into the vs D/W/M/Q/Y comparison toggle"
```

---

### Task 5: Historical chart — `Chart.svelte`

**Files:**
- Modify: `src/lib/components/Chart.svelte`

**Interfaces:**
- Consumes: the 3 new `daily_snapshots` columns (Task 1/3), already flowing through whatever endpoint populates `allSnapshots` (unchanged — `Chart.svelte` already fetches full `daily_snapshots` rows, no endpoint change needed since these are now just 3 more columns on rows it already receives)
- Produces: nothing new for later tasks

**Verified fact this task relies on:** `aggregateByWeek`/`aggregateByMonth` already branch purely on `selectedCategory === 'revenue'` (sum) vs everything else (average) — confirmed by reading both functions. A new `decentralization` category automatically gets averaged with **zero** changes to either aggregation function. The daily/weekly/monthly paths **already** coerce `null`/`undefined` to `0` via `snapshot[metric.field] || 0` for every existing metric (including other percent columns like `cpu_utilization_percent`) — this is pre-existing behavior across the whole component, not something to special-case for decentralization; do not add null-aware handling here, it would be inconsistent with how every other metric already renders a not-yet-populated day.

- [ ] **Step 1: Add the `decentralization` category**

In `src/lib/components/Chart.svelte`'s `categories` object, add a new entry after `apps`:

```js
    decentralization: {
      label: 'Decentralization',
      color: 'rgb(255, 180, 0)',
      metrics: [
        { id: 'dc_count', label: 'Quantity Datacenters', field: 'decentralization_datacenter_count', format: 'number' },
        { id: 'indep_count', label: 'Quantity Independent', field: 'decentralization_independent_count', format: 'number' },
        { id: 'dc_percent', label: '% Datacenter', field: 'decentralization_datacenter_percent', format: 'percent' },
        { id: 'indep_percent', label: '% Independent', field: 'decentralization_datacenter_percent', format: 'percent', invert: true },
        { id: 'decentralization_percent', label: 'Decentralization %', field: 'decentralization_datacenter_percent', format: 'percent', invert: true }
      ]
    }
```

- [ ] **Step 2: Support `metric.invert` at all three value-computation sites**

In the daily path (search for `value = snapshot[metric.field] || 0;` inside the `if (selectedAggregation === 'daily')` block), change to:

```js
        } else {
          value = snapshot[metric.field] || 0;
          if (metric.invert) value = 100 - value;
        }
```

In `aggregateByWeek()` (search for the same `value = snapshot[metric.field] || 0;` line inside that function), same change:

```js
      } else {
        value = snapshot[metric.field] || 0;
        if (metric.invert) value = 100 - value;
      }
```

In `aggregateByMonth()`, find its equivalent `value = snapshot[metric.field] || 0;` line (same shape as `aggregateByWeek`, just monthly bucketing) and apply the identical change.

**Why invert the raw daily value before averaging, not the averaged result:** `100 - avg(x)` and `avg(100 - x)` are mathematically identical, but inverting per-day keeps every aggregation path's math shape uniform (average of values, full stop) rather than adding a post-processing step only for `invert` metrics.

- [ ] **Step 3: Manual verification (this component has no unit tests today — confirmed by checking; not introducing a new gap, matches the spec's noted pre-existing limitation)**

Run the dev server, open the Historical Performance chart, select the "Decentralization" category, cycle through all 5 metrics and all 3 aggregation buttons (Daily/Weekly/Monthly), confirm:
- `Quantity Datacenters`/`Quantity Independent` show sensible counts
- `% Datacenter` and `% Independent` sum to ~100% at any given point
- `Decentralization %` and `% Independent` show identical lines (same underlying computation, confirming the `invert` flag works)

- [ ] **Step 4: Run the full suite (no new automated tests, but confirm nothing broke) and commit**

```bash
npx vitest run
npm run build
git add src/lib/components/Chart.svelte
git commit -m "feat: Decentralization category in the historical chart"
```

---

### Task 6: CSV export

**Files:**
- Modify: `src/server.js`
- Modify: `src/lib/components/DecentralizationCard.svelte`

**Interfaces:**
- Consumes: `getDecentralizationSnapshotHistory()` (Task 1), `getSnapshotsInRange()` (already exists)
- Produces: `GET /api/decentralization/history?days=N` — `{ history: [{date, org, count}], headline: [{date, datacenterCount, independentCount, datacenterPercent, totalNodes}] }`

- [ ] **Step 1: Add the history endpoint**

In `src/server.js`, near the existing `/api/decentralization` endpoint, add:

```js
// Decentralization historical data (issue #108 Phase 3) -- backs the CSV export in
// DecentralizationCard.svelte. `days` mirrors Chart.svelte's own timeframe options.
app.get('/api/decentralization/history', async (req, res) => {
    try {
        const days = Math.max(1, parseInt(req.query.days) || 90);
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

        const [breakdown, snapshots] = await Promise.all([
            getDecentralizationSnapshotHistory(startDate, endDate),
            getSnapshotsInRange(startDate, endDate)
        ]);

        const headline = snapshots
            .filter(s => s.decentralization_datacenter_percent != null)
            .map(s => ({
                date: s.snapshot_date,
                datacenterCount: s.decentralization_datacenter_count,
                independentCount: s.decentralization_independent_count,
                datacenterPercent: s.decentralization_datacenter_percent,
                totalNodes: s.node_total
            }));

        res.json({
            history: breakdown.map(r => ({ date: r.snapshot_date, org: r.org, count: r.node_count })),
            headline
        });
    } catch (error) {
        log.error({ err: error }, 'decentralization history API error');
        res.status(500).json({ error: 'Failed to fetch decentralization history', message: error.message });
    }
});
```

Add `getDecentralizationSnapshotHistory` and `getSnapshotsInRange` to the existing `database.js` import block if either isn't already imported (`getSnapshotsInRange` almost certainly already is, for other endpoints — check before adding a duplicate).

- [ ] **Step 2: Add the CSV export button + function to `DecentralizationCard.svelte`**

Add an icon import and a fetch-and-download function, following `RevenueTransactions.svelte`'s `exportToCSV()` shape exactly (Blob, escapeField, download link, timestamped filename):

```js
  import { Globe, Download } from 'lucide-svelte';
  import { getApiUrl } from '$lib/config.js';

  let exporting = false;

  function escapeField(field) {
    const value = field == null ? '' : String(field);
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  async function exportToCSV() {
    exporting = true;
    try {
      const API_URL = getApiUrl();
      const response = await fetch(`${API_URL}/api/decentralization/history?days=90`);
      if (!response.ok) throw new Error(`Export failed: ${response.status}`);
      const { history, headline } = await response.json();

      const headlineByDate = new Map(headline.map(h => [h.date, h]));
      const headers = ['date', 'org', 'count', 'percent_of_classified', 'datacenter_total', 'independent_total', 'datacenter_percent', 'total_nodes'];
      const rows = history.map(row => {
        const h = headlineByDate.get(row.date);
        const classified = h ? (h.datacenterCount ?? 0) + (h.independentCount ?? 0) : 0;
        const percentOfClassified = classified > 0 ? ((row.count / classified) * 100).toFixed(1) : '';
        return [
          row.date,
          row.org,
          row.count,
          percentOfClassified,
          h?.datacenterCount ?? '',
          h?.independentCount ?? '',
          h?.datacenterPercent != null ? h.datacenterPercent.toFixed(1) : '',
          h?.totalNodes ?? ''
        ];
      });

      const csvContent = [headers.join(','), ...rows.map(r => r.map(escapeField).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().split('T')[0];
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `flux_decentralization_${timestamp}.csv`);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting decentralization CSV:', error);
    } finally {
      exporting = false;
    }
  }
```

Add a small icon-button in the card header (next to the existing title, matching how `RevenueTransactions.svelte` places its own CSV button relative to its header):

```svelte
    <button class="csv-button" on:click={exportToCSV} disabled={exporting} title="Export decentralization history to CSV">
      <Download size={14} />
    </button>
```

Add minimal CSS for `.csv-button` (small icon button, `--text-muted` default / `--text-primary` on hover, matching the card's existing button-less header spacing — add `gap` if needed).

- [ ] **Step 3: Manual verification (client-side blob download has no automated test in this codebase — matches `RevenueTransactions.svelte`'s own untested export button)**

Run the dev server, click the new CSV export button, confirm a `flux_decentralization_YYYY-MM-DD.csv` file downloads and opens with the documented columns.

- [ ] **Step 4: Run the full suite and commit**

```bash
npx vitest run
npm run build
git add src/server.js src/lib/components/DecentralizationCard.svelte
git commit -m "feat: CSV export for decentralization history"
```

---

### Task 7: KPI report — headline `% Datacenter`

**Files:**
- Modify: `src/lib/kpi/metrics.js`
- Modify: `src/lib/kpi/__tests__/metrics.test.js` (if it exists — check; if not, add coverage to whichever KPI test file already covers `SECTIONS`)

**Interfaces:**
- Produces: nothing new for later tasks — this section fits the existing `metrics.column` + `averageColumn` path used by every other averaged section

**Verified fact this task relies on:** `src/lib/kpi/__tests__/metrics.test.js` exists and has no exact `SECTIONS.length`/`sections.length` assertion (confirmed by grep) — adding a new `SECTIONS` entry cannot break an existing count-based test the way `adapterRouter.test.js`'s function-count tests needed updating in an earlier round of this work.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/kpi/__tests__/metrics.test.js` (adapt the exact `describe`/import style to match that file's existing conventions):

```js
describe('decentralization section', () => {
    it('averages decentralization_datacenter_percent like every other resources-style metric', () => {
        const currentSnapshots = [
            { decentralization_datacenter_percent: 40 },
            { decentralization_datacenter_percent: 44 }
        ];
        const comparisonSnapshots = [
            { decentralization_datacenter_percent: 30 },
            { decentralization_datacenter_percent: 30 }
        ];

        const dataset = buildKpiDataset({
            current: { start: '2026-09-01', end: '2026-09-02' },
            comparison: { start: '2026-08-30', end: '2026-08-31' },
            currentSnapshots,
            comparisonSnapshots,
            currentRevenue: { flux: 0, usd: 0, selfFunded: 0, selfFundedShare: 0, fiat: 0, fiatShare: 0 },
            comparisonRevenue: { flux: 0, usd: 0, selfFunded: 0, selfFundedShare: 0, fiat: 0, fiatShare: 0 }
        });

        const section = dataset.sections.find(s => s.key === 'decentralization');
        expect(section).toBeDefined();
        expect(section.title).toBe('Decentralization');
        expect(section.aggregation).toBe('average');

        const metric = section.metrics.find(m => m.key === 'datacenterPercent');
        expect(metric.current).toBe(42); // avg(40, 44)
        expect(metric.comparison).toBe(30);
        expect(metric.available).toBe(true);
    });

    it('is unavailable (Insufficient data) when a day in the period has no reading', () => {
        const dataset = buildKpiDataset({
            current: { start: '2026-09-01', end: '2026-09-02' },
            comparison: { start: '2026-08-30', end: '2026-08-31' },
            currentSnapshots: [{ decentralization_datacenter_percent: 40 }], // only 1 of 2 days
            comparisonSnapshots: [{ decentralization_datacenter_percent: 30 }, { decentralization_datacenter_percent: 30 }],
            currentRevenue: { flux: 0, usd: 0, selfFunded: 0, selfFundedShare: 0, fiat: 0, fiatShare: 0 },
            comparisonRevenue: { flux: 0, usd: 0, selfFunded: 0, selfFundedShare: 0, fiat: 0, fiatShare: 0 }
        });

        const section = dataset.sections.find(s => s.key === 'decentralization');
        const metric = section.metrics.find(m => m.key === 'datacenterPercent');
        expect(metric.available).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/kpi/__tests__/metrics.test.js`
Expected: FAIL (`section` is `undefined` — no `decentralization` entry in `SECTIONS` yet).

- [ ] **Step 3: Implement**

In `src/lib/kpi/metrics.js`, add to `SECTIONS` (after the `applications` entry):

```js
    {
        key: 'decentralization',
        title: 'Decentralization',
        source: 'daily_snapshots',
        aggregation: 'average',
        metrics: [
            { key: 'datacenterPercent', label: '% Datacenter', column: 'decentralization_datacenter_percent', format: 'percent' }
        ]
    }
```

No other change needed — `averageColumn()`/`computeChange()` already handle everything else generically.

- [ ] **Step 4: Run the test to verify it passes, then the full suite**

Run: `npx vitest run` (full suite — confirms the new `SECTIONS` entry doesn't break anything elsewhere)

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/metrics.js src/lib/kpi/__tests__/
git commit -m "feat: Decentralization section in the KPI report"
```

---

### Task 8: KPI report — top 3 providers

**Files:**
- Modify: `src/lib/kpi/metrics.js`
- Modify: `src/lib/services/kpiService.js`
- Modify: `src/lib/kpi/discord.js`
- Modify: `src/lib/kpi/__tests__/metrics.test.js` (or wherever Task 7 added coverage)
- Modify: `src/lib/kpi/__tests__/discord.test.js`
- Modify: `src/lib/services/__tests__/kpiService.test.js` (if it exists — check)

**Interfaces:**
- Consumes: `getDecentralizationSnapshotHistory()` (Task 1)
- Produces: `computeTopDatacentersForPeriod(historyRows: Array<{org, node_count}>, limit = 3): Array<{org: string, avgCount: number}>`; `report.topDatacenters` on the object `buildKpiReport()` returns

- [ ] **Step 1: Write the failing test for `computeTopDatacentersForPeriod`**

Add to `src/lib/kpi/__tests__/metrics.test.js` (or the file identified in Task 7 Step 1):

```js
describe('computeTopDatacentersForPeriod', () => {
    it('averages each org over only the days it has a row for, ranks descending, caps at the limit', () => {
        const rows = [
            { snapshot_date: '2026-09-01', org: 'Hetzner', node_count: 40 },
            { snapshot_date: '2026-09-02', org: 'Hetzner', node_count: 50 }, // avg 45 over 2 days
            { snapshot_date: '2026-09-01', org: 'OVH', node_count: 20 },     // avg 20 over 1 day (only appeared once)
            { snapshot_date: '2026-09-01', org: '(independent)', node_count: 100 } // excluded from ranking
        ];

        const top = computeTopDatacentersForPeriod(rows, 3);

        expect(top).toEqual([
            { org: 'Hetzner', avgCount: 45 },
            { org: 'OVH', avgCount: 20 }
        ]);
    });

    it('caps at the given limit', () => {
        const rows = ['A', 'B', 'C', 'D', 'E'].map(org => ({ snapshot_date: '2026-09-01', org, node_count: 1 }));

        expect(computeTopDatacentersForPeriod(rows, 3)).toHaveLength(3);
    });

    it('returns [] for an empty history', () => {
        expect(computeTopDatacentersForPeriod([], 3)).toEqual([]);
    });

    it('excludes the (independent) bucket from the ranking entirely', () => {
        const rows = [{ snapshot_date: '2026-09-01', org: '(independent)', node_count: 999 }];

        expect(computeTopDatacentersForPeriod(rows, 3)).toEqual([]);
    });

    it('handles a single-day range correctly (the daily KPI timeframe case)', () => {
        const rows = [
            { snapshot_date: '2026-09-01', org: 'Hetzner', node_count: 45 },
            { snapshot_date: '2026-09-01', org: 'OVH', node_count: 31 }
        ];

        expect(computeTopDatacentersForPeriod(rows, 3)).toEqual([
            { org: 'Hetzner', avgCount: 45 },
            { org: 'OVH', avgCount: 31 }
        ]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run <that test file>`
Expected: FAIL (`computeTopDatacentersForPeriod` is not exported yet).

- [ ] **Step 3: Implement `computeTopDatacentersForPeriod`**

In `src/lib/kpi/metrics.js`, add after `averageColumn`:

```js
/**
 * Ranks datacenter providers by their average daily count over a period. Each org is
 * averaged only over the days it actually has a row for (a provider with rows on 3 of 7
 * days averages over 3, not 7 -- the same "average what actually happened" reasoning
 * averageColumn() uses, adapted to a sparse per-org series). The '(independent)' sentinel
 * from decentralization_snapshots is excluded -- this ranks datacenter providers only.
 */
export function computeTopDatacentersForPeriod(historyRows, limit = 3) {
    const byOrg = new Map();
    for (const row of historyRows) {
        if (row.org === '(independent)') continue;
        if (!byOrg.has(row.org)) byOrg.set(row.org, []);
        byOrg.get(row.org).push(row.node_count);
    }

    return [...byOrg.entries()]
        .map(([org, counts]) => ({
            org,
            avgCount: counts.reduce((a, b) => a + b, 0) / counts.length
        }))
        .sort((a, b) => b.avgCount - a.avgCount)
        .slice(0, limit);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run <that test file>`
Expected: PASS.

- [ ] **Step 5: Wire it into `kpiService.buildKpiReport()`**

In `src/lib/services/kpiService.js`, add the import:

```js
import { getDecentralizationSnapshotHistory } from '../db/database.js'; // add to the existing database.js import block
import { computeTopDatacentersForPeriod } from '../kpi/metrics.js'; // add to the existing metrics.js import
```

In `buildKpiReport()`, add `getDecentralizationSnapshotHistory(current.start, current.end)` to the existing `Promise.all([...])` (alongside `getSnapshotsInRange`), and after the `dataset` is built, compute:

```js
    const topDatacenters = computeTopDatacentersForPeriod(decentralizationHistory);
```

Add `topDatacenters` to the returned object (alongside `fluxCloud`):

```js
        topDatacenters,
```

- [ ] **Step 6: Write the failing test for the Discord rendering**

**Verified fact this step relies on:** `report(overrides)` in this file spreads `overrides` into `buildKpiDataset`'s **input** object (`currentSnapshots`/`currentRevenue`/etc.), not onto the report object `buildDiscordPayload` receives — confirmed by reading the helper. `topDatacenters` must be attached to the object returned by `report()` directly, not passed through `report({topDatacenters: [...]})`. The `snapshots()` fixture also doesn't include `decentralization_datacenter_percent`, so the section needs that added via the existing override mechanism to be `available`.

Add to `src/lib/kpi/__tests__/discord.test.js`, in the `buildDiscordPayload` describe block:

```js
    it('appends the top-3 datacenter providers to the Decentralization section field', () => {
        const withDecentralization = report({
            currentSnapshots: snapshots({ decentralization_datacenter_percent: 40 }),
            comparisonSnapshots: snapshots({ node_total: 5800, decentralization_datacenter_percent: 35 })
        });
        const payload = buildDiscordPayload({
            ...withDecentralization,
            topDatacenters: [
                { org: 'Hetzner Online GmbH', avgCount: 45.3 },
                { org: 'OVH SAS', avgCount: 31.0 }
            ]
        });
        const embed = payload.embeds[0];
        const field = embed.fields.find(f => f.name.startsWith('Decentralization'));

        expect(field).toBeDefined();
        expect(field.value).toContain('Hetzner Online GmbH');
        expect(field.value).toContain('OVH SAS');
    });

    it('omits the top-datacenters block entirely when there is nothing to rank', () => {
        const withDecentralization = report({
            currentSnapshots: snapshots({ decentralization_datacenter_percent: 40 }),
            comparisonSnapshots: snapshots({ node_total: 5800, decentralization_datacenter_percent: 35 })
        });
        const payload = buildDiscordPayload({ ...withDecentralization, topDatacenters: [] });
        const embed = payload.embeds[0];
        const field = embed.fields.find(f => f.name.startsWith('Decentralization'));

        expect(field).toBeDefined();
        expect(field.value).not.toContain('Top datacenters');
    });

    it('renders correctly when topDatacenters is omitted entirely (older report shape)', () => {
        const withDecentralization = report({
            currentSnapshots: snapshots({ decentralization_datacenter_percent: 40 }),
            comparisonSnapshots: snapshots({ node_total: 5800, decentralization_datacenter_percent: 35 })
        });
        expect(() => buildDiscordPayload(withDecentralization)).not.toThrow();
    });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run src/lib/kpi/__tests__/discord.test.js`
Expected: FAIL (`field.value` doesn't contain the org names yet).

- [ ] **Step 8: Implement the Discord rendering**

In `src/lib/kpi/discord.js`, add `topDatacenters` to the destructure at the top of `buildDiscordPayload`:

```js
    const { timeframe, current, comparison, dataset, generatedAt, topDatacenters = [] } = report;
```

Inside the `dataset.sections.map(section => { ... })` block, after `value` is built (the `'```\n' + sectionTable(...) + '\n```'` line) and before the length-trim check, append the top-3 block only for the decentralization section:

```js
        if (section.key === 'decentralization' && topDatacenters.length > 0) {
            const lines = topDatacenters
                .map((dc, i) => `${i + 1}. ${dc.org} — ${Math.round(dc.avgCount)} avg nodes`)
                .join('\n');
            value += `\nTop datacenters:\n${lines}`;
        }
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/lib/kpi/__tests__/discord.test.js`
Expected: PASS.

- [ ] **Step 10: Update `kpiService.test.js`'s `database.js` mock and add coverage**

**Verified fact:** `src/lib/services/__tests__/kpiService.test.js` mocks `../../db/database.js` with `vi.mock('../../db/database.js', () => ({ getSnapshotsInRange: vi.fn(), ... }))` (confirmed by reading). Since Step 5 added `getDecentralizationSnapshotHistory` to `buildKpiReport()`'s `Promise.all`, **every existing test in this file will throw** ("getDecentralizationSnapshotHistory is not a function") until this mock is updated — this is not optional cleanup, it blocks the whole file.

Add `getDecentralizationSnapshotHistory: vi.fn(() => Promise.resolve([]))` to the existing `vi.mock('../../db/database.js', () => ({ ... }))` factory, and add the same name to the `import { getSnapshotsInRange, ... } from '../../db/database.js';` block below it. Then add:

```js
describe('buildKpiReport — topDatacenters', () => {
    it('includes topDatacenters computed from the decentralization history', async () => {
        getDecentralizationSnapshotHistory.mockResolvedValue([
            { snapshot_date: '2026-08-10', org: 'Hetzner', node_count: 40 },
            { snapshot_date: '2026-08-11', org: 'Hetzner', node_count: 50 }
        ]);

        const report = await buildKpiReport('weekly', NOW);

        expect(report.topDatacenters).toEqual([{ org: 'Hetzner', avgCount: 45 }]);
    });

    it('is [] when there is no decentralization history for the period', async () => {
        getDecentralizationSnapshotHistory.mockResolvedValue([]);

        const report = await buildKpiReport('weekly', NOW);

        expect(report.topDatacenters).toEqual([]);
    });
});
```

- [ ] **Step 11: Run the full suite and commit**

```bash
npx vitest run
npm run build
git add src/lib/kpi/metrics.js src/lib/services/kpiService.js src/lib/kpi/discord.js src/lib/kpi/__tests__/ src/lib/services/__tests__/
git commit -m "feat: top-3 datacenter providers in the KPI report"
```

---

## Final Verification (after all 8 tasks)

- [ ] `npx vitest run` — full suite green
- [ ] `npm run build` — succeeds
- [ ] Live check: run the real server in SQLite mode, manually trigger a snapshot (`POST /api/admin/snapshot` or equivalent — check `server.js` for the exact existing manual-trigger route), confirm:
  - `daily_snapshots` row has the 3 new columns populated (or `NULL` if nothing classified yet)
  - `decentralization_snapshots` has one row per classified provider + `(independent)` for that date
  - `GET /api/decentralization/history?days=7` returns both
  - `GET /api/analytics/comparison/7` includes `changes.decentralization`
- [ ] Visual check: Historical chart's Decentralization category, all 5 metrics, all 3 aggregations; `DecentralizationCard`'s new trend indicator and CSV button
- [ ] Flag to the user: `supabase/migrations/008_decentralization_snapshots.sql` needs manual application in the Supabase SQL Editor before this works against the production Supabase project (same as `007_node_ip_classification.sql` was) — the `daily_snapshots` columns do NOT need this, they self-heal via `schemaMigrator.js` on both backends.

## Self-Review Notes (writing-plans skill's required self-check, completed while writing this plan)

- **Spec coverage:** every section of the design doc (storage, collection, chart, comparison toggle, CSV, KPI headline, KPI top-3) has a task. The spec's 3 "open implementation risks" were resolved during plan-writing, not deferred: (1) `createDailySnapshot()` is hard-coded in both adapters — confirmed by reading, Task 3 handles it directly; (2) Chart.svelte's `null`-vs-`0` handling — confirmed it's a pre-existing, uniform simplification across every metric, not something decentralization needs to special-case; (3) SQLite column-addition syntax — confirmed the codebase's real mechanism is `schemaMigrator.js`'s try/catch `FIXED_COLUMNS` pattern, not `ADD COLUMN IF NOT EXISTS`, and that mechanism is what Task 1 uses (an improvement over the spec's original "manual migration file" proposal — no manual Supabase step needed for those 3 columns).
- **Type consistency:** `getFullDatacenterBreakdown()` returns `{org, count}` (Task 2) — Task 1's `createDecentralizationSnapshots(date, breakdown)` and Task 3's collector both consume that exact shape. `getDecentralizationSnapshotHistory()` returns `{snapshot_date, org, node_count}` (raw DB column names) — Task 6 and Task 8 both map from that shape at their own call sites rather than assuming a third shape.
- **Scope check:** 8 tasks, each independently testable and committable; Task 1 is the largest (schema + adapters + router) but splitting it further would create an artificial mid-task dependency (the functions are meaningless without the table, and vice versa) — kept as one deliverable per the "smallest unit that carries its own test cycle" rule.

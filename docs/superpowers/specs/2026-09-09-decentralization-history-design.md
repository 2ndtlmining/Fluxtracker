# Design: Decentralization historical snapshots (issue #108, Phase 3)

## Source

User request following the live Decentralization metric (issue #108,
shipped in PRs #116/#117): daily snapshots of the per-datacenter-provider
breakdown, historical graphing, CSV export, and KPI report integration
across all five timeframes. Confirmed through discussion (see chat):

- Chart depth: 5 single-value line-chart metrics, not a stacked/multi-series
  chart — Quantity Datacenters, Quantity Independent, % Datacenter, %
  Independent, Decentralization % (the last two are the same value, kept as
  two dropdown entries for vocabulary reasons)
- KPI report depth: headline % + top 3 providers, matching the live card
- The dashboard's `vs D/W/M/Q/Y` comparison toggle (`/api/analytics/comparison/:days`,
  "Performance Overview" section) must also cover decentralization, the same
  way it already covers Revenue/Nodes/CPU/RAM/Storage/Gaming/Crypto/WordPress
  — explicitly requested, unlike Busiest Node which stays excluded (a single
  live node has no meaningful "vs N days ago")
- `daily_snapshots` schema changes must be strictly additive/nullable — no
  backfill, nothing that reads the table today may break

## What already exists (reused as-is)

- `decentralizationService.js`: `getDecentralizationStats()` (live cache:
  `totalNodes`, `classifiedCount`, `datacenterCount`, `datacenterPercent`,
  `coveragePercent`, `topDatacenters` (top 3, capped), `otherProviderCount`),
  refreshed every 5 minutes by `runDecentralizationCycle()`. This is the
  **current/live** reading; this design adds the **historical** side.
- `getAllNodeIpClassifications()` (both DB adapters): full classification
  list (`ip`, `org`, `isDatacenter`, `classifiedAt`), already used internally
  by `computeAndCacheStats`/`computeTopDatacenters`. This design adds a
  sibling function that returns the **complete** per-org breakdown (not
  capped to 3) for the daily snapshot to persist.
- `snapshotManager.js`'s `takeSnapshot()`: the once-daily cycle that builds
  `snapshotData` from `getCurrentMetrics()` and calls `createDailySnapshot()`
  + `createRepoSnapshots()`. Decentralization hooks into this same cycle —
  no new schedule.
- `repo_snapshots` table shape (`snapshot_date`, `image_name`,
  `instance_count`, category, `UNIQUE(snapshot_date, image_name)`): the
  precedent for "one row per (date, variable-key)" data, reused for the
  per-provider table below.
- `Chart.svelte`'s `categories` object + generic weekly/monthly aggregation
  (average for every category except `revenue`, keyed purely on
  `selectedCategory`, not per-metric): the 5 new metrics need **zero**
  changes to the aggregation functions, only a new `categories.decentralization`
  entry.
- `/api/analytics/comparison/:days`: builds a `current` object (today, mixed
  from `getCurrentMetrics()` and other live sources) vs a single
  `daily_snapshots` row from N days ago, via `calculateChange()`. Cloud's
  `cpu`/`ram`/`storage` percent comparisons are the closest existing
  precedent — decentralization follows the identical shape.
- `metrics.js`'s `SECTIONS` (KPI report): `{ key, title, source, aggregation,
  metrics: [{ key, label, column, format }] }`, period-averaged via
  `periods.js`/`dayCount()`, `MIN_COVERAGE = 1.0` (report "Insufficient data"
  rather than a partial average). `FLUX_CLOUD_SECTION` is the existing
  precedent for a section that ISN'T a plain per-column average.
- `RevenueTransactions.svelte`'s `exportToCSV()`: client-side blob download
  from already-fetched data — no server-side CSV generation anywhere in this
  codebase. Reused as the export pattern.

## Data model

### 1. Three new columns on `daily_snapshots` (headline numbers)

```sql
decentralization_datacenter_count   INTEGER   -- classified nodes in a known datacenter
decentralization_independent_count  INTEGER   -- classified nodes NOT in a known datacenter
decentralization_datacenter_percent REAL      -- datacenter_count / (datacenter_count + independent_count) * 100
```

All three nullable, no default. `% Independent` / `Decentralization %` is
**not** stored — it's `100 - decentralization_datacenter_percent`, computed
where displayed (Chart.svelte, the comparison endpoint, the KPI section).
Storing the complement would be redundant data that can drift from its
source; `cpu_utilization_percent` et al. are stored directly because they
come from a genuinely separate calculation, not a pure complement.

**SQLite** (`sqliteAdapter.js`, `createSchema()`): three
`ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS <col> <TYPE>`
statements (SQLite's `ADD COLUMN` on an existing table is itself the "safe
migration" — no data loss, existing rows read the new columns as `NULL`).
Mirror the existing gaming-columns migration path in `createSchema()` (see
the `[SCHEMA] Schema updated with new columns` log line already present) —
this is additive-only and runs on every boot, matching the "run schema
migration" step `initDatabase()` already performs.

**Supabase**: new migration `008_decentralization_daily_columns.sql`:

```sql
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS decentralization_datacenter_count INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS decentralization_independent_count INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS decentralization_datacenter_percent REAL;
```

Needs manual application in the Supabase SQL Editor, same as
`007_node_ip_classification.sql` was. `createDailySnapshot()` in both
adapters already does a generic column-keyed insert (it takes the
`snapshotData` object as-is) — no adapter code change needed there beyond
adding the three keys to `snapshotData` in `snapshotManager.js`.
**Verify this assumption while implementing**: if either adapter's
`createDailySnapshot()` turns out to hard-code its column list (rather than
spreading the object), that function needs the three columns added
explicitly — check both adapters before writing the snapshot-collection
task.

### 2. New `decentralization_snapshots` table (per-provider breakdown)

```sql
CREATE TABLE decentralization_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,   -- SQLite; Supabase: SERIAL/IDENTITY
    snapshot_date TEXT NOT NULL,
    org TEXT NOT NULL,          -- provider org string, or the sentinel '(independent)'
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(snapshot_date, org)
);
CREATE INDEX idx_decentralization_snapshot_date ON decentralization_snapshots(snapshot_date);
CREATE INDEX idx_decentralization_org ON decentralization_snapshots(org);
```

One row per (date, org) — every provider classified as a datacenter that
day gets its own row, **plus one row with `org = '(independent)'`** holding
the non-datacenter classified count. This is deliberately NOT the top-3-only
view the live card shows: capping happens at read time (chart, KPI, CSV),
not at collection time, so a future change to "how many providers to show"
never needs re-collecting history, and the CSV export has the real full
breakdown. Mirrors `repo_snapshots`' per-image-per-day shape exactly,
including the `UNIQUE(date, key)` upsert-friendly constraint.

New Supabase migration `009_decentralization_snapshots.sql` (both the table
and an RLS-enable statement, matching `007`'s posture); SQLite table created
in `createSchema()` alongside the other `CREATE TABLE IF NOT EXISTS`
statements.

### 3. New DB adapter functions (both adapters, routed via `database.js`)

- `createDecentralizationSnapshots(snapshotDate, breakdown)` — bulk upsert
  `[{org, count}]` rows for one date. `ON CONFLICT(snapshot_date, org) DO
  UPDATE SET node_count = excluded.node_count` (SQLite) /
  `.upsert(rows, { onConflict: 'snapshot_date,org' })` (Supabase) — mirrors
  `upsertRepoSnapshots()`/`createRepoSnapshots()` exactly enough to copy
  their shape.
- `getDecentralizationSnapshotHistory(startDate, endDate)` — every
  `(snapshot_date, org, node_count)` row in an inclusive date range, ordered
  by date then node_count desc. Backs both the CSV export and the KPI
  top-3-for-period computation. Supabase side must page past the 1000-row
  PostgREST cap (`exportAllRepoSnapshots()` is the copy-paste template) —
  worth doing from the start since a long date range × dozens of providers
  can exceed 1000 rows.

### 4. New `decentralizationService.js` function: full breakdown for snapshotting

```js
/**
 * Every classified provider's current count (not capped to 3), plus the
 * independent bucket under the '(independent)' sentinel org. Used only by
 * the daily snapshot collector -- getDecentralizationStats() stays capped
 * at top 3 for the live card, unaffected by this addition.
 */
export function getFullDatacenterBreakdown() { ... }
```

Reads from the same in-memory classification state `computeAndCacheStats`
already builds each cycle (or recomputes from `getAllNodeIpClassifications()`
+ `getCachedNetworkNodeIps()` if called before the first cycle, same
cold-start fallback `getDecentralizationStats()` already has). Returns
`[{org, count}]` for every distinct org among datacenter-classified
candidate nodes, plus `{org: '(independent)', count: independentCount}`.

## Collection: hook into the existing daily snapshot cycle

In `snapshotManager.js`'s `takeSnapshot()`, alongside the existing
`currentMetrics` read:

```js
const decentralization = await getDecentralizationStats();   // live cache, already fresh
const breakdown = getFullDatacenterBreakdown();               // sync, same in-memory state
```

Add three keys to `snapshotData` before `createDailySnapshot(snapshotData)`:

```js
decentralization_datacenter_count: decentralization.datacenterCount ?? null,
decentralization_independent_count: decentralization.classifiedCount != null && decentralization.datacenterCount != null
    ? decentralization.classifiedCount - decentralization.datacenterCount
    : null,
decentralization_datacenter_percent: decentralization.datacenterPercent ?? null,
```

`null` (not `0`) when nothing has been classified yet — same "0 in a
snapshot column means the collection failed, not a real reading" rule the
KPI section already applies elsewhere in this codebase (see `metrics.js`'s
header comment). Then, after `createDailySnapshot()` succeeds:

```js
if (breakdown.length > 0) {
    await createDecentralizationSnapshots(snapshotDate, breakdown);
}
```

Failure handling matches the existing `repo_snapshots` call immediately
below it in `takeSnapshot()`: best-effort, logged, never blocks the
headline `daily_snapshots` row from being written.

## Historical charting (`Chart.svelte`)

New category, no changes to `aggregateByWeek`/`aggregateByMonth` (both are
generic per-field average already, keyed only on `selectedCategory !==
'revenue'`):

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

One small addition where `Chart.svelte` reads `snapshot[metric.field]`
(daily path, and both `aggregateByWeek`/`aggregateByMonth`): when
`metric.invert` is true, use `100 - value` instead of `value`. A `null`
column value (nothing classified that day yet) must stay excluded from the
average the same way missing gaming/crypto columns already are (check how
the existing average branch treats `snapshot[field] || 0` — decentralization
should NOT coerce `null` to `0` the way that fallback does, since a real 0%
datacenter reading and "not classified yet" are different things; verify
during implementation whether the existing `|| 0` needs a `null`-aware
variant just for this category, or whether skipping rows where the field is
`null` is enough. Get this right — it is the same "0 means failed
collection, not a real reading" rule the KPI layer already documents.)

## `vs D/W/M/Q/Y` comparison toggle (`/api/analytics/comparison/:days`)

Add alongside the existing `cpu`/`ram`/`storage` block in
`GET /api/analytics/comparison/:days`:

```js
const liveDecentralization = await getDecentralizationStats();
// ... inside the `if (pastSnapshot)` branch, alongside cpu/ram/storage:
response.changes.decentralization = calculateChange(
    liveDecentralization.datacenterPercent ?? 0,
    pastSnapshot.decentralization_datacenter_percent
);
```

`calculateChange()` already treats a missing/zero `past` as `{change: 0,
trend: 'neutral'}` — matches how a pre-this-feature historical snapshot
(column is `NULL`) degrades gracefully with no special-casing needed.
`DecentralizationCard` gains a `change`/`trend` display (same shape
`StatCard` already renders for Total App Instances), wired to
`comparison.changes.decentralization` from `+page.svelte` the same way
`totalApps`'s change/trend props already are. `BusiestNodeCard` is
unaffected — no comparison wiring, as confirmed.

## CSV export

New endpoint `GET /api/decentralization/history?days=N` (default something
like 90, matching Chart.svelte's own timeframe options) joining
`getDecentralizationSnapshotHistory()` with the headline `daily_snapshots`
columns for the same date range, returned as JSON (the CSV itself is built
client-side, matching this codebase's only existing precedent —
`RevenueTransactions.svelte` never generates CSV server-side).

`DecentralizationCard.svelte` gets an "Export CSV" affordance (icon button,
matching `RevenueTransactions`' existing button styling) that fetches this
endpoint once on click and builds:

```
date,org,count,percent_of_classified,datacenter_total,independent_total,datacenter_percent,coverage_percent,total_nodes
2026-09-08,Hetzner Online GmbH,45,22.5,178,122,59.3,12.0,2508
2026-09-08,OVH SAS,31,15.5,178,122,59.3,12.0,2508
2026-09-08,(independent),122,61.0,178,122,59.3,12.0,2508
```

`percent_of_classified` = `count / (datacenter_total + independent_total) *
100`, computed client-side per row — not stored (same "don't store a pure
derivation" reasoning as the headline percent column).

## KPI report (`metrics.js`, `discord.js`)

### Headline: new `SECTIONS` entry

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

Fits the existing per-column-average path exactly like Nodes/Resources —
`MIN_COVERAGE = 1.0` applies unchanged (a period with any day missing this
column reports "Insufficient data", the same as every other metric; this is
expected and correct for the rollout period right after this ships, when
old days genuinely have `NULL` here).

### Top 3 providers: a special block, not a `SECTIONS` metric

Doesn't fit "one column, period-averaged" — needs
`getDecentralizationSnapshotHistory()` for the period's date range, then:

1. Group rows by `org` (excluding `(independent)`)
2. For each org, average `node_count` **only over the days that org has a
   row for** (an org with 3 rows in a 7-day period averages over 3, not 7 —
   the same "average what actually happened" reasoning `averageColumn()`
   already uses for snapshot columns, adapted to a sparse per-org series
   instead of a dense per-day one)
3. Rank by that average, descending; take top 3
4. Report `{org, avgCount, avgPercentOfClassified}` per entry — the percent
   needs the period's average `datacenter_total + independent_total` as its
   denominator (from the headline section's own averaging), not recomputed
   independently

Rendered in `discord.js`'s `buildDiscordPayload()` as a short fixed-format
block appended to the Decentralization section's field value (below the
`% Datacenter` line, same field — not a second embed field), formatted
plainly (`1. Hetzner Online GmbH — 45 avg nodes (22.5%)`) to stay inside
Discord's 1024-char field cap without needing the budget-capped "+N more"
machinery `buildFluxCloudActivityPayload()` uses (3 fixed lines is already
small).

**Daily timeframe**: per the existing daily-report rule ("single-day
snapshots are not averaged"), the top-3-for-period computation for `daily`
degenerates to that one day's `decentralization_snapshots` rows directly,
sorted by `node_count` — no averaging needed since there's only one day.

## Testing

- `resourceBar.test.js`-style pure-function tests for the new "average per
  sparse org-day series" helper and the CSV row-shaping function
- DB adapter tests for `createDecentralizationSnapshots`/
  `getDecentralizationSnapshotHistory`, same real-temp-sqlite-file pattern
  as `nodeIpClassification.test.js`
- `snapshotManager` test coverage for the new `snapshotData` keys (null when
  nothing classified yet, populated correctly when `decentralizationService`
  has live data) — verify against whatever existing `snapshotManager.test.js`
  coverage pattern already exists for e.g. the gaming/crypto columns
- `metrics.test.js`/`discord.test.js` coverage for the new SECTIONS entry
  and the top-3-providers block, following the existing coverage/
  insufficient-data test patterns in that suite
- `Chart.svelte` doesn't have unit tests today (checked: none of its
  aggregation logic is covered) — this design doesn't introduce a new
  testing gap, but flags the pre-existing one; not in scope to fix here
- Live verification against real data (same practice used for the
  Decentralization metric itself and the header animation): run one real
  `takeSnapshot()` cycle against the actual `decentralizationService` state
  and confirm the written row's headline numbers match what `/api/decentralization`
  reports at that moment

## Open implementation risks to verify early (not deferred to "later")

1. **`createDailySnapshot()`'s column handling** in both adapters — confirm
   it's a generic object-keyed insert before assuming "just add three keys
   to `snapshotData`" is sufficient (noted inline above).
2. **`Chart.svelte`'s `null`-vs-`0` handling** in the aggregation average —
   confirm whether `snapshot[field] || 0` needs to become `null`-aware for
   this category specifically, since a `0`-coerced `null` silently
   misreports "not yet classified" as "0% datacenter" in the chart the same
   way the KPI layer already guards against for other metrics.
3. **SQLite `ALTER TABLE ADD COLUMN IF NOT EXISTS` syntax**: confirm the
   installed `better-sqlite3` version supports the `IF NOT EXISTS` clause on
   `ADD COLUMN` (added in SQLite 3.35+) — if not, fall back to the
   check-then-add pattern already used elsewhere in `createSchema()` for
   columns added after the initial schema.

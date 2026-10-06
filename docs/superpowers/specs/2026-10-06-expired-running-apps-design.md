# Expired running apps — design

Date: 2026-10-06
Status: approved in conversation, awaiting written-spec review

## Purpose

Make visible, and track over time, apps that are still running on Flux nodes after their
subscription has ended. A comparison with FluxView (2026-10-06) found 18 such apps, the oldest
50 days past expiry (`palworld1785555251684`), and Flux's own `web` app still on 4 nodes 18 days
after cancellation. Fluxtracker counts running containers, so these apps currently inflate its
figures silently. This feature names them, counts them, and keeps a daily history so the trend is
visible (is cleanup getting better or worse?).

Out of scope: the opposite gap (ordered but not running) — the Apps card's existing
"ordered vs supplied" fill already covers it.

## Definitions

- **End block** of an app = `height + expire`, where `height` is the block of the app's latest
  register/update message and `expire` the number of blocks paid for in that message. A spec with
  no `expire` uses Flux's default of **22,000 blocks**.
- **Blocks per day** = **2,880** (30-second blocks).
- **Grace period** = **2,880 blocks (24 hours)**. Normal teardown and the stats crawl both lag;
  an app only counts once it is clearly stuck, not merely mid-cleanup.
- An app is **expired running** when all of these hold:
  1. it has at least one running container in the stats crawl;
  2. its end block is known (see Sources);
  3. `currentBlock − endBlock ≥ 2,880`.
- **Instances** = distinct nodes running at least one of the app's containers (the same unit
  as `deploymentCounts`, so a 3-component app on one node is 1 instance, not 3).
- **Days expired** = `floor((currentBlock − endBlock) / 2,880)`.

## Sources for the end block, in order

1. **`globalappsspecifications`** (already cached hourly by `appSpecsCache.js`). Flux keeps some
   specs there for a while after they expire (50 seen on 2026-09-21), so for those the spec
   itself gives `height + expire`. A spec whose end block is still in the future means the app
   is live — never expired running, regardless of anything else.
2. **`permanentmessages?appname=<name>`**, for running apps with no spec at all. The last message
   (highest `height`) carries `appSpecifications.expire`. The lookup is **case-sensitive**
   (`AbioticFactor` resolves, `abioticfactor` returns `[]`), so detection must use the app name
   as it appears in the container name, not the lowercased key.
   - Result cached in memory per app name. A resolved end block never changes, so it is cached
     until process restart; an empty result (`[]`) is cached for 24 h (re-checked in case it was
     a transient API gap).
   - A failed request (network/timeout/breaker open) is not cached: the app is skipped this
     cycle, logged once, and retried next cycle. It is never counted as zero days or as live.
   - Breaker key `permanent-messages-app` via `resilientFetch.js`, distinct from the revenue
     sync's full-dump key so one cannot open the other.

An app that is running, has no spec, and has no permanent message at all (e.g. `v11`, `noperi`,
local `cloudgit` containers) is **not** counted — there is no subscription that could have expired.
A re-registered app is back in the specs with a future end block, so it drops out automatically.

## Components

### `runningAppsProvider.js` (small change)

`fetchRunningApps()` additionally returns `deploymentNames: Map<lowercaseName, originalName>`
(first casing seen wins). Nothing else changes; existing consumers ignore the new field.

### `src/lib/services/expiredRunningService.js` (new)

- `computeExpiredRunning({ deploymentCounts, deploymentNames, specs, currentBlock, endBlockLookup })`
  — **pure**: returns
  `{ apps, instances, top: [{ name, instances, daysExpired, endBlock }], unresolved }`,
  with `top` = the 3 apps with the largest `daysExpired` (ties broken by name). `endBlockLookup`
  is injected so tests need no network. `unresolved` = apps skipped because the lookup failed.
- `getExpiredRunning(options)` — wires the live inputs (`getRunningApps()`, `getAllAppSpecs()`,
  `fetchCurrentBlockHeight()`, the cached permanent-messages lookup). Returns `null` when the
  current block or running apps are unavailable (the card then shows "n/a", never 0).
- Constants `EXPIRED_RUNNING_GRACE_BLOCKS = 2880`, `BLOCKS_PER_DAY = 2880`,
  `DEFAULT_EXPIRE_BLOCKS = 22000`, `EXPIRED_RUNNING_TOP_N = 3` live in `config.js`.

### Service cycle

`cloudService.js` (where the deployment-fill columns are written today) calls
`getExpiredRunning()` and adds `expired_running_apps` and `expired_running_instances` to the
keys it passes to `updateCurrentMetrics()`. A failure there is caught and logged; it must not
affect the fill columns or the rest of the cycle (per-service isolation, #51). On `null`, the
keys are omitted (not written as 0), so the last good value stays.

### Database

- Migration `supabase/migrations/031_expired_running.sql`:
  `ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS expired_running_apps INTEGER;`
  `... expired_running_instances INTEGER;` and the same two on `daily_snapshots`.
- SQLite `createSchema()` gets the same columns; `schemaMigrator.js` adds them on existing DBs.
- Both added to `METRIC_COLUMNS`; `snapshotManager.buildSnapshotData()` copies them into the
  daily snapshot like `deployments_ordered`; `supabaseAdapter.createDailySnapshot()` includes
  them the same conditional way it includes the fill columns.
- No new table, no new adapter function (contract count stays 103). `daily_snapshots` is
  already in the R2 backup, so history is backed up with no backup change.

### API

`GET /api/apps/expired-running` in `src/routes/api/analytics.js`, next to
`/api/apps/deployment-fill`, using the same `READ_PATH_TTL_MS` and `withDbFallback` pattern.
Response:

```json
{ "available": true, "apps": 18, "instances": 21,
  "graceDays": 1,
  "top": [ { "name": "palworld1785555251684", "instances": 1, "daysExpired": 50 } ] }
```

`available: false` (with no figures) when the live computation returns `null` and there is no
stored value.

### Apps card (`AppInstancesCard.svelte`)

- Header gets a top-right toggle group copied from `DecentralizationCard.svelte`
  (`.view-switch`, transparent buttons, cyan border when active, `aria-pressed`):
  **Apps** | **Expired running**. Default view is Apps (unchanged).
- The Expired running view fetches `/api/apps/expired-running` on first switch, then at most
  every `DASHBOARD_REFRESH_MS`, and on `refreshSignal`.
- Content:
  - Headline: `Expired running` and the total, e.g. **18 apps · 21 instances**, with the
    explanation "Still on nodes at least 24 h after the subscription ended" as a subtitle and
    tooltip.
  - Below it, the 3 longest-expired apps, styled like the Gaming `game-list` rows: name on the
    left (ellipsis, `min-width: 0`, full name in `title`), then two separate right-aligned
    columns — instances (`1 inst`) and age (`50 d`) — so the three values never run together.
  - Zero apps: "None — every running app has a live subscription."
  - Unavailable: "n/a".
- All numbers through `$lib/utils/format.js`.

### History chart (`Chart.svelte`)

Two entries in the `applications` category, group `Daily`: **Expired running apps**
(`expired_running_apps`) and **Expired running instances** (`expired_running_instances`), both
`dropNulls` (days before the feature existed have no value, not zero). No new graph.

### README

New section "Expired running apps", under "App Categorisation", covering the definition, the
two sources, the grace period, and this worked example (real data, 2026-10-06):

> `palworld1785555251684` was last updated at block 2,867,975 with `expire` 100 (the owner
> cancelled it). End block = 2,867,975 + 100 = **2,868,075**. At block 3,012,176 it was still
> running on one node: 3,012,176 − 2,868,075 = 144,101 blocks = 144,101 / 2,880 = **50 days**
> expired. That is past the 2,880-block (24 h) grace period, so it counts: 1 app, 1 instance,
> 50 days.
>
> Counter-example: an app whose end block was 1,500 blocks ago (~12.5 h) is still within the
> grace period and is not counted, even though it is past its end block.

## Testing

- `expiredRunningService.test.js` (pure function):
  - exactly 2,880 blocks past the end → counted; 2,879 → not counted;
  - spec present with future end block → not counted even if a permanent message disagrees;
  - spec present but expired → end block from the spec, no lookup made;
  - no spec, lookup returns a message → counted from the last message's height + expire;
  - message without `expire` → 22,000-block default;
  - no spec, lookup returns `[]` → not counted;
  - lookup throws → app in `unresolved`, not counted;
  - original-case name is what the lookup receives;
  - top-3 ordering and tie-break; instances summed across apps.
- Cache behaviour of the lookup (resolved cached, `[]` cached 24 h, failures not cached).
- Adapter tests: the two columns round-trip through `updateCurrentMetrics` and
  `createDailySnapshot` on SQLite.
- Endpoint test for `/api/apps/expired-running` (available, unavailable, DB fallback).
- Live check: the endpoint's count against a fresh manual run of the 2026-10-06 comparison script.
- `scripts/header-smoke/check-header.mjs` run, since `+page.svelte`/the card change; then a
  browser check that the toggle switches, the list renders real names, and the chart dropdown
  plots the series.

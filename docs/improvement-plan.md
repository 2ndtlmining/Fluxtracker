# Fluxtracker — What's Next

**Last reviewed: 2026-09-22** (against `main` and against live network data)

GitHub issues are the queue. This file is the **order** and the **reasoning** — why an item is
worth doing and what "done" looks like. If the two disagree, the issues win; re-review this file.

The previous version of this file carried its own triage table that went a month stale and
listed eight closed issues as open. That table is gone. Anything here that is not a standing
rule links to an issue.

---

## Next up, in order

### 1. #246 — Static assets bypass compression (~495 KB per cold load)

The one remaining performance gap, and a one-line fix. `adapter-node` serves `/_app/` through
sirv, which runs **before** the `handle` hook where the runtime compression from #242/#243
lives, so the client bundle and CSS go out uncompressed. Measured on a deployed instance: the
74,612-byte CSS returns `content-encoding: none`, while the HTML (25.3 KB → 5.5 KB) and the
API responses (93.4 KB → 22.2 KB) are compressed.

`precompress: true` in `svelte.config.js` emits `.br`/`.gz` at build time and lets sirv serve
them: better ratio than the runtime path (build-time brotli can afford quality 11) and zero
per-request CPU. Repeat visits already hit `immutable` cache, so this is first-load only —
which is the load that decides whether the dashboard feels fast.

### 2. #247 — `/api/admin/snapshot-status` always 500s

Two-line fix, and the endpoint is currently useless: `getSnapshotSystemStatus()` strips
`repoRetryId` out of `state` but not `intervalId`, which holds a `setInterval` handle, so
`res.json()` hits a circular structure. Strip it the same way and expose `isSchedulerRunning:
!!intervalId`, matching what `revenueScheduler` already returns.

No test caught this because `intervalId` is null unless the scheduler actually started, which
it never does in the suite. The test to add starts one.

### 3. #249 — Decentralization columns null on restart days

Currently makes **every** KPI decentralization metric read "Insufficient data", in every
timeframe, on an instance whose live card and chart are both fine. The snapshot writes those
columns only when `classifiedCount > 0`, and that count comes from `getCachedNetworkNodeIps()`
— an in-memory cache owned by `busiestNodeService` that is empty for the first minutes after a
restart. A deploy shortly before the daily snapshot silently costs that whole day.

Fix at the source: when the candidate set is empty, fetch it rather than proceeding with
nothing — and log loudly, because today the only trace is a null column noticed weeks later in
a report.

### 4. #248 — `daily_snapshots.daily_revenue` is ~0 for every completed day

110 of the last 120 rows are exactly 0 while the transaction table shows 5,000–21,000 FLUX for
the same days. The snapshot is taken minutes after midnight UTC and records "revenue so far
today", then is never revisited.

Ranked below #249 because nothing user-facing reads it — the chart and the KPI reports both go
to `revenue_transactions` — but it is published by `/api/history/snapshots*` and it is what a
restore from R2 brings back. Fix is to backfill D-1's completed total when writing D's row,
plus a one-off admin backfill for the existing history.

### 5. #250 — Documentation gaps

This file was item 1 of that issue. Remaining: `/api/carousel/missing` missing from the
README's Carousel table, the phantom deletion of
`FluxTracker_Header_Terminal_Animation_Spec.md`, and the unmarked status on the shipped plans
and specs under `docs/superpowers/`.

### 6. Header animations — #181, #182, and Palworld

Highest-value first, by live instance counts (Dragonwilds 258, **Palworld 227**, Valheim 106,
Minecraft 59):

- **Palworld has no art** despite being second by instances — every Palworld deployment plays
  the shared controller. Art for it takes per-game coverage from 61% to 93% of game instances,
  and costs one `GAME_INTROS` entry plus a formatter. Not yet an issue; file one when starting.
- **#181, non-game deployments** — 26% of the last 24h (35 of 133) get *no* intro at all,
  because `introForSlot()` returns null when `resolveGameFromAppName()` doesn't match.
- **#182, expiring** — same gap on the other side; expiring slots never get an intro.

Every one of these is one registry entry plus one formatter. Both motion techniques already in
the repo are length-preserving by construction (rotate a fixed-width strip; overlay onto a
`LOGO_WIDTH` canvas), which is what keeps the box from ever depending on content. Run
`scripts/header-smoke/` before and after.

### 7. #155 — KPI reports via API, #156 — Google Analytics 4

Features, no dependencies on the above.

---

## Standing rules, each learned from an outage

### A bound that returns success is a bug

Four separate incidents, same shape:

1. `exportAllPriceHistory()` had no `.range()`, so PostgREST truncated the R2 backup at 1000
   rows. A fresh instance bootstrapped from a price history that ended before its first
   transaction.
2. `getPricesForDateRange()` had the same gap, capping the in-memory price map at 1000 days.
3. The CSV export asked for ~21,000 transactions in one call; the server clamped the page size
   to 1000 and returned a truncated file that looked complete.
4. #227 found three more un-paged selects.

**Rule:** any query or fetch with a limit either pages to completion or logs what it dropped.

Still worth auditing: every remaining un-paged `supabase.from(...).select()` that can exceed
1000 rows, and `getTopReposByCategory`'s explicit `CATEGORY_FETCH_LIMIT = 200` — if a category
ever exceeds it, grouping loses instances silently.

### "No console errors" is not verification

A CSP that blocked SvelteKit's hydration script froze the entire production dashboard on
"Loading..." — zero console errors, zero failed requests — and survived two PRs because
verification checked for the absence of red text instead of the presence of the feature. Wait
for real data to resolve, click something, confirm a value changed. See CLAUDE.md.

### `min-width: 0` or `text-overflow: ellipsis` does nothing

A grid/flex item that never shrinks cannot ellipsis. `NodeCard`, `AppInstancesCard` and
`DecentralizationCard` have it; `StatCard` and `CloudCard` do not — worth checking whether
they need it before the next long label arrives.

### Secure-context APIs need a fallback

`navigator.clipboard` is undefined over plain http from an IP, which is exactly how this
dashboard is often served. Anything gated on `window.isSecureContext` needs a fallback plus
visible feedback; a silent UI failure is the same class of bug as a silent cap in a query.

### `current_metrics` is a single-row read-modify-write

`updateCurrentMetrics()` reads, merges and writes the whole row, which is why the service cycle
is deliberately sequential. Parallel cycles would clobber each other's columns — switch to
per-column updates first if that ever changes.

### Inclusive date ranges

An inclusive range covering N days starts at `today - (N - 1)`. `>= today - days` returns
N+1 rows. Fixed once already; easy to reintroduce.

---

## Operational review, every few months

### Category config drifts as Flux ships games

`GAMING_REPOS`, `CRYPTO_REPOS` and `CATEGORY_CONFIG.keywords` are hand-maintained, and Windrose,
Rust, Terraria and ARK were all live on the network before being tracked. Re-run:

```bash
curl -s "https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image" \
  | jq -r '.data[].apps.runningapps[]?.Image' | sort | uniq -c | sort -rn | head -60
```

Anything with meaningful instance counts landing in "Other" is a candidate.

### Fiat gateway addresses

`FLUX_FIAT_ADDRESSES` drives the Fiat revenue metric and the FIAT badge. Adding a gateway is a
one-line config change; the failure mode is silent **under-reporting**, not an error. Re-check
against a known fiat purchase whenever the number looks off.

### Companion websites

`runonflux/*-server-website` images are excluded via `CATEGORY_EXCLUDE`. A new naming
convention for these inflates the game totals again.

---

## Settled — do not re-raise

- **Admin API has no authentication.** Assessed 2026-09-21 and accepted as the deployment's
  risk profile.
- **#61, KPI email delivery.** Parked deliberately: "we will not do that any time soon."
- **`ws` as a direct dependency.** It looks unused in `src/`; `@supabase/realtime-js` needs it
  on Node < 22 and hoisting proved unreliable. See CLAUDE.md before "tidying" it.

---

## Recently shipped

Newest first. Kept short — `git log` is the full record.

| PR | What |
|----|------|
| #251 | Per-view carousel icon colours; `--accent-orange` finally declared |
| #245 | One implementation per decentralization dimension, one classification read per snapshot cycle (#151) |
| #244 | Test coverage for cloudService, revenueScheduler, serverHelpers, revenueReporting and the analytics comparison endpoint (#225) |
| #243 | Compression that actually reaches the browser (#242) |
| #241 | Response compression + revenue sum via RPC (#227) |
| #240 | README brought back in line with the code (#226) |
| #239 | Per-game columns store the app-name count (#231) |
| #238 | Stop re-downloading 3.8 MB per `/api/header` miss (#221) |
| #237 | CI: tests on every PR, header-smoke on a path gate (#223) |

Earlier rounds: keyless Binance → CoinGecko price chain with gap-aware sync (#56), unified
category counting through `categorizeImage()`, canonical-name grouping, companion-website
exclusion, shared running-apps fetch, per-service isolation (#51), config-driven intervals
(#50), shared refresh signal (#53), freshness-bound LIVE badge (#54), one resilient fetch
helper with a per-endpoint breaker (#52/#55).

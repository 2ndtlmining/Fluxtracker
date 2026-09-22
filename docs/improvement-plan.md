# Fluxtracker — What's Next

**Last reviewed: 2026-09-22** (against `main`, live network data, and a full run of the smoke harness)

GitHub issues are the queue. This file is the **order** and the **reasoning** — why an item is
worth doing and what "done" looks like. If the two disagree, the issues win; re-review this file.

The previous version of this file carried its own triage table that went a month stale and
listed eight closed issues as open. That table is gone. Anything here that is not a standing
rule links to an issue.

---

## Next up, in order

Every open bug, data-quality and performance issue is now closed. What is left is feature
work, so the order below is about value rather than urgency — nothing here is bleeding.

### 1. #181 — Non-game deployments get their own intro

The biggest remaining gap in the header, and the same shape as the four game intros that
already exist. `introForSlot()` returns null when `resolveGameFromAppName()` does not match,
so **26% of deployments get no intro at all** — 35 of the 133 in a measured 24 hours
(`betpro-account`, `geap`, `teamspeak6`, `renderflow`, …). They fall straight through to the
detail frame while every game gets an animation first.

A Docker whale surfacing, with containers stacking one per instance, is the shape the issue
proposes. Reuse the longship skeleton like Palworld did: two strips rotated at different
periods, art overlaid onto a fixed-width canvas, sky furniture so no row is ever empty.

**Before starting:** the harness's first fixture is deliberately a game with *no* art, to
cover the controller fallback. A non-game intro changes what "no art" means for that fixture
— check `stub-api.mjs`'s `INITIAL_DEPLOYED` still exercises the fallback it claims to.

### 2. #182 — Expiring apps get their own intro

The same gap on the other side: `introForSlot()` returns null for anything that is not a
deployment, so expiring slots never get an intro at all. Of the five options in the issue,
the **fuse** is the one worth building — it reads as time running out without implying
failure, and it animates as a single travelling spark along a fixed-width strip, which is the
cheapest possible length-preserving motion.

Note the accent: expiring rows are `--accent-orange`, not the deployment green, so
`expiringFrameKinds()` is the model rather than `palworldFrameKinds()`.

### 3. #155 — KPI reports via API

No dependencies. The KPI layer is already pure and well tested (`src/lib/kpi/`), and
`/api/kpi/preview` already returns the full dataset — this is mostly about what a caller is
allowed to ask for and how it is authenticated, which is the part worth thinking about first
given the admin API has no auth today.

### 4. #156 — Google Analytics 4

Straightforward, but note the CSP: #131's incident was a hand-set header blocking SvelteKit's
own inline script. GA4 needs `script-src` and `connect-src` entries in
`svelte.config.js`'s `kit.csp`, never a header in `hooks.server.js`, and
`scripts/header-smoke/` is the gate that proves hydration still works afterwards.

### Ideas, not yet issues

- **More per-game art.** After Palworld the top four are covered (93% of running game
  instances). The next tier is a long tail — FiveM 12 instances, Project Zomboid 7, Rust 7,
  Terraria 6, Enshrouded 5 — so the shared controller is doing proportionate work there.
  Worth revisiting only if one of them grows.
- **Tier-scaled intensity.** An ENTERPRISE deployment could run the same art with a brighter
  accent or a longer dwell, conveying size without new art.
- **Milestone frames.** When a game crosses a round number of instances, play the logo in that
  game's accent with one line (`palworld · 250 instances`). Rare enough to feel like an event.

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

### A fixture chosen for what it LACKS needs a note saying so

The smoke harness used `palworld` as its first deployed fixture *because it had no art*, so
every run also exercised the shared controller fallback. Nothing said so next to the fixture.
Giving Palworld its own intro silently removed that coverage — the `gamepad: controller frame
shown` check would have kept passing right until the fixture started rendering the new art,
then failed for a reason nobody would connect to the change. The fixture is `enshrouded` now,
with a comment saying it has to move again the next time a game gains art.

### A cached read can make a successful write look like a no-op

Reading back through `/api/history/snapshots*` immediately after the #248 repair showed the
**pre-repair** values, because those endpoints sit behind `withDbFallback`'s cache. The write
had worked. After any admin operation that rewrites data, verify against the database or wait
out the TTL — a stale read is not evidence that nothing happened.

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
| #259 | Palworld gets its own header intro; smoke harness gains a fourth game (per-game art now covers 93% of running game instances) |
| #258 | Repair tolerance widened past float noise |
| #257 | Repair the snapshot revenue already written wrong — 410 rows, 499k -> 1.84M FLUX (#248) |
| #256 | Record the previous day's completed revenue with each snapshot (#248) |
| #255 | Warm the node list before classifying, so restart days keep their data (#249) |
| #254 | Stop serialising a timer handle into the snapshot status (#247) |
| #253 | Precompress static assets — 495 KB -> 134 KB per cold load (#246) |
| #252 | The backlog becomes an ordered queue; shipped plans marked as shipped (#250) |
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

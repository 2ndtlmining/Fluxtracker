# Fluxtracker — What's Next

**Last reviewed: 2026-10-08** (v1.17)

GitHub issues are the queue. This file is the **order** and the **reasoning** — why an item is
worth doing and what "done" looks like. If the two disagree, the issues win; re-review this file.

The previous version of this file carried its own triage table that went a month stale and
listed eight closed issues as open. That table is gone. Anything here that is not a standing
rule links to an issue.

---

## Next up, in order

**Open (2026-10-08, v1.17):** the Whitepaper v9 pair, #510 (read the spec v9 shape) and #511
(tripwire for an unrecognised spec version). Both are due before block 3,050,000.

**Status at 2026-10-08 (v1.17):** merged.
- **Games:** 7 Days to Die (#506: #505), ARK: Survival Ascended (#515: #514), Hytale (#519, #520:
  #518) and Arma Reforger (#521) are each tracked as their own game, with an icon and header art;
  browser and web games count as gaming (#509: #508); game icons as bullets in the Gaming
  breakdown (#513: #512).
- **Data:** retention is one 10-year config value (#507); the Apps card has an Expired running view,
  tracked daily (#517).

**Status at 2026-10-02 (v1.16):** merged.
- **Data accuracy:** steady DataVex datacenter count, the override matches the org only (#495: #494);
  live FLUX price adds Binance and reads the Flux explorer's new response shape (#498);
  Satisfactory and Factorio hub apps recognised by name (#499: #496).
- **UI:** payer badge sits beside the address, not under it (#500: #497); median time left moved
  to the Applications chart, under Daily (#503: #502).

**Status at 2026-09-30 (v1.15):** merged and verified on the owner's instance.
- **Robustness:** once-a-year "not enough data" notice kept, 10-minute retry gone, shown in health
  as skipped (#478: #433); a decentralization reading a snapshot missed is topped up later the same
  day (#479: #454); a source stale for 6 hours is recorded as a gap, not frozen figures (#486: #431).
- **Performance:** full permanent-messages refresh daily, not hourly (#480: #414).
- **Docs and cleanup:** README and `.env.example` for v1.14 (#481: #425 #426); dead code removed
  (#483: #427).
- **Dependencies:** better-sqlite3 13 (#484); vitest 5, concurrently 10, dotenv 18 (#485: #438).
  On Windows, install with `npm ci --ignore-scripts && npm run prepare` (see README).
- **Header:** rotation spreads the dominant game across the round and alternates its variants
  (#487: #417); art for Enshrouded, Rust, Windrose, Terraria and a FiveM outro (#488: #418);
  a factory scene for Satisfactory/Factorio and ARK (#491: #419); n8n, SimpleX and
  Nextcloud/ownCloud (#491: #420). Every dedicated-site game now has art; the harness's
  "game without art" fixture is a Soulmask image.
- **KPI:** the *In datacenters* tile became *Ordered vs supplied* (#492: #482). #452 (numbers
  moving, Hetzner twice) was the old per-IP method, fixed by #458, and closed with an explanation.

**Status at 2026-09-29 (v1.14):** everything below is merged and verified on the owner's instance.
- **Correctness and robustness:** a failed `sync_status` read no longer restarts the revenue scan at
  block 1 (#448: #429); one revenue run per 5 minutes, and metric writes that cannot clobber each
  other (#449: #430); the ticker is one Tab stop (#450: #441); an explorer outage no longer trips
  the database breaker (#451: #432).
- **Platform:** Node 24 in the image, CI and on the deploy box (#453: #434); unused `date-fns` and
  `node-cron` dropped and deps updated in range (#460: #435); `@lucide/svelte` (#461: #436).
- **Performance:** one cached block height with background refresh (#455, #459: #415).
- **Header:** Firo, Hermes Pro and image-matched games get their art (#462: #416).
- **Decentralization, redefined with the owner (#457):** the share of NODES in datacenters, from the
  node list's own `dataCenter` flag plus `DATACENTER_OVERRIDES`, with `PROVIDER_GROUPS` joining one
  company's spellings (#458). Per-node counting starts 2026-09-29 and the chart says so (#459).
- **Geolocation demand in CPU (#463):** per continent, share of CPU capacity, share of load, and how
  full it is, coloured Low / Moderate / High / Very high (#466, #467, #468); card titled by view
  (#465: #456); demand levels shared with the Cloud Resources badge (#467: #445).
- **New stats, recorded daily:** deployment fill over unexpired apps, everywhere (#464: #421);
  private (enterprise) app share (#469: #424); block rewards per node per day by tier, in FLUX and
  $, derived for the whole history -- no APY (#470: #422).
- **UX:** readable unit labels and an explained Apps headline (#471: #445); one number format
  everywhere, plus the small inconsistencies (#472: #443 #447); hero cards compact on phones
  (#473: #442); readable transactions on every screen (#474: #440); clickable Busiest Node apps
  and shareable `?app=` / `?metric=&tf=` links (#475: #446).
- **Migrations 028-030** are applied. The R2 backup ran on the updated S3 client.

**How we work:** one themed PR at a time. The owner merges and deploys to their local instance;
Claude verifies it there (health, the behaviour the PR changed, a headless-browser load with
no NEW console errors) and goes straight on to the next PR. A version-bump PR closes each
working day, so a version change on production confirms that day's work landed. New data
points must read plainly and must not be driven by plan length or cohort age; ask the owner
before building anything whose definition is ambiguous.

### The 2026-09-27 review (done)

The review filed #414-#447 (label `review-2026-09-27`); the owner settled every open question the
same day and the decisions are recorded on each issue. All of it has shipped (see the status
above). Closed as not planned: #423 (ArcaneOS will be mandatory), #428 (keep all scripts and
contract functions), #439 (today-so-far on the Revenue card is intended; KPI compares completed
periods).

### Owner action

- **Anomaly alerts are installed but off.** To enable them, add `ANOMALY_ALERTS=on` wherever
  `KPI_WEBHOOK_URL` is set on the server (a `.env` file in the Fluxtracker folder, or the
  container's environment), then restart the API. `/api/health` -> `anomalyAlerts.configured`
  confirms it.

### Waiting on the owner

- **Server-local edit:** the deploy box had an uncommitted change to `src/lib/db/supabaseClient.js`,
  saved to `~/supabaseClient.local.diff` before the reset. Paste it so it can be built in
  properly if it was deliberate.

**Decided with the owner (2026-09-24):**
- #345: the header shows ONE wide frame per app on desktop -- name, age/expiry, instances,
  resources, game/service, image, what was paid (FLUX, USD, date) and the subscription term
  with its end date. No side panel, and no network stats (block height, node count) beside
  an app's details. Mobile keeps the 34-column frame.
- #347 Utilization Projection is queued straight after the header work (PR 15).
- #285 block milestones: dropped. Tracking arbitrary round block heights is not wanted; the
  milestone frame shipped in #333 was removed and the issue closed.

**Decided with the owner (2026-09-23):**
- #282 drops keyboard focus handling. Pause on hover and click-to-advance only.
- The header grows sideways on desktop: keep the 34x6 art cell (no existing art is redrawn)
  and add a live data panel beside it; mobile keeps today's single box.
- #155, #156 and the rest of the older features queue behind this list. #61 stays parked.

## Standing rules, each learned from an outage

### A test double looser than the real server hides the bug

#304 passed its own regression test: the mock capped table reads at 1000 rows but returned
RPC results whole, so a capped `get_distinct_repos` looked fine. The paging mock now caps RPCs
too and rejects any `.range()` without an `.order()`. When a bug is a server limit, the mock
has to enforce that limit everywhere the server does.

### Node's fetch changes conditional requests

A request carrying `If-None-Match` gets `Cache-Control: no-cache` added by Node's `fetch`
(the fetch spec), and Express never answers 304 to that -- which is why revalidation never
worked through the SvelteKit proxy (#300). The proxy sets its own `Cache-Control` on
conditional requests; keep it.

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
`DecentralizationCard` have it; `CloudCard` does not, but was tested with long injected values
at 820px and wraps inside its column (#331). `StatCard` was dead code and is gone.

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
| #359 | Paying wallets (new/returning, organic) in the chart; app revenue share + concentration in App Analytics; migration 018 (#267) |
| #358 | Revenue Sources in the chart (organic / fiat / team), and the Revenue card's USD-vs-price line (#261 #266) |
| #357 | Utilization Projection moved into the chart as a Cloud Resources metric (owner feedback) |
| #356 | Utilization Projection: app instances and readable-spec CPU if nothing renews, coverage stated (#347) |
| #354 | Large deployments play twice and brighter; seasonal sky (Halloween, December, New Year fireworks); attract mode (#286 #287 #288). #290 recommended against |
| #353 | Intros: AI agents, WordPress, VPN/proxy, Globalping probes, FiveM; second variants for Dragonwilds, Valheim, Palworld (#276-#281) |
| #352 | Expiring outros (longship sails off, Pal walks off ...), fuse fallback, crane for non-game deployments (#182 #181) |
| #351 | TERM end date carries the year when it is not this year |
| #349 | Header TERM row: subscription length (1 week ... 1 year) and end date |
| #348 | Intros for Git (Orbit), Project Zomboid, Folding@home, crypto nodes (#272-#275) |
| #346 | One wide header frame per app (type, image, payment); SvelteKit announcer CSP (#345) |
| #344 | Header hover pause, click-through to the table, reduced-motion poster, enterprise RES (#282 #284 #289) |
| #343 | COOP judged by the request Host; block milestones removed (#285 dropped) |
| #342 | Polish and accessibility: page title/OG tags, one number formatter, carousel pause + reduced motion, contrast, aria states, period control, layout fixes (#320 #321 #323-#331) |
| #340 | Lazy chart (page chunk 112 -> 45 KB gzip), server-rendered hero cards, chart data cache, index-ordered and totally ordered transaction paging (#297 #299 #303 #294) |
| #339 | Revalidation that works through the proxy (304s), idle hidden tabs, self-hosted font, one font everywhere (#300 #298 #302 #322) |
| #338 | Bounded caches (1 GB -> 72 MB under a key flood), narrow benchmark fetches, one app-specs cache, cached comparison (#291 #292 #293 #295 #296 #301) |
| #337 | Every history table backed up; per-table bootstrap; datacenter flags derived on read (#311 #314) |
| #336 | Failover never flips back; honest /api/health; container exits with its processes; npm ci; a failed sync no longer forces a full-chain rescan (#308 #309 #310 #312 #316 #335) |
| #334 | A failed read is an error, not a zero -- adapters and cards (#307 #319) |
| #333 | Header rotates the whole day, resolves service intros, block milestones (#271 #283 #285 part) |
| #332 | Five silent data-loss paths (#304 #305 #306 #313 #315) |
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

# Fluxtracker Improvement Plan

Standing backlog of known issues and code-quality work. Add to it as things surface; move
items to **Done** with the PR number rather than deleting them, so the reasoning survives.

Last reviewed: 2026-08-21

Every item below is tracked as a GitHub issue — this file is the reasoning, the issues are the queue.

---

## Open GitHub issues — triage

Each verified against the code and against live network data on 2026-08-21.

| # | Title | Label | Notes |
|---|---|---|---|
| 61 | Enable email delivery for KPI reports | `enhancement` `kpi` | Needs SMTP creds, `nodemailer` + `exceljs`, 5 env vars. No separate app required |
| 62 | KPI revenue split by app category | `enhancement` `kpi` | Depends on #38. Categories must reconcile to the headline Flux figure |
| 63 | Scheduled KPI reports | `enhancement` `kpi` | `node-cron` already a dependency; needs a stored destination list |
| 64 | Backfill app-count columns | `enhancement` `data-quality` | The single thing blocking Quarterly Applications. `repo_snapshots` may allow reconstruction |
| 65 | Single retry helper across services | `tech-debt` | Four different retry policies now; supersedes the code-quality half of #52 |
| 38 | `app_category` column on revenue transactions | — | Precondition for #62. Cheap now that categorisation is unified |
| 55 | External API fetches not circuit-broken | `enhancement` | The breaker only wraps the DB |
| 52 | Inconsistent retry logic | `bug` | See #65 |
| 49 | Spacing between gaming/crypto boxes | — | Re-check; the `min-width: 0` fix may already have resolved it |

**Closed as fixed** (verified on `main`): #39 FluxOS codename, #47 Flux DNS as game, #48 Monthly = Daily,
#50 config intervals, #51 service isolation, #53 Refresh button, #54 LIVE badge.

---|---|---|---|
| 38 | `app_category` column on revenue transactions | Real. Much cheaper now that categorisation is unified in `categorizeImage()` — the sync can call it directly and store the result | **P1** |
| 49 | Spacing between gaming/crypto boxes | Real, cosmetic. Same grid family as the label overflow; re-check now that `min-width: 0` is in place | **P2** |
| 52 | Inconsistent retry logic across services | Real. See "One retry helper" below | **P2** |
| 55 | External API fetches not protected by the circuit breaker | Real. The breaker only wraps the DB | **P2** |
| 39 | FluxOS version codename in header | **Already implemented** — `/api/header` returns `arcaneOsCodename` and `Header.svelte` renders it | Close |
| 47 | Flux DNS counted as a game | **Not reproducible** — `wirewrex/flux-dns-fdm` matches no gaming keyword and is absent from the live gaming list. Covered by a regression test | Close |
| 48 | Performance Overview: Monthly = Daily | **UI symptom already fixed** — the revenue card reads `/api/revenue/:period`, which returns correct per-period totals. The stale single-day comparison in `/api/analytics/comparison/:days` was fixed separately | Close |
| 50 | Refresh intervals don't match config | **Fixed** — `servicesScheduler.js` derives its interval from config | Done |
| 51 | One failing service aborts the rest of the cycle | **Fixed** — each step is isolated | Done |
| 53 | Refresh button updates the DB but not the cards | **Fixed** — shared `refreshSignal` store | Done |
| 54 | "LIVE" badge hardcoded | **Fixed** — bound to the API's `cacheAge` | Done |

---

## Recurring failure mode: silent caps

Three separate outages traced to the same shape — **a bound that returns success**:

1. `exportAllPriceHistory()` had no `.range()`, so PostgREST silently truncated the R2 backup
   at 1000 rows. The Flux instance bootstrapped from a price history that ended before its
   first transaction.
2. `getPricesForDateRange()` had the same gap, capping the in-memory price map at 1000 days.
3. The CSV export requested all ~21,000 transactions in one call; the server clamped the page
   size to 1000 and returned a truncated file that looked complete.

**Standing rule:** any query or fetch with a limit either pages to completion, or logs what it
dropped. A limit that can be hit silently is a bug, not a safeguard.

Places still worth auditing against this rule:
- Every remaining un-paged `supabase.from(...).select()` that can exceed 1000 rows.
- `getTopReposByCategory` is called with an explicit large limit (`CATEGORY_FETCH_LIMIT = 200`);
  if a category ever exceeds that, grouping loses instances. Consider making it page.

---

## Code quality

### One retry helper (#52)
`gamingService` had a bespoke 3×/10s loop, `cloudService` has `retryApiCall` (2×/1s),
`backupService` has `withRetry`, `runningAppsProvider` has its own. Extract one helper —
`backupService.js`'s version is the best starting point — and use it everywhere.

### Circuit breaker only wraps the DB (#55)
`circuitBreaker.js` guards Supabase calls. External APIs (`stats.runonflux.io`, CoinGecko,
Binance, the Flux daemon) have no breaker, so an outage there means every cycle pays full
timeouts. `runningAppsProvider` now at least collapses four of those calls into one.

### `console.log` in services
Issue #36 introduced pino, but several services still use `console.log`/`console.error`, so
their output isn't structured or filterable. `cloudService.js` and `wordpressService.js` are
the remaining offenders after this round.

### `getDisplayName()` fallback is lossy
The suffix-stripping fallback produced "Minecraft Server Website" and "Rust Game".
`CANONICAL_NAME_OVERRIDES` + `getCanonicalName()` is the intended path; keep it populated as
new images appear rather than relying on the fallback.

### Clipboard and other secure-context APIs
`navigator.clipboard` is undefined outside a secure context, and the dashboard is regularly
served over plain http from an IP or Flux node URL. The donate button called it directly and
threw before copying anything, logging only to the console. Any browser API gated on
`window.isSecureContext` needs a fallback plus visible feedback — silent failure in the UI is
the same class of bug as a silent cap in a query.

### `min-width: 0` discipline
A long unbreakable label overflowed the gaming card because the grid item never shrank —
`text-overflow: ellipsis` cannot work without it. Worth auditing the other card components
(`StatCard`, `NodeCard`, `CloudCard`, `AppsCard`) for the same pattern.

### `current_metrics` is a single-row read-modify-write
`updateCurrentMetrics()` reads the row, merges, and writes it back. Two services writing
concurrently would lose one set of columns, which is why the service cycle is deliberately
sequential. If cycles ever need to run in parallel, switch to per-column updates first.

### Inclusive date ranges
`getDailyRevenue*FromTransactions(days)` used `date >= today - days`, returning `days + 1`
rows. Fixed, but the pattern is easy to reintroduce — an inclusive range covering N days
starts at `today - (N - 1)`.

---

## Operational

### Category config needs periodic review
`GAMING_REPOS`, `CRYPTO_REPOS` and `CATEGORY_CONFIG.keywords` are hand-maintained. The Flux
team ships new games regularly — Windrose, Rust, Terraria and ARK were all live on the
network before being tracked. Re-run the live comparison every few months:

```bash
curl -s "https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image" \
  | jq -r '.data[].apps.runningapps[]?.Image' | sort | uniq -c | sort -rn | head -60
```

Anything with meaningful instance counts that lands in "Other" is a candidate.

### Fiat gateway addresses
`FLUX_FIAT_ADDRESSES` drives the Fiat revenue metric and the FIAT badge. It is a list, and
everything downstream takes the whole array, so adding a gateway is a one-line config change.
The failure mode is silent: an unlisted gateway makes the Fiat figure *under-report* rather than
error. Re-check against a known fiat purchase whenever the number looks off.

### Companion websites
`runonflux/*-server-website` images are excluded via `CATEGORY_EXCLUDE`. If the Flux team
introduces a different naming convention for these, the exclusion needs updating or the
game totals inflate again.

---

## Done

- **PR #56** — Historical USD revenue: replaced the dead CryptoCompare source with a keyless
  Binance → CoinGecko chain, made `syncPriceHistory()` gap-aware, added `.range()` paging to
  three truncating Supabase queries, fixed backfill paging, added price-history health.
- **Follow-up round** — Donate button copy fallback for insecure contexts, host geolocation in
  the header (`hostLocationService.js`), self-funded revenue share on the revenue card, and
  read-time category re-validation so config changes take effect without an admin call.
- **Earlier round** — Category accuracy and data alignment: unified category counting through
  `categorizeImage()`, canonical-name grouping, companion-website exclusion, shared
  running-apps fetch, per-service isolation (#51), config-driven intervals (#50), shared
  refresh signal (#53), freshness-bound LIVE badge (#54), CSV export paging, card overflow,
  inclusive-range off-by-one.

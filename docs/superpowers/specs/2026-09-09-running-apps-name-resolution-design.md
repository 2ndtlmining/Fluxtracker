# Design: Recover categorization after FluxOS v8.18 running-apps API change

## Problem

Issue #106: `stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image` — the endpoint
`runningAppsProvider.js` polls for the live running-apps census — stopped returning `Image`.
Live sample confirms each `runningapps[]` entry now comes back as an **empty object** under
that projection; broadening the projection shows the field moved: entries now carry
`Names` (Docker container name, e.g. `/fluxFoldingAtHome_FoldingAtRunOnFlux2`) and no image
data at all.

Every downstream consumer keys off `app.Image`, so `runningAppsProvider.js`'s
`if (!image) continue` silently drops **every** running-app entry. That zeroes, not just
image-derived categorization, but the app census itself:

- `cloudService.fetchAppCount()` → `total_apps`, `gitapps_count`, `dockerapps_count`,
  `watchtower_count` all compute from `runningApps.imageCounts`, now empty → all zero
- `gamingService` / `cryptoService` / `wordpressService` → `countByCategory` /
  `countConfiguredRepos` over the same empty map → category cards and metric columns zero
- `repo_snapshots` writes (`snapshotManager.takeSnapshot`) → `getLatestRepoCounts()` returns
  `{}`, and the `repoKeyCount >= 10` guard already in place has been silently skipping repo
  snapshots since the API changed (no code change needed there — it self-heals once counts
  are non-empty again)
- `carouselService.fetchTopApps()` → its own separate fetch+parse of the same endpoint,
  same failure

**Not affected**, confirmed via live samples: `globalappsspecifications` and
`permanentmessages` still return full `repotag`/`compose` data, unchanged. `revenueService`'s
`app_type` (git/docker) detection reads only those two endpoints — it was never broken by
this change and needs no fix.

## Recovery: name → spec resolution

`globalappsspecifications` is a public, current-state list of every deployed app's spec
(`name`, `compose[].repotag`, or flat `repotag` for the old single-component format), keyed
by app name. A running container's `Names[0]` encodes `/flux<component>_<appName>` (compose
apps) or `/flux<appName>` (legacy flat-spec apps, no component prefix).

Tested against a live sample (1352 unique running container names): **~78% resolve directly**
against `globalappsspecifications` by this split. `permanentmessages` (which `revenueService`
already fetches for historical tx lookups) adds only ~2% more and is a much heavier payload
(~80MB vs ~1.5MB) — not worth pulling into this path. The unresolved ~20% are almost
certainly private/enterprise apps whose specs were never public; they fall into the same
"uncategorized" bucket unclassified images already fall into today, not a new failure mode.

**Resolution rule**, given a stripped container name (leading `/flux` removed):
1. If it matches a known app name exactly → legacy flat spec, use `spec.repotag` directly.
2. Else split at the first `_` into `componentName` + `appName`. If `appName` matches a known
   app whose `compose[]` has a component named `componentName` → use that component's
   `repotag`. (First-`_` split is correct even when `appName` itself contains underscores,
   since `componentName` always comes first in Flux's naming convention.)
3. Else unresolved → the instance still counts toward totals, just not toward any per-image
   bucket (same as an already-uncategorized image today).

This preserves the existing image-string contract everywhere downstream — `categorizeImage()`,
`CATEGORY_EXCLUDE`, `GAMING_REPOS`/`CRYPTO_REPOS` `imageMatch`, `DISPLAY_NAME_OVERRIDES`,
`CANONICAL_NAME_OVERRIDES` in `config.js` — **none of these need to change**. They already
match on a `repotag`-shaped string; we're just changing where that string comes from.

## Changes

### New: `src/lib/services/appSpecsCache.js`
Extracts the `globalappsspecifications`-half of `revenueService`'s private cache into a
shared module (the `permanentmessages`-half stays private to `revenueService` — it's only
needed for historical/undeployed-app tx lookups, not live categorization):
- `ensureGlobalSpecsCache()` — same hourly-TTL refresh `revenueService` already does
- `getAppSpecByName(name)` — full spec object (adds a `specByName` map alongside the
  existing `map`/`typeMap`, since callers now need `compose`/`repotag`, not just type)
- `resolveRunningAppName(containerName)` — the rule above, returns `{ appName, repotag }`
  or `null`
- `determineAppType(appSpec)` stays exported for reuse

`revenueService.js` imports `ensureGlobalSpecsCache`/`getAppSpecByName`/`determineAppType`
from here instead of maintaining its own duplicate `globalSpecsCache`; its
`permanentMessagesCache` and everything else is untouched.

### `runningAppsProvider.js`
- `API_ENDPOINTS.RUNNING_APPS` (in `config.js`): projection changes from
  `apps.runningapps.Image` to `apps.runningapps.Names` — verified live, same payload size
  (~500KB)
- `fetchRunningApps()`: calls `ensureGlobalSpecsCache()` once per fetch cycle, then for each
  running app reads `app.Names?.[0]` instead of `app.Image`, resolves it via
  `resolveRunningAppName()`, and keys `imageCounts` by the resolved `repotag` (falls through
  to counting toward `totalInstances` only when unresolved, same as today's
  empty-string-skip did for total counts — except now totals are correct because resolution
  succeeds for the ~78%+ that have public specs)
- No changes needed to `countByCategory`, `countConfiguredRepos`, `toRepoCounts` — they
  already operate on whatever string keys `imageCounts`

### `cloudService.js`, `gamingService.js`, `cryptoService.js`, `wordpressService.js`
No code changes. All read `runningApps.imageCounts` via `runningAppsProvider.js`; fixing the
provider fixes all four automatically.

### `carouselService.js` (`fetchTopApps`)
Currently does its own separate fetch + `app.Image` parse of the same endpoint (a pre-existing
duplication `runningAppsProvider.js`'s "one fetch per cycle, shared" consolidation didn't
cover). Since this code has to change anyway, refactor it to consume
`getRunningApps()`/`imageCounts` from `runningAppsProvider.js` instead of re-implementing
resolution a second time — removes the duplicate network call and duplicate parsing logic.

### Tests
- `src/lib/services/__tests__/runningAppsProvider.test.js` — fixtures move from
  `{ Image: '...' }` to `{ Names: ['/flux...'] }`, with a mocked spec cache
- New unit tests for `resolveRunningAppName()` covering: legacy flat match, compose
  component match, app names containing underscores, and unresolved → null
- `src/lib/__tests__/categorization.test.js` is unaffected (still tests `categorizeImage()`
  directly on repotag strings)

## Out of scope
- TODO 3 (app-category column on revenue transactions) — unblocked by this fix (repotag data
  was never actually gone) but is a separate follow-on task, not part of this fix
- Backfilling the `repo_snapshots` gap between when the API changed and this fix shipping —
  history stays as-is; new snapshots resume once deployed

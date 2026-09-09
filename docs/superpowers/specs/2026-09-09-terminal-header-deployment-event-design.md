# Design: Terminal header deployment event (issue #104, Phase 1)

## Source spec

GitHub issue #104 ("ASCI enhnacements") is the full spec — a 24-section Phase 1
(deployment animation) + Phase 2 (6-event-type engine) design. This document
scopes that spec to what ships now, and grounds it in the actual code the
issue's own author never saw.

**Scope for this pass: Phase 1 only** — the deployment animation, with a
minimal event abstraction underneath it (a "next pending event" slot, not the
full priority queue). Phase 2's queue/priority/dedup-by-type generalization
across `block | transaction | resource_change | health_change | network_activity`
is future work; this design leaves the seam for it (see "What Phase 2 changes
later" below) but doesn't build it.

## What already exists (and is reused as-is)

`src/lib/utils/terminalAnimation.js` already has every primitive the
deployment animation needs:

- `composeRevealFrame`/`composeRevealKinds` — the wipe-between-two-frames
  primitive already driving boot→logo and all three sync phases
- `padLines`, `LOGO_LINES`, `LOGO_WIDTH`, `BOOT_LINE_COUNT` — the fixed
  6-row/box-width contract every frame must fill
- `ROW_KIND_TEXT`/`ROW_KIND_LOGO` — row styling

`src/lib/components/TerminalHeaderAnimation.svelte` already has the exact
"external prop signals a request, component queues or extends" pattern the
issue asks for — it's just currently hardcoded to one event type (sync).
`state` is `'booting' | 'ready' | 'syncing'`; a `syncRequest = {from, to, id}`
prop change triggers `startSync()`, which chains `runReveal()` calls through
logo → pattern → text → logo, all inside the fixed box, honoring
`reducedMotion`.

`src/lib/components/Header.svelte` already polls `/api/header` every 30s,
computes `shouldTriggerSync()`, and constructs the `syncRequest` object passed
down. This is the file that will also detect new deployments — no new
top-level polling component needed.

`src/lib/services/carouselService.js`'s `fetchLatestDeployedApps()` /
`getCachedDeployedApps()` (used by `GET /api/carousel/deployed`) already
returns exactly the fields the spec's State C–F need, pre-formatted:

```js
{ type: 'deployed', rank, name, repo, details, instances, cpu, ram, hdd,
  isEnterprise, height, blockAge }
```

`repo` is the resolved repotag string (e.g. `2ndtlmining/foo:latest`, or `''`
if unresolvable — same repotag-resolution limitation as issues #106/#109,
already handled upstream by `carouselService`, not this feature's problem).
`height` is the deployment's block height — a natural, stable per-deployment
identity (see Identity below). Server-side caching (`CAROUSEL_CONFIG`,
10 min update / 20 min freshness) already prevents redundant upstream fetches
if the header polls this endpoint independently of `CarouselCard.svelte`.

## What's new

### 1. `terminalAnimation.js` — pure formatters + selection logic (new exports)

- `pickNewDeployment(seenIds, deployedApps)` — pure function. Given the
  client's set of already-shown deployment IDs and the current
  `deployedToday` list (already sorted alphabetically by `carouselService`),
  returns the first entry whose ID isn't in `seenIds`, or `null`. Callers add
  the returned ID to their own `seenIds` set — this function doesn't mutate
  anything, matching the file's existing pure-function character.
- `deploymentId(deployment)` — `` `${deployment.name}:${deployment.height}` ``.
  Block height alone isn't safe (two different apps can deploy in the same
  block); name alone isn't stable (redeployment reuses the name at a new
  height, and *should* replay per the spec's "genuinely new" framing).
- `formatDeploymentIdentityLines()` — static State C frame (`DOCKER` box +
  `NEW DEPLOYMENT`), no dynamic data, so no missing-field handling needed.
- `formatDeploymentAppLines(name, instances)` — State D. Truncates `name` with
  `truncateForBox()`.
- `formatDeploymentRepoLines(repo)` — State E. Returns `null` (caller skips
  this frame entirely) when `repo` is `''` — the spec says show what's real,
  never a placeholder, and skipping a frame is cleaner than a fake "Unknown"
  line for something this codebase already knows is sometimes unresolvable.
- `formatDeploymentResourceLines(cpu, ram, hdd)` — State F. Reuses
  `carouselService`'s existing `formatCpu`/`formatRam`/`formatStorage` unit
  logic (duplicated as pure exports here, or imported — see Task-level
  decision in the plan) so the numbers read identically to the carousel's own
  cards. Omits a row entirely (not "—") when a value is `0`/missing, matching
  section 7's "only show values that actually exist."
- `truncateForBox(text, maxWidth = LOGO_WIDTH - 2)` — deterministic
  truncation (`…` suffix) so a long app/repo name can't overflow the fixed
  box (sections 4 State D/E, 6).

### 2. `Header.svelte` — deployment detection (extends existing polling)

- New state: `seenDeploymentIds` (in-memory `Set`, module-instance-scoped —
  resets on a hard page reload, which is an acceptable Phase 1 trade-off; the
  spec's "bounded size/TTL, not persisted to localStorage without a clear
  reason" is satisfied trivially by not persisting at all), `deploymentQueue`
  (array, capped at 10 — new entries beyond the cap are dropped, matching
  section 8's "queue cannot grow without bound"; a running network doesn't
  need every deployment shown, just that showing one is *real*),
  `deploymentCounter` (mirrors `syncCounter`'s id-bump pattern).
- New poll: reuses `CAROUSEL_CONFIG.updateInterval` (10 min) as its own
  `setInterval`, calling `GET /api/carousel/deployed` — independent of the
  30s `/api/header` poll (deployments don't need 30s freshness, and this
  keeps the two concerns' cadences honest rather than forcing a shared
  interval to serve both).
- On each poll: for every entry in the response not in `seenDeploymentIds`,
  mark it seen and push onto `deploymentQueue` (bounded). If
  `deploymentQueue` has an entry and the animation component isn't currently
  mid-event, shift one off and set `deploymentRequest = {id, ...deployment}`.
- First poll after page load: every currently-deployed-today app would
  otherwise look "new" and queue-storm the animation. Seed
  `seenDeploymentIds` from the *first* response without queuing anything —
  only deployments observed after that count as events, matching section
  4.1's "identify genuinely new records" (new means new-to-this-session, not
  new-to-the-network).

### 3. `TerminalHeaderAnimation.svelte` — the `deploying` state

- New prop `deploymentRequest = null`, watched the same way `syncRequest` is:
  a reactive block on `deploymentRequest.id` changing.
- New state value: `state = 'booting' | 'ready' | 'syncing' | 'deploying'`.
- **The minimal event abstraction**: a `deploymentRequest` that arrives while
  `state !== 'ready'` is not dropped — it's left for `Header.svelte`'s own
  queue (above) to redeliver once the component returns to `'ready'`
  (`Header.svelte` only shifts its queue when the component isn't mid-event,
  so this component never needs to know about queuing itself). A `syncRequest`
  arriving while `state === 'deploying'` behaves like today's "arrives while
  syncing" case for a *second* sync: for Phase 1, sync wins immediately after
  the deployment frame finishes (Header.svelte's own `previousBlockHeight`
  tracking already ensures at most one pending sync target, same as today).
  This priority-free, two-queues-that-don't-collide approach is what "minimal"
  means here — Phase 2's real priority table (`health_change 100 > deployment
  80 > block 60 > ...`) replaces this once more event types exist and can
  genuinely collide.
- `startDeployment(deployment)` — chains `runReveal()` through the states,
  each a full-box frame (`padLines(..., BOOT_LINE_COUNT)`), using the same
  `REVEAL_MS` wipe pace as every other transition in this file:
  1. **B — Transition**: logo → arrow frame (`composeRevealFrame`, top-down)
  2. **C — Identity**: arrow → `formatDeploymentIdentityLines()` (hold)
  3. **D — Application**: → `formatDeploymentAppLines()` (hold)
  4. **E — Repository**: → `formatDeploymentRepoLines()` if non-null, else
     skipped (straight to F)
  5. **F — Resources**: → `formatDeploymentResourceLines()` (hold)
  6. **G — Return**: → `LOGO_LINES` (top-down, same as boot/sync's return)
  Total duration lands in the spec's 5-8s range using hold constants
  analogous to `SYNC_HOLD1_MS`/`SYNC_HOLD2_MS` (new `DEPLOY_HOLD_MS` family,
  same `SYNC_SLOWDOWN`-style tunable-in-one-place convention).
- `reducedMotion`: jumps straight from logo to the State D+F content merged
  into one frame (name, instances, resources — matching section 5's own
  reduced-motion example), holds briefly, returns to logo — no wipes, same
  pattern `startSync()` already uses for its reduced-motion branch.
- Accessibility: the `<pre>` element gains a computed `aria-label` — normally
  absent/generic, and during a deployment event set to something like
  `"New deployment: {name}, {instances} instances"` so screen readers get the
  content without parsing ASCII art (section 15).

## What Phase 2 changes later

Nothing in this design blocks it, but naming it so a future implementer
doesn't have to re-derive it: Phase 2 replaces `Header.svelte`'s bespoke
`deploymentQueue`/`seenDeploymentIds` pair (and the equivalent implicit
single-slot tracking `syncRequest` has today) with one shared
`FluxAsciiEventEngine` module owning a real priority queue across all event
types, and `TerminalHeaderAnimation.svelte`'s `state` values collapse into a
single `'playing:<eventType>'` driven by whatever the engine hands it next,
rather than one `if` branch per event type. The per-event-type *frame
builders* (`startSync`, `startDeployment`, and whatever State-based renderer
each future type gets) stay conceptually the same — Phase 2 is a scheduling
change, not a rendering-primitive change.

## Explicit non-goals (Phase 1)

Everything issue #104 section 22 already excludes, plus: no `block`,
`transaction`, `resource_change`, `health_change`, or `network_activity`
event types (Phase 2), no priority system, no cross-tab/localStorage event
persistence, no interactive/clickable ASCII (section 14 — architecture stays
open to it, nothing is built).

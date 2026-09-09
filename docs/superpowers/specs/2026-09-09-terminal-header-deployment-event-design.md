# Design: Terminal header deployment event (issues #98 + #104 Phase 1)

## Revision 2 — reconciled with issue #98

The first version of this document designed a 5-stage reveal sequence
(identity → app → repo → resources, each its own wipe). Issue #98 — the
original request #104 elaborates on — specifies something more concrete and
simpler: **one combined frame**, icon rows bookending four detail rows, a
single wipe in and a single wipe back to the logo. This revision replaces the
visual-sequence section below with #98's design, confirmed still buildable:
`carouselService`'s `repo` field comes from `globalappsspecifications`, which
was never affected by the v8.18 API change (confirmed repeatedly this
session — closing #38, revenue `app_type`), so `runonflux/orbit` detection
for the whale-vs-octocat distinction #98 asks for is reliable here even
though the general per-instance categorization problem (#106) is not.

## Source spec

GitHub issue #98 ("header deployment animation - ASCII Docker whale / GitHub
octocat showcase") is the primary, concrete spec this design implements —
exact layout, timing budget, detection rules and acceptance criteria. Issue
#104 ("ASCI enhnacements") is the broader Phase 1 + Phase 2 (6-event-type
engine) spec that names #98 as its Phase 1. This document scopes both to
what ships now, and grounds them in the actual code neither issue's author
saw.

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

- `deploymentId(deployment)` — `` `${deployment.name}:${deployment.height}` ``.
  Block height alone isn't safe (two different apps can deploy in the same
  block); name alone isn't stable (redeployment reuses the name at a new
  height, and *should* replay per #98's "genuinely new" framing).
- `pickNewDeployments(seenIds, deployedApps, limit)` — pure. Returns up to
  `limit` entries from `deployedApps` not already in `seenIds`, plus a count
  of how many more were skipped past the limit (`{ picked: [...], overflow: n }`).
  #98 §Detection: "capped (e.g. 3 per cycle) with a final '+N more deployed'
  tick" — this is where that cap and count come from. Callers own updating
  their own `seenIds`.
- `isGitDeployment(repo)` — `repo.toLowerCase().includes('runonflux/orbit')`,
  the exact rule `revenueService.determineAppType()` already uses elsewhere
  in this codebase, applied here to decide whale vs. octocat.
- `truncateForBox(text, maxWidth)` — deterministic `…` truncation so a long
  name/repo can't overflow the fixed box.
- `formatDeploymentFrame(deployment)` — **the single combined frame** #98's
  layout specifies: icon row (whale or octocat, `ROW_KIND_LOGO`) — NAME —
  REPO (omitted, not blank, when `repo` is falsy) — INST (omitted when not a
  real number) — RES (omitted when no resource fields are present) — icon
  row again. Missing detail rows are dropped and the remainder padded at the
  *end* of the middle 4 rows (never a gap between two real rows — matches the
  "sync frames always fill all 6 rows... never an empty row" rule this
  codebase already holds itself to, applied here as "no gaps between rows
  that do have content" for the case where not everything is available).
- `formatDeploymentReducedMotionLines(deployment)` — name + instance count,
  no icon/repo/resources — the reduced-motion equivalent, same pattern
  `formatSyncBlocksLine`-style content already uses elsewhere.

The whale/octocat art itself: single-line (not multi-row — #98 leaves this as
an open question; single-line is what fits its own 6-row layout example
without inventing a taller box) ASCII glyphs built from this codebase's
existing symbol vocabulary (block/line-drawing characters, the same register
`buildSyncPatternLines`'s `PATTERN_CHARS` already uses), each labeled so the
type reads unambiguously even at the header's small font size — exact
glyphs are a Task-level decision, tuned against the extended harness (below),
not fixed in this document.

### 2. `Header.svelte` — deployment detection (on the existing 30s poll)

- New state: `seenDeploymentIds` (in-memory `Set`, resets on a hard reload —
  #98 doesn't ask for persistence), `deploymentQueue` (array), `deploymentCounter`.
- **No new poll** — #98 §Detection says the existing 30s `/api/header` cycle
  also reads `/api/carousel/deployed` each time. That endpoint is already
  cheap (server-side cached by `carouselService`, `CAROUSEL_CONFIG`'s own
  10 min TTL), so polling it every 30s client-side costs nothing upstream —
  it just reads whatever `carouselService` already has cached most of the time.
- Each poll: `pickNewDeployments(seenDeploymentIds, deployedApps, 3)` (cap of
  3, per #98's "e.g. 3 per cycle"). Every picked entry is marked seen and
  queued; if `overflow > 0`, one synthetic `{ overflowCount }` entry is queued
  at the end so the "+N more deployed" tick (#98 §Detection) plays once
  rather than silently dropping the rest.
- First poll after page load seeds `seenDeploymentIds` without queuing
  anything — matches #98 §Detection's "baseline set captured on page load"
  and the acceptance criterion "No animation on page load for pre-existing
  deployments."
- Advance-the-queue logic is unchanged from Revision 1: shift one off only
  when the animation isn't already mid-event, redeliver on `deploymentComplete`.

### 3. `TerminalHeaderAnimation.svelte` — the `deploying` state

- New prop `deploymentRequest = null`, watched the same way `syncRequest` is.
- New state value: `state = 'booting' | 'ready' | 'syncing' | 'deploying'`.
- **The minimal event abstraction** (unchanged from Revision 1): a
  `deploymentRequest` that arrives while not `'ready'` is left for
  `Header.svelte`'s queue to redeliver once `deploymentComplete` fires — this
  component only ever decides "am I ready right now."
- `startDeployment(deployment)` — one wipe in (`runReveal(LOGO_LINES, ...,
  formatDeploymentFrame(deployment), ..., REVEAL_MS)`), a hold, one wipe back
  to `LOGO_LINES`. Total duration lands in #98's ~10s budget (§Timing
  budget: ~0.6s in, ~7-8s hold for readability including the "+N more" tick
  when queued, ~0.6s out, remainder as settle buffer) — a single
  `DEPLOY_HOLD_MS` constant (~8s, `DEPLOY_SLOWDOWN`-tunable like every other
  pacing constant in this file) replaces Revision 1's four separate per-state
  holds, since there's only one frame to hold on now.
- The `overflowCount`-only synthetic entry renders through the same
  `formatDeploymentFrame`-shaped path but with a short, fixed "+N more
  deployed" content instead of NAME/REPO/INST/RES, held briefly (~2s, it's
  a tally, not detail to read) rather than the full hold.
- `reducedMotion`: `formatDeploymentReducedMotionLines()`, no wipes, same
  pattern `startSync()`'s reduced-motion branch already uses.
- Accessibility: `aria-label` on the `<pre>` set to `"New deployment: {name},
  {instances} instances"` during the event, absent otherwise.
- A `syncRequest` arriving while `state === 'deploying'` is handled exactly
  as Revision 1 described: it plays immediately after the deployment frame
  finishes, via the same `activeSyncEnd`/queued-target mechanism `syncRequest`
  already has for two syncs arriving close together.

### Harness extension (issue #98 explicit acceptance criterion)

`scripts/header-smoke/stub-api.mjs` gains a way to inject a "new deployment"
scenario into its `/api/carousel/deployed` response after the harness's
initial baseline load, and `check-header.mjs` gains assertions mirroring the
sync checks it already has: box height never changes, the deployment frame
appears, the correct icon (whale for a docker-repo fixture, octocat for a
`runonflux/orbit` fixture) shows, and the header returns to the logo
afterward. This was deferred as "valuable follow-up, not required" in
Revision 1; #98 lists it as a hard acceptance criterion, so it's in scope now.

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

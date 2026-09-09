# Terminal Header Deployment Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the terminal header's ASCII logo play a short animated sequence (identity → app name → repo → resources → back to logo) whenever a genuinely new app deployment is observed, reusing the header's existing reveal/state-machine primitives — Phase 1 of GitHub issue #104, scoped and grounded in the actual codebase by the accompanying spec.

**Architecture:** `Header.svelte` gains a second, slower poll (reusing `CAROUSEL_CONFIG.updateInterval`) of the already-cached `/api/carousel/deployed` endpoint, diffs it against an in-memory seen-IDs set, and — respecting a small bounded queue and a "not currently playing" gate — hands `TerminalHeaderAnimation.svelte` a `deploymentRequest` prop exactly the way it already hands it `syncRequest` today. `TerminalHeaderAnimation.svelte` gains a `'deploying'` state value and a `startDeployment()` function built from the exact same `runReveal()`/`composeRevealFrame()` primitives `startSync()` already uses. All new formatting logic is pure and lives in `terminalAnimation.js` alongside the existing pure formatters.

**Tech Stack:** Svelte 5, Vitest, existing `terminalAnimation.js` reveal-frame primitives

**Spec:** `docs/superpowers/specs/2026-09-09-terminal-header-deployment-event-design.md` (which scopes GitHub issue #104)

## Global Constraints

- The fixed box never changes size: every new frame array must be exactly `BOOT_LINE_COUNT` rows (use `padLines(..., BOOT_LINE_COUNT)`), never an empty row mid-transition.
- Every wipe between frames uses `runReveal()` (which itself uses `composeRevealFrame`/`composeRevealKinds`) — never a raw assignment that skips the wipe, except in the `reducedMotion` branch, which jumps directly with no wipe at all (matching `startSync`'s existing reduced-motion branch).
- `reducedMotion` must produce a **non-animated equivalent** carrying the same information (name + instance count), never nothing and never the animated version with transitions merely skipped mid-sequence.
- Total animated deployment duration lands in ~5-8s (issue #104 §5), using hold constants declared once each, in the same tunable-in-one-place convention as `BOOT_SLOWDOWN`/`SYNC_SLOWDOWN`.
- Never fabricate data: a missing field (no repo, no instances) means that frame or row is omitted, never a placeholder like `undefined`/`NaN`/`Unknown`.
- Do not introduce a new backend endpoint or duplicate the carousel's own Flux-API fetch — reuse `GET /api/carousel/deployed` (backed by `carouselService.getCachedDeployedApps()`, already cached server-side).
- The same deployment (by `deploymentId()`) must never replay within one browser session.
- No new Svelte component-testing infrastructure — this project has none today (only `terminalAnimation.js`'s pure functions are unit-tested; `TerminalHeaderAnimation.svelte`'s and `Header.svelte`'s existing sync behavior has never had an automated component test either, only the `scripts/header-smoke/` acceptance harness). New pure logic gets Vitest coverage; the two Svelte files are verified by running that harness plus manual/visual smoke, consistent with how `startSync` itself was verified.

---

### Task 1: `terminalAnimation.js` — deployment formatters and selection logic

**Files:**
- Modify: `src/lib/utils/terminalAnimation.js`
- Modify: `src/lib/utils/terminalAnimation.test.js`

**Interfaces:**
- Consumes: `padLines(lines, count)`, `LOGO_WIDTH`, `BOOT_LINE_COUNT` (all already exported by this same file)
- Produces (used by Task 2 and Task 3):
  - `export function deploymentId(deployment: {name: string, height: number}): string`
  - `export function pickNewDeployment(seenIds: Set<string>, deployedApps: Array<{name, height, ...}>): object | null`
  - `export function truncateForBox(text: string, maxWidth?: number): string`
  - `export function formatDeploymentIdentityLines(): string[]` — always `BOOT_LINE_COUNT` rows
  - `export function formatDeploymentAppLines(name: string, instances: number | undefined): string[]` — always `BOOT_LINE_COUNT` rows
  - `export function formatDeploymentRepoLines(repo: string | undefined): string[] | null` — `null` when `repo` is falsy
  - `export function formatDeploymentResourceLines(cpu: number | undefined, ram: number | undefined, hdd: number | undefined): string[]` — always `BOOT_LINE_COUNT` rows
  - `export function formatDeploymentReducedMotionLines(deployment: {name, instances}): string[]` — always `BOOT_LINE_COUNT` rows

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/lib/utils/terminalAnimation.test.js` (extend the existing `import` block at the top of that file to also pull in the new names: `deploymentId, pickNewDeployment, truncateForBox, formatDeploymentIdentityLines, formatDeploymentAppLines, formatDeploymentRepoLines, formatDeploymentResourceLines, formatDeploymentReducedMotionLines`):

```javascript
describe('deploymentId', () => {
  it('combines name and height so a redeploy at a new height counts as new', () => {
    expect(deploymentId({ name: 'Minecraft', height: 1500000 })).toBe('Minecraft:1500000');
  });

  it('two different apps in the same block get different ids', () => {
    const a = deploymentId({ name: 'AppA', height: 1500000 });
    const b = deploymentId({ name: 'AppB', height: 1500000 });
    expect(a).not.toBe(b);
  });
});

describe('pickNewDeployment', () => {
  const apps = [
    { name: 'Alpha', height: 100 },
    { name: 'Beta', height: 200 },
    { name: 'Gamma', height: 300 }
  ];

  it('returns the first entry not already in seenIds', () => {
    const seen = new Set([deploymentId(apps[0])]);
    expect(pickNewDeployment(seen, apps)).toBe(apps[1]);
  });

  it('returns null when every entry has been seen', () => {
    const seen = new Set(apps.map(deploymentId));
    expect(pickNewDeployment(seen, apps)).toBeNull();
  });

  it('returns null for a non-array input rather than throwing', () => {
    expect(pickNewDeployment(new Set(), null)).toBeNull();
    expect(pickNewDeployment(new Set(), undefined)).toBeNull();
  });
});

describe('truncateForBox', () => {
  it('returns short text unchanged', () => {
    expect(truncateForBox('Minecraft')).toBe('Minecraft');
  });

  it('truncates long text with an ellipsis, respecting maxWidth', () => {
    const result = truncateForBox('a-very-long-application-name-that-overflows', 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles non-string input without throwing', () => {
    expect(truncateForBox(undefined)).toBe('');
    expect(truncateForBox(null)).toBe('');
  });
});

describe('formatDeploymentIdentityLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentIdentityLines().length).toBe(BOOT_LINE_COUNT);
  });

  it('mentions DOCKER and NEW DEPLOYMENT', () => {
    const text = formatDeploymentIdentityLines().join('\n');
    expect(text).toContain('DOCKER');
    expect(text).toContain('NEW DEPLOYMENT');
  });
});

describe('formatDeploymentAppLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentAppLines('Minecraft', 3).length).toBe(BOOT_LINE_COUNT);
  });

  it('includes the name and instance count', () => {
    const text = formatDeploymentAppLines('Minecraft', 3).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('3');
  });

  it('omits the instances row rather than showing a fake count when instances is missing', () => {
    const text = formatDeploymentAppLines('Minecraft', undefined).join('\n');
    expect(text).not.toMatch(/INSTANCES\s+undefined/);
    expect(text).not.toContain('NaN');
  });

  it('truncates a long name instead of overflowing the box', () => {
    const longName = 'a'.repeat(200);
    const lines = formatDeploymentAppLines(longName, 1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH + 4); // small prefix indent allowance
    }
  });
});

describe('formatDeploymentRepoLines', () => {
  it('is BOOT_LINE_COUNT rows when repo is present', () => {
    const lines = formatDeploymentRepoLines('2ndtlmining/foo:latest');
    expect(lines.length).toBe(BOOT_LINE_COUNT);
    expect(lines.join('\n')).toContain('2ndtlmining/foo:latest');
  });

  it('returns null when repo is empty or missing, so the caller can skip the frame', () => {
    expect(formatDeploymentRepoLines('')).toBeNull();
    expect(formatDeploymentRepoLines(undefined)).toBeNull();
  });

  it('truncates a long repo name instead of overflowing the box', () => {
    const longRepo = '2ndtlmining/' + 'a'.repeat(200) + ':latest';
    const lines = formatDeploymentRepoLines(longRepo);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH + 4);
    }
  });
});

describe('formatDeploymentResourceLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentResourceLines(2, 4096, 25).length).toBe(BOOT_LINE_COUNT);
  });

  it('includes CPU, RAM and HDD rows when all three are present', () => {
    const text = formatDeploymentResourceLines(2, 4096, 25).join('\n');
    expect(text).toContain('CPU');
    expect(text).toContain('RAM');
    expect(text).toContain('HDD');
  });

  it('omits a row entirely for a missing value rather than showing undefined/NaN', () => {
    const text = formatDeploymentResourceLines(2, 0, undefined).join('\n');
    expect(text).toContain('CPU');
    expect(text).not.toContain('RAM');
    expect(text).not.toContain('HDD');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('formats RAM in GB once it crosses 1000 MB', () => {
    expect(formatDeploymentResourceLines(1, 4096, 10).join('\n')).toContain('4.1G');
    expect(formatDeploymentResourceLines(1, 512, 10).join('\n')).toContain('512M');
  });
});

describe('formatDeploymentReducedMotionLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).length).toBe(BOOT_LINE_COUNT);
  });

  it('carries the name and instance count with no animation-only content', () => {
    const text = formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('3');
    expect(text).toContain('NEW DEPLOYMENT');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/utils/terminalAnimation.test.js`
Expected: FAIL — every new `describe` block errors with something like "deploymentId is not a function" (the imports don't exist yet)

- [ ] **Step 3: Write the implementation**

Append to the end of `src/lib/utils/terminalAnimation.js`:

```javascript

// ============================================
// DEPLOYMENT EVENT (issue #104 Phase 1)
// ============================================
//
// The identity, application, repository and resources frames a deployment
// event wipes through, all built from the same padLines/BOOT_LINE_COUNT
// contract every other frame in this file already fills. Selection
// (pickNewDeployment) and identity (deploymentId) are pure so Header.svelte's
// polling logic stays simple and this logic stays testable in isolation.

/**
 * Deployment identity: name + block height. Height alone isn't safe (two
 * different apps can land in the same block); name alone isn't stable (a
 * redeploy reuses the name at a new height, and *should* replay).
 */
export function deploymentId(deployment) {
  return `${deployment.name}:${deployment.height}`;
}

/**
 * First deployment in `deployedApps` not already in `seenIds`, or null.
 * Pure — callers own updating their own seenIds set with the returned id.
 */
export function pickNewDeployment(seenIds, deployedApps) {
  if (!Array.isArray(deployedApps)) return null;
  for (const deployment of deployedApps) {
    if (!seenIds.has(deploymentId(deployment))) return deployment;
  }
  return null;
}

/** Deterministic truncation so a name/repo can't overflow the fixed box. */
export function truncateForBox(text, maxWidth = LOGO_WIDTH - 2) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxWidth) return text;
  return text.slice(0, Math.max(0, maxWidth - 1)) + '…';
}

/** State C — static identity frame, no dynamic data. */
export function formatDeploymentIdentityLines() {
  return padLines([
    '',
    '   ┌─────────┐',
    '   │ DOCKER  │',
    '   └─────────┘',
    '',
    '  NEW DEPLOYMENT'
  ], BOOT_LINE_COUNT);
}

/** State D — application name + instance count (omitted when not a real number). */
export function formatDeploymentAppLines(name, instances) {
  const label = truncateForBox(name || 'unknown');
  const count = Number.isFinite(instances) ? instances : null;
  const lines = [
    '',
    '   DEPLOYMENT',
    '',
    `   ${label}`,
    '   ' + '─'.repeat(Math.max(1, Math.min(label.length, LOGO_WIDTH - 4)))
  ];
  if (count !== null) lines.push(`   INSTANCES  ${count}`);
  return padLines(lines, BOOT_LINE_COUNT);
}

/** State E — repository. Returns null (caller skips this frame) when repo is falsy. */
export function formatDeploymentRepoLines(repo) {
  if (!repo) return null;
  return padLines([
    '',
    '   REPOSITORY',
    '',
    `   ${truncateForBox(repo)}`
  ], BOOT_LINE_COUNT);
}

/** State F — resources. Omits a row entirely for a missing/zero value, never a fake one. */
export function formatDeploymentResourceLines(cpu, ram, hdd) {
  const rows = [];
  if (cpu) rows.push(`   CPU   ${cpu}`);
  if (ram) rows.push(`   RAM   ${ram >= 1000 ? (ram / 1000).toFixed(1) + 'G' : ram + 'M'}`);
  if (hdd) rows.push(`   HDD   ${hdd >= 1000 ? (hdd / 1000).toFixed(1) + 'T' : hdd + 'G'}`);
  return padLines(['', '   RESOURCES', '', ...rows], BOOT_LINE_COUNT);
}

/**
 * Reduced-motion equivalent: name + instance count with no animation-only
 * content (no DOCKER box, no repo, no resources — those exist to fill an
 * animated sequence, not to carry information a static reader needs).
 */
export function formatDeploymentReducedMotionLines(deployment) {
  const label = truncateForBox(deployment?.name || 'unknown');
  const count = Number.isFinite(deployment?.instances) ? deployment.instances : null;
  return padLines([
    '  NEW DEPLOYMENT',
    '',
    `  ${label}`,
    count !== null ? `  ${count} ${count === 1 ? 'INSTANCE' : 'INSTANCES'}` : ''
  ], BOOT_LINE_COUNT);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/utils/terminalAnimation.test.js`
Expected: PASS (all tests green, including the pre-existing ones — this is an append-only change)

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/terminalAnimation.js src/lib/utils/terminalAnimation.test.js
git commit -m "feat: pure deployment-event formatters and selection logic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 2: `TerminalHeaderAnimation.svelte` — the `deploying` state

**Files:**
- Modify: `src/lib/components/TerminalHeaderAnimation.svelte`

**Interfaces:**
- Consumes: all seven exports Task 1 added to `terminalAnimation.js`, plus the file's own existing `runReveal`, `padLines`, `LOGO_LINES`, `textKinds()`, `logoKinds()`, `schedule()`
- Produces (used by Task 3):
  - New prop: `export let deploymentRequest = null;` — shape `{ id: number, name, repo, instances, cpu, ram, hdd, height, ... }` (a `deployment` object from `carouselService`, plus an `id` field wrapping it, exactly mirroring how `syncRequest` wraps `{from, to}` with an `id`)
  - New dispatched event: `deploymentComplete` (no payload) — fired once the component returns to `'ready'` after playing a deployment, on both the animated and reduced-motion paths

- [ ] **Step 1: Update the imports**

In `src/lib/components/TerminalHeaderAnimation.svelte`, change:

```javascript
  import {
    LOGO_LINES,
    LOGO_WIDTH,
    BOOT_LINE_COUNT,
    ROW_KIND_TEXT,
    ROW_KIND_LOGO,
    pickBootStartBlock,
    computeAnimatedBlock,
    mergeSyncTarget,
    formatStatusLine,
    formatSnapshotLine,
    formatSummaryLine,
    buildSyncPatternLines,
    pickPatternChars,
    padLines,
    composeRevealFrame,
    composeRevealKinds,
    formatSyncBlocksLine,
    formatTransactionsLine,
    formatNetworkLine
  } from '$lib/utils/terminalAnimation.js';
```

to:

```javascript
  import {
    LOGO_LINES,
    LOGO_WIDTH,
    BOOT_LINE_COUNT,
    ROW_KIND_TEXT,
    ROW_KIND_LOGO,
    pickBootStartBlock,
    computeAnimatedBlock,
    mergeSyncTarget,
    formatStatusLine,
    formatSnapshotLine,
    formatSummaryLine,
    buildSyncPatternLines,
    pickPatternChars,
    padLines,
    composeRevealFrame,
    composeRevealKinds,
    formatSyncBlocksLine,
    formatTransactionsLine,
    formatNetworkLine,
    formatDeploymentIdentityLines,
    formatDeploymentAppLines,
    formatDeploymentRepoLines,
    formatDeploymentResourceLines,
    formatDeploymentReducedMotionLines
  } from '$lib/utils/terminalAnimation.js';
```

- [ ] **Step 2: Add the new prop and state**

Change:

```javascript
  export let dataReady = false;
  export let syncRequest = null;
```

to:

```javascript
  export let dataReady = false;
  export let syncRequest = null;
  export let deploymentRequest = null;
```

Change:

```javascript
  let lastHandledSyncId = null;
  let activeSyncEnd = null;
```

to:

```javascript
  let lastHandledSyncId = null;
  let activeSyncEnd = null;
  let lastHandledDeploymentId = null;
  let deploymentAriaLabel = '';
```

- [ ] **Step 3: Add the deployment timing constants**

Change:

```javascript
  const SYNC_PHASE3_MS = REVEAL_MS;           // text -> logo, reveals top-down — same pace as boot
```

to:

```javascript
  const SYNC_PHASE3_MS = REVEAL_MS;           // text -> logo, reveals top-down — same pace as boot

  // Deployment event (issue #104 Phase 1) — same REVEAL_MS wipe pace as every other
  // transition in this file; hold durations chosen so the whole sequence lands in the
  // spec's ~5-8s range: 5 wipes at 400ms (2.0s) + 4 holds below (3.4s at SLOWDOWN=1,
  // ~5.4s including the SYNC_SLOWDOWN-style doubling used everywhere else in this file).
  const DEPLOY_SLOWDOWN = 2;
  const DEPLOY_TRANSITION_MS = REVEAL_MS;
  const DEPLOY_HOLD_IDENTITY_MS = 500 * DEPLOY_SLOWDOWN;
  const DEPLOY_HOLD_APP_MS = 550 * DEPLOY_SLOWDOWN;
  const DEPLOY_HOLD_REPO_MS = 500 * DEPLOY_SLOWDOWN;
  const DEPLOY_HOLD_RESOURCES_MS = 550 * DEPLOY_SLOWDOWN;
```

- [ ] **Step 4: Update `state`'s documented type and add `startDeployment`**

Change:

```javascript
  let state = 'booting'; // 'booting' | 'ready' | 'syncing'
```

to:

```javascript
  let state = 'booting'; // 'booting' | 'ready' | 'syncing' | 'deploying'
```

Add this new function immediately after `startSync()`'s closing brace (i.e. directly before the `$: if (syncRequest ...)` reactive block):

```javascript
  /**
   * Deployment event: logo -> identity -> application -> repository (if known) ->
   * resources -> logo, each a full-box frame wiped in with runReveal() at the shared
   * REVEAL_MS pace, exactly like startSync()'s phases. The repository frame is skipped
   * entirely (not shown as blank/unknown) when the app's repotag didn't resolve —
   * carouselService already returns '' for that case (same limitation as issues
   * #106/#109), and this component doesn't invent data to fill the gap.
   */
  function startDeployment(deployment) {
    state = 'deploying';
    const instances = Number.isFinite(deployment.instances) ? deployment.instances : 0;
    deploymentAriaLabel = `New deployment: ${deployment.name}, ${instances} ${instances === 1 ? 'instance' : 'instances'}`;

    const finish = () => {
      state = 'ready';
      deploymentAriaLabel = '';
      dispatch('deploymentComplete');
    };

    if (reducedMotion) {
      frameLines = formatDeploymentReducedMotionLines(deployment);
      frameKinds = textKinds();
      schedule(() => {
        frameLines = LOGO_LINES;
        frameKinds = logoKinds();
        finish();
      }, 30);
      return;
    }

    const identityLines = formatDeploymentIdentityLines();
    const appLines = formatDeploymentAppLines(deployment.name, deployment.instances);
    const repoLines = formatDeploymentRepoLines(deployment.repo);
    const resourceLines = formatDeploymentResourceLines(deployment.cpu, deployment.ram, deployment.hdd);

    const toResourcesThenLogo = (fromLines) => {
      runReveal(fromLines, textKinds(), resourceLines, textKinds(), 'top-down', DEPLOY_TRANSITION_MS, () => {
        frameLines = resourceLines;
        frameKinds = textKinds();
        schedule(() => {
          runReveal(frameLines, textKinds(), LOGO_LINES, logoKinds(), 'top-down', DEPLOY_TRANSITION_MS, () => {
            frameLines = LOGO_LINES;
            frameKinds = logoKinds();
            finish();
          });
        }, DEPLOY_HOLD_RESOURCES_MS);
      });
    };

    runReveal(LOGO_LINES, logoKinds(), identityLines, textKinds(), 'top-down', DEPLOY_TRANSITION_MS, () => {
      frameLines = identityLines;
      frameKinds = textKinds();
      schedule(() => {
        runReveal(identityLines, textKinds(), appLines, textKinds(), 'top-down', DEPLOY_TRANSITION_MS, () => {
          frameLines = appLines;
          frameKinds = textKinds();
          schedule(() => {
            if (repoLines) {
              runReveal(appLines, textKinds(), repoLines, textKinds(), 'top-down', DEPLOY_TRANSITION_MS, () => {
                frameLines = repoLines;
                frameKinds = textKinds();
                schedule(() => toResourcesThenLogo(frameLines), DEPLOY_HOLD_REPO_MS);
              });
            } else {
              toResourcesThenLogo(appLines);
            }
          }, DEPLOY_HOLD_APP_MS);
        });
      }, DEPLOY_HOLD_IDENTITY_MS);
    });
  }
```

- [ ] **Step 5: Add the `deploymentRequest` reactive trigger**

Change:

```javascript
  $: if (syncRequest && syncRequest.id !== lastHandledSyncId) {
    lastHandledSyncId = syncRequest.id;
    if (state === 'syncing') {
      activeSyncEnd = mergeSyncTarget(activeSyncEnd, syncRequest.to);
    } else if (state === 'ready') {
      startSync(syncRequest.from, syncRequest.to);
    }
  }
```

to:

```javascript
  $: if (syncRequest && syncRequest.id !== lastHandledSyncId) {
    lastHandledSyncId = syncRequest.id;
    if (state === 'syncing') {
      activeSyncEnd = mergeSyncTarget(activeSyncEnd, syncRequest.to);
    } else if (state === 'ready') {
      startSync(syncRequest.from, syncRequest.to);
    }
  }

  // Header.svelte owns the deployment queue and only sends a new deploymentRequest
  // once this component isn't mid-event (see the design spec's "minimal event
  // abstraction" section) — so the only real decision here is "am I ready right now."
  // A request that arrives while not ready is simply not started; Header.svelte
  // redelivers it (or the next queued one) once `deploymentComplete` fires.
  $: if (deploymentRequest && deploymentRequest.id !== lastHandledDeploymentId) {
    lastHandledDeploymentId = deploymentRequest.id;
    if (state === 'ready') {
      startDeployment(deploymentRequest);
    }
  }
```

- [ ] **Step 6: Wire the aria-label onto the box**

Change:

```svelte
<pre
  class="terminal-box"
  class:settled={logoSettled}
  style="--box-rows: {BOOT_LINE_COUNT};"
>{#each frameLines as line, i}<span class="row-{frameKinds[i]}">{line + '\n'}</span>{/each}</pre>
```

to:

```svelte
<pre
  class="terminal-box"
  class:settled={logoSettled}
  style="--box-rows: {BOOT_LINE_COUNT};"
  aria-label={deploymentAriaLabel || 'Flux network status'}
>{#each frameLines as line, i}<span class="row-{frameKinds[i]}">{line + '\n'}</span>{/each}</pre>
```

- [ ] **Step 7: Manual verification (no component-test infra exists for this file)**

Run the existing pure-logic suite to confirm the file still imports/compiles cleanly:

Run: `npx vitest run src/lib/utils/terminalAnimation.test.js`
Expected: PASS (unchanged from Task 1 — this step just confirms Task 2 didn't break the import graph)

Run a production build to catch any Svelte compile error in the new markup/script:

Run: `npm run build`
Expected: build succeeds with no new errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/TerminalHeaderAnimation.svelte
git commit -m "feat: add deploying state to TerminalHeaderAnimation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 3: `Header.svelte` — deployment detection, queue and wiring

**Files:**
- Modify: `src/lib/components/Header.svelte`

**Interfaces:**
- Consumes: `deploymentId`, `pickNewDeployment` (from Task 1); the `deploymentRequest` prop and `deploymentComplete` event (from Task 2); `CAROUSEL_CONFIG` (existing export of `src/lib/config.js`); `GET /api/carousel/deployed` (existing endpoint, response shape `{ stats: Array<{name, repo, instances, cpu, ram, hdd, height, ...}>, cached, cacheAge, fresh }`, same shape `CarouselCard.svelte` already consumes)
- Produces: nothing new consumed elsewhere — this task is the top of the wiring chain

- [ ] **Step 1: Import what's needed**

Change:

```javascript
  import { getApiUrl } from '$lib/config.js';
  import TerminalHeaderAnimation from '$lib/components/TerminalHeaderAnimation.svelte';
  import { shouldTriggerSync } from '$lib/utils/terminalAnimation.js';
```

to:

```javascript
  import { getApiUrl, CAROUSEL_CONFIG } from '$lib/config.js';
  import TerminalHeaderAnimation from '$lib/components/TerminalHeaderAnimation.svelte';
  import { shouldTriggerSync, deploymentId, pickNewDeployment } from '$lib/utils/terminalAnimation.js';
```

- [ ] **Step 2: Add deployment-tracking state**

Change:

```javascript
  // Terminal boot/sync animation tracking
  let dataReady = false;
  let bootComplete = false;
  let previousBlockHeight = null;
  let syncRequest = null;
  let syncCounter = 0;

  let interval;
```

to:

```javascript
  // Terminal boot/sync animation tracking
  let dataReady = false;
  let bootComplete = false;
  let previousBlockHeight = null;
  let syncRequest = null;
  let syncCounter = 0;

  // Deployment event tracking (issue #104 Phase 1) — a small bounded queue plus a
  // "currently playing" gate, not a real priority engine (see the design spec's
  // "minimal event abstraction" section for what Phase 2 would replace this with).
  const MAX_DEPLOYMENT_QUEUE = 10;
  let seenDeploymentIds = new Set();
  let deploymentsSeeded = false;   // first poll only seeds seenIds, never queues
  let deploymentQueue = [];
  let deploymentRequest = null;
  let deploymentCounter = 0;
  let deploymentAnimationBusy = false;

  let interval;
  let deploymentPollInterval;
```

- [ ] **Step 3: Start and stop the deployment poll**

Change:

```javascript
  onMount(async () => {
    API_URL = getApiUrl();
    await fetchHeaderData();
    interval = setInterval(fetchHeaderData, 30000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });
```

to:

```javascript
  onMount(async () => {
    API_URL = getApiUrl();
    await fetchHeaderData();
    interval = setInterval(fetchHeaderData, 30000);

    await pollDeployments();
    deploymentPollInterval = setInterval(pollDeployments, CAROUSEL_CONFIG.updateInterval);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
    if (deploymentPollInterval) clearInterval(deploymentPollInterval);
  });
```

- [ ] **Step 4: Add the poll and queue-advance functions**

Add these two new functions immediately after `fetchHeaderData()`'s closing brace (i.e. directly before `function handleBootComplete() {`):

```javascript
  /**
   * Poll the already-cached deployed-apps endpoint (carouselService caches it
   * server-side on CAROUSEL_CONFIG's own interval, so this client poll never causes
   * an extra upstream Flux API call). The first poll after page load only seeds
   * seenDeploymentIds — everything already deployed today is "new to this session"
   * but not a genuinely new event, matching issue #104 §4.1.
   */
  async function pollDeployments() {
    try {
      const response = await fetch(`${API_URL}/api/carousel/deployed`);
      const data = await response.json();
      const deployedApps = data?.stats || [];

      if (!deploymentsSeeded) {
        for (const app of deployedApps) seenDeploymentIds.add(deploymentId(app));
        deploymentsSeeded = true;
        return;
      }

      let next = pickNewDeployment(seenDeploymentIds, deployedApps);
      while (next) {
        seenDeploymentIds.add(deploymentId(next));
        if (deploymentQueue.length < MAX_DEPLOYMENT_QUEUE) {
          deploymentQueue = [...deploymentQueue, next];
        }
        // pickNewDeployment only looks at seenDeploymentIds, which we just grew —
        // re-running it walks past the entry we just queued to find the next new one.
        next = pickNewDeployment(seenDeploymentIds, deployedApps);
      }

      advanceDeploymentQueue();
    } catch (error) {
      console.error('Error polling deployed apps for header animation:', error);
    }
  }

  /** Issue the next queued deployment as a request, only when nothing is currently playing. */
  function advanceDeploymentQueue() {
    if (deploymentAnimationBusy || deploymentQueue.length === 0) return;
    const [next, ...rest] = deploymentQueue;
    deploymentQueue = rest;
    deploymentCounter += 1;
    deploymentRequest = { id: deploymentCounter, ...next };
    deploymentAnimationBusy = true;
  }

  function handleDeploymentComplete() {
    deploymentAnimationBusy = false;
    advanceDeploymentQueue();
  }
```

- [ ] **Step 5: Wire the new prop and event onto `<TerminalHeaderAnimation>`**

Find the existing `<TerminalHeaderAnimation ... {syncRequest} ... />` usage (around where `{blockHeight}` and `{syncRequest}` are already passed) and add the two new bindings alongside the existing ones:

```svelte
      <TerminalHeaderAnimation
        {blockHeight}
```

to:

```svelte
      <TerminalHeaderAnimation
        {blockHeight}
        {deploymentRequest}
        on:deploymentComplete={handleDeploymentComplete}
```

(Leave every other existing prop on that element exactly as it is — this only adds two new bindings to the existing tag, on the same lines the other props already occupy.)

- [ ] **Step 6: Manual verification**

Run: `npx vitest run` (full suite — confirms nothing else broke)
Expected: PASS, same count as before this task plus Task 1's new tests

Run: `npm run build`
Expected: build succeeds with no new errors

Run the header-smoke acceptance harness (per `CLAUDE.md`: "run it before and after any header change") to confirm the **existing** boot/sync behavior has no regression — box height, 6-row fill, timing, colors:

```bash
npm install --no-save puppeteer-core
node scripts/header-smoke/stub-api.mjs &
VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --port 5199 &
node scripts/header-smoke/check-header.mjs
```

Expected: exits 0, all existing assertions pass (this harness doesn't yet assert anything about deployment frames — extending `stub-api.mjs`/`check-header.mjs` with deployment-specific assertions is valuable follow-up work, not required for this plan, since it's the only automated surface covering `TerminalHeaderAnimation.svelte`'s and `Header.svelte`'s actual runtime behavior)

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/Header.svelte
git commit -m "feat: detect and queue new deployments for the header animation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 4: Full verification

**Files:** none (verification only)

**Interfaces:** none — confirms Tasks 1-3 integrate cleanly.

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: every suite green, including `terminalAnimation.test.js`'s new deployment-formatter tests

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: build completes with no errors

- [ ] **Step 3: Manual smoke test with a real (or stubbed) deployment**

Since there's no automated component-test infra for the Svelte files, do one manual pass: run `npm run dev:all` against a real backend (or temporarily point `stub-api.mjs`-style fixture data through `/api/carousel/deployed` with a `height` newer than what's already been "seen") and confirm in a browser:

- The deployment sequence plays once, wipes through all its states, returns to the logo
- The header's box height never changes during the sequence
- No row is ever empty mid-wipe
- With OS-level "reduce motion" enabled, the sequence jumps directly to name+instances and back, no wipes
- The same deployment does not replay on a subsequent poll

- [ ] **Step 4: Commit (only if Steps 1-3 required any fix-up)**

If everything passed cleanly, skip this step. Otherwise:

```bash
git add -A
git commit -m "fix: address integration issue found in full-suite verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

# Terminal Header Boot/Sync Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header's static `FLUX / TRACKER` title with a terminal boot sequence (real `/api/header` data) that resolves into a persistent ASCII `FLUX` logo, plus a short "sync" animation when a new block is detected after boot — on both desktop and mobile, matching the existing terminal/cyan theme.

**Architecture:** Pure, unit-tested logic (block-counter easing, sync-trigger guard, overlap merging, line formatting) lives in a plain JS module. A new `TerminalHeaderAnimation.svelte` component owns all rendering/timers and is driven entirely by props — it never fetches data itself. `Header.svelte` keeps its existing fetch/poll loop, decides *when* a sync happened (using the pure guard function) and hands the new component a `syncRequest` object; the child only renders. One small `server.js` change adds a real `dbStatus` field to `/api/header` so the boot sequence's database line is truthful instead of duplicating the API line.

**Tech Stack:** SvelteKit (Svelte 5, legacy `let`/`onMount` style — no runes, matching the file being modified), plain CSS (`@keyframes` + class toggling, matching existing patterns — no `svelte/transition`), Vitest for the pure-logic unit tests (`environment: 'node'`, no component-testing harness exists in this repo, so components are verified manually via `npm run dev:all` + browser at desktop and mobile widths).

**Spec:** `FluxTracker_Header_Terminal_Animation_Spec.md` (repo root) and GitHub issue https://github.com/2ndtlmining/Fluxtracker/issues/77 (spec + feasibility notes already verified against this codebase).

## Global Constraints

- Boot sequence total duration ≈ 2.5–3.0s max; sync animation ≈ 0.7–1.2s. Neither may exceed ~3s / ~1.2s respectively.
- Never make a network/API request per animated block. The counter is `requestAnimationFrame`-driven interpolation only, always landing exactly on the real target, never overshooting.
- Never show a value the API didn't provide (no `network 0 nodes` from Svelte defaults before the first fetch resolves).
- Final persistent state shows `FLUX` ASCII art only — no `TRACKER` text anywhere in the resolved state.
- Respect `prefers-reduced-motion: reduce`: skip the animated counter/distortion, boot resolves near-instantly, sync is near-instant.
- `/api/header` failure or a >4s stall must fall through to a normal/fallback header — never trap the user in the boot sequence.
- Use existing theme variables only (`--text-primary`, `--glow-cyan`, `--bg-header`, `--text-muted`, etc. from `src/app.css`) — no new palette. Note: `--text-cyan` does **not** exist as a variable (only a `.text-cyan` class alias for `--text-primary`) — use `--text-primary` directly.
- No new animation dependency, no `svelte/transition`/`svelte/motion` — match the codebase's existing plain-CSS-`@keyframes` pattern (see `.status-dot` pulse in `Header.svelte`).
- All timers / `requestAnimationFrame` loops must be cancelled in `onDestroy`. No overlapping sync animations — merge targets instead.
- Files touched: `src/lib/components/Header.svelte`, new `src/lib/components/TerminalHeaderAnimation.svelte`, new `src/lib/utils/terminalAnimation.js` (+ its test file), `src/server.js`. Nothing else unless a real blocker surfaces.

---

## Setup

- [ ] **Step 1: Create the feature branch off `main`**

```bash
git fetch origin main
git checkout -b feature/terminal-header-animation origin/main
```

---

### Task 1: Truthful DB status in `/api/header`

**Files:**
- Modify: `src/server.js:322-391` (the `/api/header` handler)
- Verify manually: no automated route test harness exists in this repo (no supertest); verify with `curl` against the running dev API.

**Interfaces:**
- Produces: `/api/header` JSON response gains a top-level `dbStatus: 'online' | 'offline'` field, computed from the same `probeDb()` used by `/api/health` (imported already at `src/server.js:38`).

- [ ] **Step 1: Add `probeDb()` to the handler's parallel fetch and surface it on the response**

In `src/server.js`, inside the `/api/header` handler (`app.get('/api/header', ...)`), add `probeDb()` to the existing `Promise.all` and return its result as `dbStatus`:

```js
app.get('/api/header', async (req, res) => {
    return withDbFallback(headerCache, 'header', res, async () => {
        const [metrics, stats, lastSnapshots, syncStatus, txCount, snapshotStatus, dbReachable] = await Promise.all([
            getCurrentMetrics(),
            getDatabaseStats(),
            getLastNSnapshots(1),
            getSyncStatus('revenue'),
            getTxidCount(),
            getSnapshotSystemStatus(),
            probeDb()
        ]);

        // ... existing blockHeight/arcaneOsCodename/hostLocation code unchanged ...

        return {
            network: { /* unchanged */ },
            tracker: { /* unchanged */ },
            host: { /* unchanged */ },
            appVersion: APP_VERSION,
            dbStatus: dbReachable ? 'online' : 'offline'
        };
    });
});
```

Keep every other field in the returned object exactly as it is today — this only adds the one new top-level key.

- [ ] **Step 2: Manually verify the new field**

Start the API (`npm run api`) and check:

```bash
curl -s http://localhost:37000/api/header | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).dbStatus))"
```

Expected: prints `online` while Supabase/SQLite is reachable. (Optional: temporarily point `SUPABASE_URL` at a bad host to confirm it flips to `offline`, then revert.)

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: add truthful dbStatus field to /api/header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013rgcx236QH4KcrgiGXLCRu"
```

---

### Task 2: Pure animation/formatting logic module (TDD)

**Files:**
- Create: `src/lib/utils/terminalAnimation.js`
- Create: `src/lib/utils/terminalAnimation.test.js`

**Interfaces:**
- Produces (consumed by Task 3's component and Task 4's `Header.svelte` changes):
  - `FLUX_LOGO` — string constant, the ASCII art block.
  - `pickBootStartBlock(targetBlock: number, range = 1100): number | null`
  - `computeAnimatedBlock(startBlock: number, targetBlock: number, progress: number): number`
  - `shouldTriggerSync({ previousBlockHeight, newBlockHeight, bootComplete }): boolean`
  - `mergeSyncTarget(currentTarget: number, newBlockHeight: number): number`
  - `formatNetworkLine(totalNodes: number, totalApps: number): string`
  - `formatVersionLine(appVersion: string, codename: string): string`
  - `buildSyncBlockLines(previousBlockHeight: number, newBlockHeight: number): string[]`

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/utils/terminalAnimation.test.js
import { describe, it, expect } from 'vitest';
import {
  pickBootStartBlock,
  computeAnimatedBlock,
  shouldTriggerSync,
  mergeSyncTarget,
  formatNetworkLine,
  formatVersionLine,
  buildSyncBlockLines,
  FLUX_LOGO
} from './terminalAnimation.js';

describe('FLUX_LOGO', () => {
  it('is a non-empty multi-line string with no TRACKER text', () => {
    expect(FLUX_LOGO.length).toBeGreaterThan(0);
    expect(FLUX_LOGO.toUpperCase()).not.toContain('TRACKER');
    expect(FLUX_LOGO.split('\n').length).toBeGreaterThanOrEqual(4);
  });
});

describe('pickBootStartBlock', () => {
  it('picks a start block `range` below the target', () => {
    expect(pickBootStartBlock(294912, 1100)).toBe(293812);
  });

  it('never goes below zero', () => {
    expect(pickBootStartBlock(500, 1100)).toBe(0);
  });

  it('returns null for a non-numeric target', () => {
    expect(pickBootStartBlock(null)).toBeNull();
    expect(pickBootStartBlock(undefined)).toBeNull();
  });
});

describe('computeAnimatedBlock', () => {
  it('returns exactly startBlock at progress 0', () => {
    expect(computeAnimatedBlock(100, 200, 0)).toBe(100);
  });

  it('returns exactly targetBlock at progress 1', () => {
    expect(computeAnimatedBlock(100, 200, 1)).toBe(200);
  });

  it('never overshoots the target before progress reaches 1', () => {
    for (let p = 0; p < 1; p += 0.05) {
      expect(computeAnimatedBlock(100, 200, p)).toBeLessThan(200);
    }
  });

  it('is monotonically non-decreasing as progress increases', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.05) {
      const value = computeAnimatedBlock(1000, 5000, p);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('clamps progress outside [0, 1]', () => {
    expect(computeAnimatedBlock(100, 200, -0.5)).toBe(100);
    expect(computeAnimatedBlock(100, 200, 1.5)).toBe(200);
  });

  it('returns target immediately when target <= start', () => {
    expect(computeAnimatedBlock(500, 500, 0.5)).toBe(500);
    expect(computeAnimatedBlock(500, 400, 0.5)).toBe(400);
  });
});

describe('shouldTriggerSync', () => {
  it('is false while boot is not complete, even if the height increased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 105, bootComplete: false })).toBe(false);
  });

  it('is false on the very first data point (no previous height yet)', () => {
    expect(shouldTriggerSync({ previousBlockHeight: null, newBlockHeight: 105, bootComplete: true })).toBe(false);
  });

  it('is true after boot when the height increased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 105, bootComplete: true })).toBe(true);
  });

  it('is false after boot when the height is unchanged or decreased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 100, bootComplete: true })).toBe(false);
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 99, bootComplete: true })).toBe(false);
  });
});

describe('mergeSyncTarget', () => {
  it('keeps the higher of the two block heights', () => {
    expect(mergeSyncTarget(294915, 294918)).toBe(294918);
    expect(mergeSyncTarget(294920, 294918)).toBe(294920);
  });
});

describe('formatNetworkLine', () => {
  it('formats nodes and apps with thousands separators', () => {
    expect(formatNetworkLine(12481, 3842)).toBe('network 12,481 nodes | apps 3,842');
  });

  it('falls back to "..." for missing values', () => {
    expect(formatNetworkLine(null, undefined)).toBe('network ... nodes | apps ...');
  });
});

describe('formatVersionLine', () => {
  it('includes the codename when present', () => {
    expect(formatVersionLine('v1.03', 'jolly wombat')).toBe('version v1.03 jolly wombat loaded');
  });

  it('omits the codename when absent', () => {
    expect(formatVersionLine('v1.03', '')).toBe('version v1.03 loaded');
  });
});

describe('buildSyncBlockLines', () => {
  it('lists each new block individually when there are few', () => {
    expect(buildSyncBlockLines(294912, 294915)).toEqual([
      'loading new blocks 294913',
      'loading new blocks 294914',
      'loading new blocks 294915'
    ]);
  });

  it('condenses to a range when there are many new blocks', () => {
    expect(buildSyncBlockLines(294912, 295000)).toEqual(['loading new blocks 294913–295000']);
  });

  it('returns an empty array when there is nothing new', () => {
    expect(buildSyncBlockLines(294912, 294912)).toEqual([]);
    expect(buildSyncBlockLines(294912, 294900)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/utils/terminalAnimation.test.js`
Expected: FAIL — `Cannot find module './terminalAnimation.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```js
// src/lib/utils/terminalAnimation.js

// Compact ASCII "FLUX" wordmark — the persistent header identity after boot.
// Kept as a single constant so it's easy to swap later without touching component logic.
export const FLUX_LOGO = ` ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`;

/**
 * Choose a visually reasonable starting block for the boot counter animation —
 * far enough back that the count-up reads as real progress, never below zero.
 */
export function pickBootStartBlock(targetBlock, range = 1100) {
  if (typeof targetBlock !== 'number' || !Number.isFinite(targetBlock)) return null;
  return Math.max(0, Math.floor(targetBlock - range));
}

/**
 * Interpolate the displayed block count between startBlock and targetBlock.
 * Ease-out cubic: fast at first, settles smoothly — always lands exactly on
 * targetBlock at progress===1, and never shows targetBlock before then (so the
 * "... OK" suffix always appears together with the final number, never early).
 */
export function computeAnimatedBlock(startBlock, targetBlock, progress) {
  if (typeof startBlock !== 'number' || typeof targetBlock !== 'number') return targetBlock ?? null;
  if (targetBlock <= startBlock) return targetBlock;

  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped >= 1) return targetBlock;

  const eased = 1 - Math.pow(1 - clamped, 3);
  const value = Math.floor(startBlock + (targetBlock - startBlock) * eased);
  return Math.min(targetBlock - 1, value);
}

/**
 * Decide whether a freshly-polled block height should trigger the short sync
 * animation. False during boot (so the first fetch never fires a sync) and
 * false when there's no prior reading to compare against yet.
 */
export function shouldTriggerSync({ previousBlockHeight, newBlockHeight, bootComplete }) {
  if (!bootComplete) return false;
  if (typeof previousBlockHeight !== 'number' || typeof newBlockHeight !== 'number') return false;
  return newBlockHeight > previousBlockHeight;
}

/** If a new sync arrives while one is already animating, extend the target rather than overlap. */
export function mergeSyncTarget(currentTarget, newBlockHeight) {
  if (typeof currentTarget !== 'number') return newBlockHeight;
  if (typeof newBlockHeight !== 'number') return currentTarget;
  return Math.max(currentTarget, newBlockHeight);
}

export function formatNetworkLine(totalNodes, totalApps) {
  const nodes = Number.isFinite(totalNodes) ? totalNodes.toLocaleString('en-US') : '...';
  const apps = Number.isFinite(totalApps) ? totalApps.toLocaleString('en-US') : '...';
  return `network ${nodes} nodes | apps ${apps}`;
}

export function formatVersionLine(appVersion, codename) {
  const version = appVersion || '...';
  return codename ? `version ${version} ${codename} loaded` : `version ${version} loaded`;
}

/**
 * Build the terminal lines for the sync animation. Enumerates each new block
 * individually when there are few (the common case — one poll cycle rarely
 * misses more than a handful of blocks); condenses to a single range line
 * otherwise so the animation never grows unbounded.
 */
export function buildSyncBlockLines(previousBlockHeight, newBlockHeight) {
  if (typeof previousBlockHeight !== 'number' || typeof newBlockHeight !== 'number') return [];
  if (newBlockHeight <= previousBlockHeight) return [];

  const MAX_LINES = 6;
  const total = newBlockHeight - previousBlockHeight;

  if (total <= MAX_LINES) {
    const lines = [];
    for (let b = previousBlockHeight + 1; b <= newBlockHeight; b++) {
      lines.push(`loading new blocks ${b}`);
    }
    return lines;
  }

  return [`loading new blocks ${previousBlockHeight + 1}–${newBlockHeight}`];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/utils/terminalAnimation.test.js`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/terminalAnimation.js src/lib/utils/terminalAnimation.test.js
git commit -m "feat: add pure logic for terminal header boot/sync animation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013rgcx236QH4KcrgiGXLCRu"
```

---

### Task 3: `TerminalHeaderAnimation.svelte` component

**Files:**
- Create: `src/lib/components/TerminalHeaderAnimation.svelte`

**Interfaces:**
- Consumes: everything from Task 2's `terminalAnimation.js` (`FLUX_LOGO`, `pickBootStartBlock`, `computeAnimatedBlock`, `mergeSyncTarget`, `formatNetworkLine`, `formatVersionLine`, `buildSyncBlockLines`).
- Consumes (props):
  - `blockHeight: number | null`, `totalNodes: number`, `totalApps: number`, `snapshotCount: number`, `appVersion: string`, `arcaneOsCodename: string`, `apiStatus: 'checking'|'online'|'offline'`, `dbStatus: 'checking'|'online'|'offline'`
  - `dataReady: boolean` — Header sets this true once the first successful `/api/header` fetch has populated real values.
  - `syncRequest: { from: number, to: number, id: number } | null` — Header sets a new object (bumping `id`) each time `shouldTriggerSync(...)` is true; `null` initially.
- Produces: dispatches a `bootComplete` CustomEvent once (no payload) when the boot sequence finishes and the component enters `'ready'` state — Task 4's `Header.svelte` listens for this to start allowing sync detection.

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/components/TerminalHeaderAnimation.svelte -->
<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import {
    FLUX_LOGO,
    pickBootStartBlock,
    computeAnimatedBlock,
    mergeSyncTarget,
    formatNetworkLine,
    formatVersionLine,
    buildSyncBlockLines
  } from '$lib/utils/terminalAnimation.js';

  export let blockHeight = null;
  export let totalNodes = 0;
  export let totalApps = 0;
  export let snapshotCount = 0;
  export let appVersion = '...';
  export let arcaneOsCodename = '';
  export let apiStatus = 'checking';
  export let dbStatus = 'checking';
  export let dataReady = false;
  export let syncRequest = null;

  const dispatch = createEventDispatcher();

  const BOOT_TIMEOUT_MS = 4000;
  const COUNTER_DURATION_MS = 1100;

  let state = 'booting'; // 'booting' | 'ready' | 'syncing'
  let lines = [];
  let showLogo = false;
  let logoSettled = false;
  let reducedMotion = false;

  let lastHandledSyncId = null;
  let activeSyncEnd = null;

  let timeouts = [];
  let rafId = null;
  let bootTimeoutId = null;

  function schedule(fn, delay) {
    const id = setTimeout(fn, reducedMotion ? Math.min(delay, 30) : delay);
    timeouts.push(id);
    return id;
  }

  function pushLine(text) {
    lines = [...lines, text];
  }

  function replaceLastLine(text) {
    lines = [...lines.slice(0, -1), text];
  }

  function animateBlockCounter(startBlock, targetBlock, onDone) {
    if (reducedMotion || startBlock === null || targetBlock === null || targetBlock <= startBlock) {
      pushLine(`loading blocks ${targetBlock ?? '...'} / ${targetBlock ?? '...'} ... OK`);
      onDone();
      return;
    }

    pushLine(`loading blocks ${startBlock} / ${targetBlock}`);
    const start = performance.now();

    function frame(now) {
      const progress = (now - start) / COUNTER_DURATION_MS;
      const value = computeAnimatedBlock(startBlock, targetBlock, progress);
      replaceLastLine(`loading blocks ${value} / ${targetBlock}`);

      if (progress >= 1) {
        replaceLastLine(`loading blocks ${targetBlock} / ${targetBlock} ... OK`);
        onDone();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function startBoot() {
    state = 'booting';
    lines = [];
    showLogo = false;
    logoSettled = false;

    pushLine('> ./start_flux_tracker');

    bootTimeoutId = schedule(() => {
      if (state === 'booting') {
        pushLine('> connecting to flux network... ERROR');
        pushLine('> telemetry unavailable');
        schedule(() => finishBoot(), 400);
      }
    }, BOOT_TIMEOUT_MS);

    schedule(() => pushLine('> initializing telemetry...'), 150);
    schedule(() => replaceLastLine('> initializing telemetry... OK'), 350);
    schedule(() => pushLine('> connecting to flux network...'), 450);

    schedule(() => waitForData(), 650);
  }

  function waitForData() {
    if (!dataReady) {
      schedule(waitForData, 100);
      return;
    }
    if (bootTimeoutId) clearTimeout(bootTimeoutId);

    replaceLastLine(`> connecting to flux network... ${apiStatus === 'offline' ? 'ERROR' : 'OK'}`);
    if (apiStatus === 'offline') {
      pushLine('> telemetry unavailable');
      schedule(() => finishBoot(), 400);
      return;
    }

    pushLine(`> api......................... ${apiStatus === 'online' ? 'OK' : 'ERROR'}`);
    pushLine(`> database.................... ${dbStatus === 'online' ? 'OK' : 'OFFLINE'}`);

    const target = blockHeight;
    const startBlock = pickBootStartBlock(target);
    animateBlockCounter(startBlock, target, () => {
      pushLine(formatVersionLine(appVersion, arcaneOsCodename));
      schedule(() => pushLine(formatNetworkLine(totalNodes, totalApps)), 150);
      schedule(() => pushLine(`tracker ${snapshotCount} snapshots`), 280);
      schedule(() => pushLine('> telemetry ready'), 400);
      schedule(() => finishBoot(), 550);
    });
  }

  function finishBoot() {
    showLogo = true;
    schedule(() => { logoSettled = true; }, reducedMotion ? 0 : 350);
    schedule(() => {
      state = 'ready';
      dispatch('bootComplete');
    }, reducedMotion ? 30 : 450);
  }

  function startSync(fromBlock, toBlock) {
    state = 'syncing';
    activeSyncEnd = toBlock;
    lines = buildSyncBlockLines(fromBlock, toBlock);

    schedule(() => {
      pushLine('sync complete');
      schedule(() => {
        state = 'ready';
        activeSyncEnd = null;
      }, reducedMotion ? 30 : 250);
    }, reducedMotion ? 30 : 500);
  }

  $: if (syncRequest && syncRequest.id !== lastHandledSyncId) {
    lastHandledSyncId = syncRequest.id;
    if (state === 'syncing') {
      activeSyncEnd = mergeSyncTarget(activeSyncEnd, syncRequest.to);
    } else if (state === 'ready') {
      startSync(syncRequest.from, syncRequest.to);
    }
  }

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    startBoot();
  });

  onDestroy(() => {
    timeouts.forEach(clearTimeout);
    if (bootTimeoutId) clearTimeout(bootTimeoutId);
    if (rafId) cancelAnimationFrame(rafId);
  });
</script>

<div class="terminal-header">
  {#if state !== 'ready' || !showLogo}
    <pre class="terminal-lines">{lines.join('\n')}</pre>
  {/if}

  {#if showLogo}
    <pre class="ascii-logo" class:settled={logoSettled}>{FLUX_LOGO}</pre>
  {/if}
</div>

<style>
  .terminal-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 2.2rem;
  }

  .terminal-lines {
    margin: 0;
    font-family: inherit;
    font-size: 0.7rem;
    line-height: 1.4;
    color: var(--text-dim);
    white-space: pre-wrap;
  }

  .ascii-logo {
    margin: 0;
    font-family: inherit;
    font-size: clamp(0.4rem, 1.4vw, 0.95rem);
    line-height: 1;
    white-space: pre;
    color: var(--text-primary);
    text-shadow: 0 0 8px #00ffff99;
    opacity: 0;
    transform: translateY(2px);
    transition: opacity 0.35s ease-out, transform 0.35s ease-out, text-shadow 0.4s ease-out;
  }

  .ascii-logo.settled {
    opacity: 1;
    transform: translateY(0);
    text-shadow: var(--glow-cyan);
  }

  @media (max-width: 480px) {
    .ascii-logo {
      font-size: clamp(0.32rem, 2.4vw, 0.6rem);
    }
    .terminal-lines {
      font-size: 0.6rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ascii-logo {
      transition: none;
    }
  }
</style>
```

- [ ] **Step 2: Manual smoke test with a static harness**

Temporarily mount it in isolation to check the boot sequence renders without wiring real data yet — add a throwaway `<TerminalHeaderAnimation blockHeight={294912} totalNodes={12481} totalApps={3842} snapshotCount={819} appVersion="v1.03" arcaneOsCodename="jolly wombat" apiStatus="online" dbStatus="online" dataReady={true} />` at the top of `src/routes/+page.svelte` (or a scratch route), run `npm run dev`, and confirm in the browser: lines type out, block counter animates, resolves to the ASCII logo with a glow settle, no console errors. **Remove the throwaway mount before continuing** — Task 4 wires it into `Header.svelte` for real.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/TerminalHeaderAnimation.svelte
git commit -m "feat: add TerminalHeaderAnimation component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013rgcx236QH4KcrgiGXLCRu"
```

---

### Task 4: Wire into `Header.svelte`

**Files:**
- Modify: `src/lib/components/Header.svelte`

**Interfaces:**
- Consumes: `shouldTriggerSync` from `terminalAnimation.js`; `TerminalHeaderAnimation` component and its props/events from Task 3.

- [ ] **Step 1: Import the new pieces and add boot/sync tracking state**

In the `<script>` block of `Header.svelte`, add near the other `let` declarations:

```js
import TerminalHeaderAnimation from '$lib/components/TerminalHeaderAnimation.svelte';
import { shouldTriggerSync } from '$lib/utils/terminalAnimation.js';

let dataReady = false;
let bootComplete = false;
let previousBlockHeight = null;
let syncRequest = null;
let syncCounter = 0;
```

- [ ] **Step 2: Update `fetchHeaderData` to set `dataReady`, read `dbStatus` from the response, and compute `syncRequest`**

Replace the body of `fetchHeaderData` (`Header.svelte:48-97`) with:

```js
async function fetchHeaderData() {
  try {
    const response = await fetch(`${API_URL}/api/header`);
    const data = await response.json();

    if (data.error) {
      apiStatus = 'offline';
      dbStatus = 'offline';
      return;
    }

    apiStatus = 'online';
    dbStatus = data.dbStatus === 'online' ? 'online' : 'offline';

    // Network
    fluxPrice = data.network.fluxPriceUsd;
    const newBlockHeight = data.network.blockHeight;
    totalNodes = data.network.totalNodes;
    totalApps = data.network.totalApps;

    // Tracker
    const uptimeSeconds = Math.floor(data.tracker.uptime);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    uptime = `${days}d ${hours}:${minutes.toString().padStart(2, '0')}`;

    snapshotCount = data.tracker.snapshots;
    lastSnapshotDate = data.tracker.lastSnapshotDate || 'N/A';
    transactionCount = data.tracker.transactions;
    lastSyncBlock = data.tracker.lastSyncBlock;

    // Build
    appVersion = data.appVersion || '...';
    arcaneOsCodename = data.network.arcaneOsCodename || '';

    // Host
    platform = data.host.platform;
    hostLocation = data.host.location || null;
    cpuCores = data.host.cpuCores;
    totalMemMB = data.host.totalMemMB;
    usedMemMB = data.host.usedMemMB;
    memPercent = data.host.memPercent;

    if (shouldTriggerSync({ previousBlockHeight, newBlockHeight, bootComplete })) {
      syncCounter += 1;
      syncRequest = { from: previousBlockHeight, to: newBlockHeight, id: syncCounter };
    }
    previousBlockHeight = newBlockHeight;
    blockHeight = newBlockHeight;
    dataReady = true;

  } catch (error) {
    console.error('Error fetching header data:', error);
    apiStatus = 'offline';
    dbStatus = 'offline';
  }
}

function handleBootComplete() {
  bootComplete = true;
}
```

Note `blockHeight` is now set at the end (from `newBlockHeight`) instead of inline — this preserves its existing use in the right-side stats reactive markup while giving the sync check a stable `previousBlockHeight` to compare against.

- [ ] **Step 3: Replace the static title markup**

Replace (`Header.svelte:132-134`):

```svelte
<h1 class="header-title glow-text">
  FLUX<br/>TRACKER
</h1>
```

with:

```svelte
<TerminalHeaderAnimation
  {blockHeight}
  {totalNodes}
  {totalApps}
  {snapshotCount}
  {appVersion}
  {arcaneOsCodename}
  {apiStatus}
  {dbStatus}
  {dataReady}
  {syncRequest}
  on:bootComplete={handleBootComplete}
/>
```

- [ ] **Step 4: Remove the now-unused `.header-title` CSS rule** (it styled the deleted `<h1>`) from the `<style>` block (`Header.svelte:221-230`), and check `.header-left`'s `gap` still reads fine visually in Step 6 below.

- [ ] **Step 5: Run the existing test suite to make sure nothing else broke**

Run: `npm test`
Expected: PASS (no existing tests reference `Header.svelte`, so this just confirms the vitest config/module resolution is intact after the edits).

- [ ] **Step 6: Manual verification — full boot/sync/responsive pass**

Run `npm run dev:all`, open the dashboard in the browser, and walk the acceptance criteria from the GitHub issue:
- Refresh the page: boot sequence plays (`> ./start_flux_tracker` → block counter → `FLUX` ASCII), finishes in ~3s, no `TRACKER` text anywhere in the final state, right-side stats still populate.
- Resize to a mobile width (or open dev tools device toolbar at ~375px): no horizontal scroll, ASCII logo shrinks and stays readable, host-line still hides per existing behavior.
- In dev tools, enable "Emulate CSS prefers-reduced-motion: reduce": refresh — boot resolves almost immediately, no counter animation, no janky transition.
- Stop the API process (`Ctrl+C` on `npm run api`) and refresh the page: boot shows a `... ERROR` / `telemetry unavailable` line within ~4s and still falls through to a normal (if data-less) header — the rest of the dashboard must still load.
- Restart the API, wait for a real new block (or manually bump a value the header polls) and confirm the short sync animation plays and returns to the ASCII logo without replaying the full boot.

Fix any visual issues found (spacing, font-size clamp values, timing) directly in `TerminalHeaderAnimation.svelte` / `Header.svelte` before committing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/Header.svelte
git commit -m "feat: replace static header title with terminal boot/sync animation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013rgcx236QH4KcrgiGXLCRu"
```

---

### Task 5: Final QA pass, changelog note, and PR

**Files:** none (verification + PR only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Re-check the GitHub issue #77 acceptance criteria end-to-end** using the same manual walkthrough as Task 4 Step 6, this time on both a desktop-width and a real mobile device or emulated narrow viewport, and note in the PR description which checkboxes are confirmed.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feature/terminal-header-animation
gh pr create --repo 2ndtlmining/Fluxtracker --base main \
  --title "feat: terminal boot/sync animation for the header" \
  --body "Closes #77.

Implements the terminal boot/sync header animation from #77: replaces the static FLUX/TRACKER title with a boot sequence driven by real /api/header data, resolving into a persistent ASCII FLUX logo, plus a short sync animation on new blocks.

## Changes
- \`src/lib/utils/terminalAnimation.js\` (+ unit tests) — pure block-counter easing, sync-trigger guard, overlap merging, line formatting
- \`src/lib/components/TerminalHeaderAnimation.svelte\` — new component: boot sequence, ASCII logo, sync animation, reduced-motion handling
- \`src/lib/components/Header.svelte\` — wires real data in, decides when a sync occurred, replaces the static title
- \`src/server.js\` — /api/header now returns a real \`dbStatus\` field (was previously duplicated from apiStatus)

## Verified
- Desktop and mobile-width boot + sync animation, no horizontal overflow
- prefers-reduced-motion: boot/sync resolve near-instantly
- /api/header failure falls through to a working header, doesn't trap the user
- Full boot only plays on page load; sync-only animation on subsequent new blocks
- \`npm test\` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Report the PR URL back to the user for review.**

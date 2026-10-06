# Expired Running Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect apps still running on Flux nodes ≥24 h after their subscription ended, show them in an "Expired running" view on the Apps card, and record a daily count for the history chart.

**Architecture:** A new `expiredRunningService.js` combines the running-apps census (already fetched once per cycle), the cached `globalappsspecifications`, the block height, and — only for running apps with no spec — a cached per-app `permanentmessages?appname=` lookup. The cloud service cycle writes two new `current_metrics` columns that the daily snapshot copies; a new endpoint serves the live list to the card.

**Tech Stack:** Node/Express, SvelteKit (Svelte 4 syntax in these components), vitest, Supabase/SQLite adapters.

**Spec:** `docs/superpowers/specs/2026-10-06-expired-running-apps-design.md`

## Global Constraints

- End block = `height + expire`; missing `expire` → `DEFAULT_EXPIRE_BLOCKS = 22000`.
- `BLOCKS_PER_DAY = 2880`; grace `EXPIRED_RUNNING_GRACE_BLOCKS = 2880`; counted iff `currentBlock − endBlock ≥ 2880`.
- Days expired = `Math.floor((currentBlock − endBlock) / 2880)`.
- Instances = distinct nodes (`deploymentCounts`), never containers.
- A spec whose end block is in the future means live — never counted.
- `permanentmessages?appname=` is case-sensitive: always query with the original-case name.
- Unknown is never 0: unavailable inputs → `null` (card "n/a", DB column untouched).
- All outbound GETs through `resilientFetch.js`; breaker key `permanent-messages-app`.
- No new table, no new adapter function (adapter contract count stays 103).
- Numbers in the UI through `$lib/utils/format.js` (`formatCount`).
- Toggle buttons expose `aria-pressed`.
- Run tests with `DB_TYPE=sqlite` (`npx vitest run <file>`), as CI does.
- Never put node IPs or credentials in commits/PRs.

## Review Focus

1. **App renewed after we cached its old end block** — the cache entry must be dropped when a spec for that name reappears, otherwise a later re-expiry reports inflated days. Test in Task 3.
2. **permanentmessages API down / breaker open on the first cycle** — every lookup fails; the app must be skipped (`unresolved`), not counted and not cached. Test in Task 3.
3. **Mixed-case app names (`AbioticFactor`)** — the lookup must receive original casing even though `deploymentCounts` is lowercase. Test in Tasks 1 and 3.
4. **A sudden flood of spec-less running apps** (e.g. specs cache partially loaded) — lookups capped per run (`EXPIRED_RUNNING_MAX_LOOKUPS = 50`), and an empty specs cache returns `null` rather than treating every app as spec-less. Test in Task 3.
5. **Zero expired apps** — card shows the "None" message, endpoint returns `apps: 0, top: []`, column stores `0` (a real reading, not null). Test in Tasks 2 and 6.

---

### Task 1: Config constants and original-case app names in the census

**Files:**
- Modify: `src/lib/config.js` (append after `DASHBOARD_REFRESH_MS`, ~line 766)
- Modify: `src/lib/services/runningAppsProvider.js:67,98,140`
- Test: `src/lib/services/__tests__/runningAppsNames.test.js` (create)

**Interfaces:**
- Produces: config exports `BLOCKS_PER_DAY`, `EXPIRED_RUNNING_GRACE_BLOCKS`, `DEFAULT_EXPIRE_BLOCKS`, `EXPIRED_RUNNING_TOP_N`, `EXPIRED_RUNNING_MAX_LOOKUPS`; `getRunningApps()` result gains `deploymentNames: Map<string lowercase, string original>`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/services/__tests__/runningAppsNames.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Expired-running detection looks apps up on permanentmessages?appname=, which is
 * CASE-SENSITIVE ("AbioticFactor" resolves, "abioticfactor" returns []). deploymentCounts is
 * keyed lowercase, so the census must also carry each app's name as the container spelled it.
 */
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn(async () => {}),
    resolveRunningAppName: vi.fn(() => ({ appName: 'x', repotag: 'some/image:1' })),
    getAllAppSpecs: vi.fn(() => [])
}));
const mockFetch = vi.fn();
vi.mock('../resilientFetch.js', () => ({ resilientFetch: (...a) => mockFetch(...a) }));

import { getRunningApps, clearRunningAppsCache } from '../runningAppsProvider.js';

beforeEach(() => { vi.clearAllMocks(); clearRunningAppsCache(); });

describe('deploymentNames', () => {
    it('maps each lowercase app key to the casing the container used', async () => {
        mockFetch.mockResolvedValue({ data: [
            { apps: { runningapps: [{ Names: ['/fluxabioticfactor_AbioticFactor'] }] } },
            { apps: { runningapps: [{ Names: ['/fluxdragonwilds1790622302263'] }] } }
        ] });

        const apps = await getRunningApps({ force: true, retries: 0 });

        expect(apps.deploymentNames.get('abioticfactor')).toBe('AbioticFactor');
        expect(apps.deploymentNames.get('dragonwilds1790622302263')).toBe('dragonwilds1790622302263');
        expect(apps.deploymentCounts.get('abioticfactor')).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/runningAppsNames.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'get')`.

- [ ] **Step 3: Implement**

In `src/lib/config.js`, after `export const DASHBOARD_REFRESH_MS = 5 * 60 * 1000;`:

```js
// Expired running apps (spec 2026-10-06). An app's subscription ends at its latest
// register/update height + the blocks paid for (`expire`); specs without `expire` use Flux's
// default of 22,000 blocks. Blocks are 30 s, so 2,880 a day. An app only counts as "expired
// running" once it is a full day past its end block: normal teardown and the stats crawl
// both lag, and counting those would make the figure jump with ordinary cleanup.
export const BLOCKS_PER_DAY = 2880;
export const EXPIRED_RUNNING_GRACE_BLOCKS = 2880;
export const DEFAULT_EXPIRE_BLOCKS = 22000;
export const EXPIRED_RUNNING_TOP_N = 3;
// Per-cycle cap on permanentmessages lookups; the rest wait for the next cycle. ~18 apps on
// 2026-10-06, so this only bites if something upstream goes badly wrong.
export const EXPIRED_RUNNING_MAX_LOOKUPS = 50;
```

In `runningAppsProvider.js` `fetchRunningApps()`:

after `const deploymentCounts = new Map();` add
```js
    // lowercase app name -> the casing the container used (first seen wins). The expired-
    // running lookup needs it: permanentmessages?appname= is case-sensitive.
    const deploymentNames = new Map();
```
replace `if (appName) appsOnThisNode.add(appName.toLowerCase());` with
```js
            if (appName) {
                const key = appName.toLowerCase();
                appsOnThisNode.add(key);
                if (!deploymentNames.has(key)) deploymentNames.set(key, appName);
            }
```
and add `deploymentNames` to the returned object (after `deploymentCounts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/runningAppsNames.test.js src/lib/services/__tests__/deploymentFill.test.js`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.js src/lib/services/runningAppsProvider.js src/lib/services/__tests__/runningAppsNames.test.js
git commit -m "feat: keep original-case app names in the running-apps census"
```

---

### Task 2: Pure expired-running computation

**Files:**
- Create: `src/lib/services/expiredRunningService.js`
- Test: `src/lib/services/__tests__/expiredRunning.test.js` (create)

**Interfaces:**
- Consumes: config constants from Task 1.
- Produces:
  - `specEndBlock(spec) -> number|null`
  - `computeExpiredRunning({ deploymentCounts: Map<string,number>, deploymentNames: Map<string,string>, specs: object[], currentBlock: number, lookups: Map<string, {endBlock:number}|{none:true}|{failed:true}> }) -> { apps:number, instances:number, unresolved:number, top: Array<{name:string, instances:number, daysExpired:number, endBlock:number}>, needLookup: string[] }`
    - `needLookup` = lowercase keys of running apps with no spec and no entry in `lookups`.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/services/__tests__/expiredRunning.test.js
import { describe, it, expect } from 'vitest';
import { computeExpiredRunning, specEndBlock } from '../expiredRunningService.js';

const BLOCK = 3_012_176;

function run({ running = {}, specs = [], lookups = {} } = {}) {
    const deploymentCounts = new Map(Object.entries(running).map(([n, c]) => [n.toLowerCase(), c]));
    const deploymentNames = new Map(Object.keys(running).map(n => [n.toLowerCase(), n]));
    return computeExpiredRunning({
        deploymentCounts, deploymentNames, specs, currentBlock: BLOCK,
        lookups: new Map(Object.entries(lookups))
    });
}

describe('specEndBlock', () => {
    it('is height + expire', () => {
        expect(specEndBlock({ height: 2_867_975, expire: 100 })).toBe(2_868_075);
    });
    it('uses the 22,000-block default when expire is missing', () => {
        expect(specEndBlock({ height: 1000 })).toBe(23_000);
    });
    it('is null without a usable height', () => {
        expect(specEndBlock({ expire: 100 })).toBeNull();
    });
});

describe('computeExpiredRunning', () => {
    it('counts an app exactly one grace period past its end block', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { endBlock: BLOCK - 2880 } } });
        expect(r.apps).toBe(1);
        expect(r.top[0]).toEqual({ name: 'a', instances: 1, daysExpired: 1, endBlock: BLOCK - 2880 });
    });

    it('does not count an app one block inside the grace period', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { endBlock: BLOCK - 2879 } } });
        expect(r.apps).toBe(0);
    });

    it('never counts an app whose spec is still live, whatever a lookup says', () => {
        const r = run({
            running: { a: 2 },
            specs: [{ name: 'a', height: BLOCK - 10, expire: 1000 }],
            lookups: { a: { endBlock: BLOCK - 100_000 } }
        });
        expect(r.apps).toBe(0);
        expect(r.needLookup).toEqual([]);
    });

    it('takes the end block from a spec that is present but expired, with no lookup', () => {
        const r = run({ running: { a: 1 }, specs: [{ name: 'a', height: BLOCK - 10_000, expire: 100 }] });
        expect(r.apps).toBe(1);
        expect(r.top[0].daysExpired).toBe(Math.floor(9_900 / 2880));
        expect(r.needLookup).toEqual([]);
    });

    it('matches specs to running apps case-insensitively', () => {
        const r = run({ running: { AbioticFactor: 1 }, specs: [{ name: 'AbioticFactor', height: BLOCK, expire: 1000 }] });
        expect(r.needLookup).toEqual([]);
        expect(r.apps).toBe(0);
    });

    it('asks for a lookup when a running app has no spec and no lookup yet', () => {
        const r = run({ running: { AbioticFactor: 1 } });
        expect(r.needLookup).toEqual(['abioticfactor']);
        expect(r.apps).toBe(0);
    });

    it('does not count an app with no permanent messages (local container, never subscribed)', () => {
        const r = run({ running: { v11: 1 }, lookups: { v11: { none: true } } });
        expect(r.apps).toBe(0);
        expect(r.unresolved).toBe(0);
    });

    it('reports a failed lookup as unresolved, never as counted', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { failed: true } } });
        expect(r.apps).toBe(0);
        expect(r.unresolved).toBe(1);
    });

    it('sums instances (nodes) across apps and lists the top 3 longest expired', () => {
        const r = run({
            running: { w: 4, x: 1, y: 3, z: 1 },
            lookups: {
                w: { endBlock: BLOCK - 2880 * 18 },
                x: { endBlock: BLOCK - 2880 * 50 },
                y: { endBlock: BLOCK - 2880 * 7 },
                z: { endBlock: BLOCK - 2880 * 46 }
            }
        });
        expect(r.apps).toBe(4);
        expect(r.instances).toBe(9);
        expect(r.top.map(t => [t.name, t.daysExpired])).toEqual([['x', 50], ['z', 46], ['w', 18]]);
    });

    it('breaks a tie on days expired by name', () => {
        const r = run({ running: { b: 1, a: 1 }, lookups: { a: { endBlock: BLOCK - 5760 }, b: { endBlock: BLOCK - 5760 } } });
        expect(r.top.map(t => t.name)).toEqual(['a', 'b']);
    });

    it('returns zeros and an empty list when nothing has expired', () => {
        const r = run({ running: { a: 1 }, specs: [{ name: 'a', height: BLOCK, expire: 5000 }] });
        expect(r).toMatchObject({ apps: 0, instances: 0, unresolved: 0, top: [] });
    });

    it('shows the name as the container spelled it', () => {
        const r = run({ running: { AbioticFactor: 1 }, lookups: { abioticfactor: { endBlock: BLOCK - 2880 * 2 } } });
        expect(r.top[0].name).toBe('AbioticFactor');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/expiredRunning.test.js`
Expected: FAIL — cannot resolve `../expiredRunningService.js`.

- [ ] **Step 3: Implement**

```js
// src/lib/services/expiredRunningService.js
/**
 * Expired running apps (spec docs/superpowers/specs/2026-10-06-expired-running-apps-design.md).
 *
 * An app still running on Flux nodes a full day after its subscription ended. Measured
 * 2026-10-06: 18 such apps, the oldest 50 days past expiry, Flux's own `web` on 4 nodes 18
 * days after cancellation. Fluxtracker counts running containers, so these silently inflate
 * its figures; this names and counts them.
 *
 * End block = latest register/update height + `expire`. Read from the spec when Flux still
 * lists it (it keeps some for a while after expiry), else from the app's last permanent
 * message. A running app with neither is a local container that never had a subscription.
 */
import {
    BLOCKS_PER_DAY, EXPIRED_RUNNING_GRACE_BLOCKS, DEFAULT_EXPIRE_BLOCKS, EXPIRED_RUNNING_TOP_N
} from '../config.js';

export function specEndBlock(spec) {
    const height = Number(spec?.height);
    if (!Number.isFinite(height) || height <= 0) return null;
    const expire = Number.isFinite(Number(spec.expire)) && spec.expire != null
        ? Number(spec.expire)
        : DEFAULT_EXPIRE_BLOCKS;
    return height + expire;
}

export function computeExpiredRunning({ deploymentCounts, deploymentNames, specs, currentBlock, lookups }) {
    const specByKey = new Map((specs || []).map(s => [String(s.name).toLowerCase(), s]));
    const expired = [];
    const needLookup = [];
    let unresolved = 0;

    for (const [key, nodes] of deploymentCounts) {
        let endBlock = null;
        const spec = specByKey.get(key);
        if (spec) {
            endBlock = specEndBlock(spec);
        } else {
            const found = lookups?.get(key);
            if (!found) { needLookup.push(key); continue; }
            if (found.failed) { unresolved++; continue; }
            if (found.none) continue;
            endBlock = found.endBlock;
        }
        if (endBlock == null || currentBlock - endBlock < EXPIRED_RUNNING_GRACE_BLOCKS) continue;

        expired.push({
            name: deploymentNames?.get(key) || key,
            instances: nodes,
            daysExpired: Math.floor((currentBlock - endBlock) / BLOCKS_PER_DAY),
            endBlock
        });
    }

    expired.sort((a, b) => b.daysExpired - a.daysExpired || a.name.localeCompare(b.name));
    return {
        apps: expired.length,
        instances: expired.reduce((sum, e) => sum + e.instances, 0),
        unresolved,
        top: expired.slice(0, EXPIRED_RUNNING_TOP_N),
        needLookup
    };
}
```

Note the sort sorts by `daysExpired` then name; two apps with the same whole days but different end blocks tie by name — intended (the card shows whole days).

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/expiredRunning.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/expiredRunningService.js src/lib/services/__tests__/expiredRunning.test.js
git commit -m "feat: compute expired running apps from specs and end blocks"
```

---

### Task 3: Permanent-message lookup, caching and the live entry point

**Files:**
- Modify: `src/lib/services/expiredRunningService.js`
- Test: `src/lib/services/__tests__/expiredRunningLive.test.js` (create)

**Interfaces:**
- Consumes: `getRunningApps()` (`deploymentCounts`, `deploymentNames`), `getAllAppSpecs()`, `fetchCurrentBlockHeight()`, `resilientFetch()`, `computeExpiredRunning()`.
- Produces:
  - `lookupEndBlock(name: string) -> Promise<number|null>` (throws on request failure)
  - `getExpiredRunning({ ttlMs = 0 } = {}) -> Promise<{apps, instances, unresolved, top, currentBlock, computedAt}|null>`
  - `clearExpiredRunningCaches()` (test hook)

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/services/__tests__/expiredRunningLive.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({ getRunningApps: (...a) => mockGetRunningApps(...a) }));
const mockSpecs = vi.fn();
vi.mock('../appSpecsCache.js', () => ({ getAllAppSpecs: (...a) => mockSpecs(...a) }));
const mockBlock = vi.fn();
vi.mock('../fluxNetworkData.js', () => ({ fetchCurrentBlockHeight: (...a) => mockBlock(...a) }));
const mockFetch = vi.fn();
vi.mock('../resilientFetch.js', () => ({ resilientFetch: (...a) => mockFetch(...a) }));

import { getExpiredRunning, lookupEndBlock, clearExpiredRunningCaches } from '../expiredRunningService.js';

const BLOCK = 3_012_176;
const messages = (...m) => ({ status: 'success', data: m.map(([height, expire]) => ({ height, appSpecifications: { expire } })) });

function census(apps) {
    return {
        deploymentCounts: new Map(Object.entries(apps).map(([n, c]) => [n.toLowerCase(), c])),
        deploymentNames: new Map(Object.keys(apps).map(n => [n.toLowerCase(), n]))
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearExpiredRunningCaches();
    mockBlock.mockResolvedValue(BLOCK);
    mockSpecs.mockReturnValue([{ name: 'live', height: BLOCK, expire: 1000 }]);
});

describe('lookupEndBlock', () => {
    it('uses the highest-height message: height + expire', async () => {
        mockFetch.mockResolvedValue(messages([2_960_391, 20160], [2_989_904, 100], [2_962_953, 105618]));
        expect(await lookupEndBlock('dragonwilds1789699856366')).toBe(2_990_004);
    });

    it('queries with the original-case name, URL-encoded', async () => {
        mockFetch.mockResolvedValue(messages([10, 100]));
        await lookupEndBlock('AbioticFactor');
        expect(mockFetch.mock.calls[0][0]).toMatch(/permanentmessages\?appname=AbioticFactor$/);
        expect(mockFetch.mock.calls[0][1]).toMatchObject({ breakerKey: 'permanent-messages-app' });
    });

    it('returns null when the app has no messages', async () => {
        mockFetch.mockResolvedValue({ status: 'success', data: [] });
        expect(await lookupEndBlock('v11')).toBeNull();
    });

    it('throws on an error body', async () => {
        mockFetch.mockResolvedValue({ status: 'error', data: { message: 'boom' } });
        await expect(lookupEndBlock('a')).rejects.toThrow();
    });
});

describe('getExpiredRunning', () => {
    it('looks up spec-less apps with their original casing and counts the expired ones', async () => {
        mockGetRunningApps.mockResolvedValue(census({ live: 2, AbioticFactor: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3, 0]));

        const r = await getExpiredRunning();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][0]).toContain('appname=AbioticFactor');
        expect(r).toMatchObject({ apps: 1, instances: 1, unresolved: 0 });
        expect(r.top[0]).toMatchObject({ name: 'AbioticFactor', daysExpired: 3 });
    });

    it('caches a resolved end block: no second request next cycle', async () => {
        mockGetRunningApps.mockResolvedValue(census({ gone: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3, 0]));
        await getExpiredRunning();
        await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed lookup, and never counts it', async () => {
        mockGetRunningApps.mockResolvedValue(census({ gone: 1 }));
        mockFetch.mockRejectedValueOnce(new Error('timeout'));
        const first = await getExpiredRunning();
        expect(first).toMatchObject({ apps: 0, unresolved: 1 });

        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3, 0]));
        const second = await getExpiredRunning();
        expect(second).toMatchObject({ apps: 1, unresolved: 0 });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('caches "no messages" for 24 h', async () => {
        vi.useFakeTimers();
        try {
            mockGetRunningApps.mockResolvedValue(census({ v11: 1 }));
            mockFetch.mockResolvedValue({ status: 'success', data: [] });
            await getExpiredRunning();
            await getExpiredRunning();
            expect(mockFetch).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
            await getExpiredRunning();
            expect(mockFetch).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('forgets a cached end block once the app has a spec again (renewal)', async () => {
        mockGetRunningApps.mockResolvedValue(census({ app: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 40, 0]));
        await getExpiredRunning();                                   // cached: 40 days

        mockSpecs.mockReturnValue([{ name: 'app', height: BLOCK, expire: 1000 }]);
        expect((await getExpiredRunning()).apps).toBe(0);            // renewed -> live

        // Expired again later: its spec is gone (another app keeps the specs list non-empty).
        mockSpecs.mockReturnValue([{ name: 'other', height: BLOCK, expire: 1000 }]);
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 2, 0]));
        const r = await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(2);                  // looked up afresh
        expect(r.top[0].daysExpired).toBe(2);                        // not the stale 40
    });

    it('caps lookups per run; the rest wait as unresolved', async () => {
        const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`app${i}`, 1]));
        mockGetRunningApps.mockResolvedValue(census(many));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3, 0]));
        const r = await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(50);
        expect(r.apps).toBe(50);
        expect(r.unresolved).toBe(10);
    });

    it('returns null without a block height', async () => {
        mockGetRunningApps.mockResolvedValue(census({ a: 1 }));
        mockBlock.mockRejectedValue(new Error('down'));
        expect(await getExpiredRunning()).toBeNull();
    });

    it('returns null when the specs cache is empty, rather than looking up every app', async () => {
        mockGetRunningApps.mockResolvedValue(census({ a: 1, b: 1 }));
        mockSpecs.mockReturnValue([]);
        expect(await getExpiredRunning()).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when the census fails', async () => {
        mockGetRunningApps.mockRejectedValue(new Error('down'));
        expect(await getExpiredRunning()).toBeNull();
    });

    it('serves a recent result within ttlMs without recomputing', async () => {
        mockGetRunningApps.mockResolvedValue(census({ live: 1 }));
        await getExpiredRunning();
        await getExpiredRunning({ ttlMs: 60_000 });
        expect(mockGetRunningApps).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/expiredRunningLive.test.js`
Expected: FAIL — `lookupEndBlock` / `getExpiredRunning` not exported.

- [ ] **Step 3: Implement** — append to `expiredRunningService.js` and extend its imports:

```js
import {
    API_ENDPOINTS, BLOCKS_PER_DAY, EXPIRED_RUNNING_GRACE_BLOCKS, DEFAULT_EXPIRE_BLOCKS,
    EXPIRED_RUNNING_TOP_N, EXPIRED_RUNNING_MAX_LOOKUPS
} from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { getRunningApps } from './runningAppsProvider.js';
import { getAllAppSpecs } from './appSpecsCache.js';
import { fetchCurrentBlockHeight } from './fluxNetworkData.js';
import { createLogger } from '../logger.js';

const log = createLogger('expiredRunningService');
const NONE_TTL_MS = 24 * 60 * 60 * 1000;

// lowercase app name -> { endBlock } (kept until the app has a spec again) | { none, at }
const lookupCache = new Map();
let lastResult = null;   // { value, at }

/**
 * End block from the app's last permanent message, or null when it has none. Throws on a
 * failed request so the caller can skip the app this cycle instead of caching a guess.
 * The appname query is case-sensitive: pass the name as the container spelled it.
 */
export async function lookupEndBlock(name) {
    const body = await resilientFetch(
        `${API_ENDPOINTS.APPS}/permanentmessages?appname=${encodeURIComponent(name)}`,
        { timeout: 15000, retries: 1, delayMs: 2000, breakerKey: 'permanent-messages-app' }
    );
    if (body?.status !== 'success' || !Array.isArray(body.data)) {
        throw new Error(`permanentmessages for ${name}: ${body?.data?.message || 'unexpected response'}`);
    }
    const msgs = body.data.filter(m => m?.appSpecifications && Number.isFinite(Number(m.height)));
    if (msgs.length === 0) return null;
    const last = msgs.reduce((a, b) => (Number(b.height) > Number(a.height) ? b : a));
    return specEndBlock({ height: last.height, expire: last.appSpecifications.expire });
}

async function resolveLookups(keys, deploymentNames, now) {
    const lookups = new Map();
    let made = 0;
    for (const key of keys) {
        const cached = lookupCache.get(key);
        if (cached && (cached.endBlock != null || now - cached.at < NONE_TTL_MS)) {
            lookups.set(key, cached.endBlock != null ? { endBlock: cached.endBlock } : { none: true });
            continue;
        }
        if (made >= EXPIRED_RUNNING_MAX_LOOKUPS) { lookups.set(key, { failed: true }); continue; }
        made++;
        try {
            const endBlock = await lookupEndBlock(deploymentNames.get(key) || key);
            if (endBlock == null) {
                lookupCache.set(key, { none: true, at: now });
                lookups.set(key, { none: true });
            } else {
                lookupCache.set(key, { endBlock });
                lookups.set(key, { endBlock });
            }
        } catch (err) {
            log.warn({ err, app: key }, 'Expired-running lookup failed; retrying next cycle');
            lookups.set(key, { failed: true });
        }
    }
    return lookups;
}

/**
 * The live figure. null when the census, the block height or the specs cache is unavailable
 * -- an empty specs cache would make every running app look spec-less.
 */
export async function getExpiredRunning({ ttlMs = 0 } = {}) {
    if (ttlMs > 0 && lastResult && Date.now() - lastResult.at < ttlMs) return lastResult.value;

    let apps, currentBlock;
    try {
        [apps, currentBlock] = await Promise.all([
            getRunningApps(),
            fetchCurrentBlockHeight().catch(() => null)
        ]);
    } catch (err) {
        log.warn({ err }, 'Running apps unavailable -- expired running not computed');
        return null;
    }
    const specs = getAllAppSpecs();
    if (!currentBlock || !apps?.deploymentCounts || specs.length === 0) return null;

    // A renewed app is back in the specs: forget its old end block, so a later expiry is
    // looked up afresh instead of reporting the stale one.
    for (const spec of specs) lookupCache.delete(String(spec.name).toLowerCase());

    const deploymentNames = apps.deploymentNames || new Map();
    const base = { deploymentCounts: apps.deploymentCounts, deploymentNames, specs, currentBlock };
    const firstPass = computeExpiredRunning({ ...base, lookups: new Map() });
    const lookups = await resolveLookups(firstPass.needLookup, deploymentNames, Date.now());
    const { needLookup, ...result } = computeExpiredRunning({ ...base, lookups });

    const value = { ...result, currentBlock, computedAt: Date.now() };
    lastResult = { value, at: Date.now() };
    log.info({ apps: value.apps, instances: value.instances, unresolved: value.unresolved },
        'Expired running: %d apps on %d nodes (%d unresolved)', value.apps, value.instances, value.unresolved);
    return value;
}

/** Test hook. */
export function clearExpiredRunningCaches() {
    lookupCache.clear();
    lastResult = null;
}
```

Remove the original narrower import line at the top of the file (it is replaced by the block above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/expiredRunningLive.test.js src/lib/services/__tests__/expiredRunning.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/expiredRunningService.js src/lib/services/__tests__/expiredRunningLive.test.js
git commit -m "feat: look up end blocks of spec-less running apps, cached"
```

---

### Task 4: Database columns

**Files:**
- Create: `supabase/migrations/031_expired_running.sql`
- Modify: `src/lib/config.js:565` (`METRIC_COLUMNS`)
- Modify: `src/lib/db/schemaMigrator.js` (after the `enterprise_apps_percent` entry, ~line 62)
- Modify: `src/lib/db/snapshotManager.js` (after `enterprise_apps_percent`, ~line 298)
- Modify: `src/lib/db/adapters/sqliteAdapter.js` (after `enterprise_apps_percent`, ~line 573)
- Modify: `src/lib/db/adapters/supabaseAdapter.js` (after the `enterprise_apps_percent` guard, ~line 302)
- Modify: `src/lib/services/serviceHealth.js` (`SERVICE_COLUMNS.cloud`)
- Test: existing `src/lib/db/__tests__/snapshotAdapterParity.test.js` (iterates `METRIC_COLUMNS`, so it covers the new columns once they are listed)

**Interfaces:**
- Produces: columns `expired_running_apps INTEGER`, `expired_running_instances INTEGER` on `current_metrics` and `daily_snapshots`.

- [ ] **Step 1: Make the parity test fail**

Add `'expired_running_apps', 'expired_running_instances'` to `METRIC_COLUMNS` in `config.js` (after `'enterprise_apps', 'enterprise_apps_percent'`).

Run: `DB_TYPE=sqlite npx vitest run src/lib/db/__tests__/snapshotAdapterParity.test.js`
Expected: FAIL — the new columns are missing from the stored row (or `no such column`).

- [ ] **Step 2: Implement**

`supabase/migrations/031_expired_running.sql`:
```sql
-- Expired running apps (spec 2026-10-06).
--
-- Apps still running on Flux nodes at least a day (2,880 blocks) after their subscription
-- ended: how many, and on how many nodes. Computed every services cycle into
-- current_metrics; the daily snapshot copies it. Forward-only: the running census is live,
-- there is nothing to backfill from.
--
-- No DEFAULT: a day predating this has no reading, and a 0 would read as "no expired apps
-- were running".
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS expired_running_apps INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS expired_running_instances INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS expired_running_apps INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS expired_running_instances INTEGER;
```

`schemaMigrator.js`, after `{ name: 'enterprise_apps_percent', ... }`:
```js
    // Expired running apps (migration 031). No DEFAULT: a 0 would read as "none running"
    // for days that predate the feature.
    { name: 'expired_running_apps', type: 'INTEGER' },
    { name: 'expired_running_instances', type: 'INTEGER' },
```

`snapshotManager.js`, after `enterprise_apps_percent: currentMetrics.enterprise_apps_percent ?? null,`:
```js
        expired_running_apps: currentMetrics.expired_running_apps ?? null,          // migration 031
        expired_running_instances: currentMetrics.expired_running_instances ?? null,
```

`sqliteAdapter.js` `createDailySnapshot` row, after `enterprise_apps_percent: snapshot.enterprise_apps_percent ?? null,`:
```js
        expired_running_apps: snapshot.expired_running_apps ?? null,               // migration 031
        expired_running_instances: snapshot.expired_running_instances ?? null,
```

`supabaseAdapter.js` `createDailySnapshot`, after the `enterprise_apps_percent` guard block:
```js
        // Migration 031, same guard: named only with a reading, so a deploy that lands
        // before the migration never names a column the table lacks.
        ...(snapshot.expired_running_apps != null ? {
            expired_running_apps: snapshot.expired_running_apps,
            expired_running_instances: snapshot.expired_running_instances
        } : {}),
```

`serviceHealth.js` `SERVICE_COLUMNS.cloud`: append `'expired_running_apps', 'expired_running_instances'` after `'deployment_fill_percent'`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `DB_TYPE=sqlite npx vitest run src/lib/db src/lib/services/__tests__/serviceHealth.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/031_expired_running.sql src/lib/config.js src/lib/db/schemaMigrator.js src/lib/db/snapshotManager.js src/lib/db/adapters/sqliteAdapter.js src/lib/db/adapters/supabaseAdapter.js src/lib/services/serviceHealth.js
git commit -m "feat: store expired running apps in current metrics and daily snapshots"
```

---

### Task 5: Write the figure every services cycle

**Files:**
- Modify: `src/lib/services/cloudService.js:1-5` (import), `~258` (compute), `~283` (cloudData keys)
- Test: `src/lib/services/__tests__/cloudServiceStats.test.js`

**Interfaces:**
- Consumes: `getExpiredRunning()` from Task 3.
- Produces: `cloudData.expired_running_apps`, `cloudData.expired_running_instances` (number or null).

- [ ] **Step 1: Write the failing test**

In `cloudServiceStats.test.js`, add beside the other mocks (before the `import { fetchCloudStats }` line):
```js
const mockGetExpiredRunning = vi.fn();
vi.mock('../expiredRunningService.js', () => ({
    getExpiredRunning: (...args) => mockGetExpiredRunning(...args)
}));
```
In `beforeEach`, add `mockGetExpiredRunning.mockResolvedValue(null);`. Then add a `describe` block at the end of the file (follow the existing tests' arrangement — `serve()` and the existing fill/running-apps mocks from `beforeEach`):
```js
describe('expired running apps', () => {
    it('writes the count and instances from the expired-running service', async () => {
        serve();
        mockGetExpiredRunning.mockResolvedValue({ apps: 18, instances: 21, unresolved: 0, top: [] });

        const stats = await fetchCloudStats();

        expect(stats.expired_running_apps).toBe(18);
        expect(stats.expired_running_instances).toBe(21);
    });

    it('leaves both null (stored value untouched) when unavailable', async () => {
        serve();
        mockGetExpiredRunning.mockResolvedValue(null);

        const stats = await fetchCloudStats();

        expect(stats.expired_running_apps).toBeNull();
        expect(stats.expired_running_instances).toBeNull();
    });

    it('records a real zero as 0, not null', async () => {
        serve();
        mockGetExpiredRunning.mockResolvedValue({ apps: 0, instances: 0, unresolved: 0, top: [] });

        const stats = await fetchCloudStats();

        expect(stats.expired_running_apps).toBe(0);
    });

    it('a throwing expired-running service does not fail the cloud stats', async () => {
        serve();
        mockGetExpiredRunning.mockRejectedValue(new Error('boom'));

        const stats = await fetchCloudStats();

        expect(stats._cached).toBe(false);
        expect(stats.expired_running_apps).toBeNull();
    });
});
```
If the existing happy-path tests need a fill value, `beforeEach` already provides `mockGetDeploymentFill`; check the file and reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/cloudServiceStats.test.js`
Expected: FAIL — `expected undefined to be 18`.

- [ ] **Step 3: Implement**

`cloudService.js` imports: add `import { getExpiredRunning } from './expiredRunningService.js';`

After the `const { fill } = await getDeploymentFill()...` line:
```js
        // Expired running apps (migration 031). null -> keys stay null and
        // updateCurrentMetrics() leaves the stored reading alone; a real 0 is written as 0.
        const expiredRunning = await getExpiredRunning().catch(() => null);
```
In `cloudData`, after `deployment_fill_percent: ...`:
```js
            expired_running_apps: expiredRunning?.apps ?? null,
            expired_running_instances: expiredRunning?.instances ?? null,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_TYPE=sqlite npx vitest run src/lib/services/__tests__/cloudServiceStats.test.js src/lib/services/__tests__/serviceHealth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/cloudService.js src/lib/services/__tests__/cloudServiceStats.test.js
git commit -m "feat: record expired running apps every services cycle"
```

---

### Task 6: `GET /api/apps/expired-running`

**Files:**
- Modify: `src/routes/api/analytics.js` (imports ~line 27-28; cache ~line 42; route after `/apps/deployment-fill`, ~line 299)
- Test: `src/routes/api/__tests__/expiredRunningRoute.test.js` (create)

**Interfaces:**
- Consumes: `getExpiredRunning({ ttlMs })`.
- Produces: `shapeExpiredRunning(result) -> { available:false } | { available:true, apps, instances, unresolved, graceDays, top:[{name, instances, daysExpired}] }`; the route returns that JSON.

- [ ] **Step 1: Write the failing test**

```js
// src/routes/api/__tests__/expiredRunningRoute.test.js
import { describe, it, expect } from 'vitest';
import { shapeExpiredRunning } from '../analytics.js';

describe('shapeExpiredRunning', () => {
    it('says unavailable rather than 0 when the figure could not be computed', () => {
        expect(shapeExpiredRunning(null)).toEqual({ available: false });
    });

    it('serves counts, the grace period in days and the top list without internals', () => {
        const shaped = shapeExpiredRunning({
            apps: 18, instances: 21, unresolved: 1, currentBlock: 3_012_176, computedAt: 1,
            top: [{ name: 'palworld1785555251684', instances: 1, daysExpired: 50, endBlock: 2_868_075 }]
        });
        expect(shaped).toEqual({
            available: true, apps: 18, instances: 21, unresolved: 1, graceDays: 1,
            top: [{ name: 'palworld1785555251684', instances: 1, daysExpired: 50 }]
        });
    });

    it('passes a real zero through', () => {
        expect(shapeExpiredRunning({ apps: 0, instances: 0, unresolved: 0, top: [] }))
            .toMatchObject({ available: true, apps: 0, top: [] });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DB_TYPE=sqlite npx vitest run src/routes/api/__tests__/expiredRunningRoute.test.js`
Expected: FAIL — `shapeExpiredRunning is not a function`.

- [ ] **Step 3: Implement** in `analytics.js`

Imports: add `import { getExpiredRunning } from '../../lib/services/expiredRunningService.js';` and add `EXPIRED_RUNNING_GRACE_BLOCKS, BLOCKS_PER_DAY` to the existing `../../lib/config.js` import.

After `const fillCache = createCache(READ_PATH_TTL_MS);  // issue #200`:
```js
const expiredRunningCache = createCache(READ_PATH_TTL_MS);
```

After the `/apps/deployment-fill` route:
```js
/** Response shape for /api/apps/expired-running; exported for tests. */
export function shapeExpiredRunning(result) {
    if (!result) return { available: false };
    return {
        available: true,
        apps: result.apps,
        instances: result.instances,
        unresolved: result.unresolved,
        graceDays: EXPIRED_RUNNING_GRACE_BLOCKS / BLOCKS_PER_DAY,
        top: result.top.map(({ name, instances, daysExpired }) => ({ name, instances, daysExpired }))
    };
}

/**
 * GET /api/apps/expired-running -- apps still running at least a day after their
 * subscription ended (spec 2026-10-06). The services cycle computes it every 5 minutes;
 * readers take up to two cycles of age, like deployment-fill.
 */
router.get('/apps/expired-running', async (req, res) => {
    return withDbFallback(expiredRunningCache, 'expired-running', res, async () =>
        shapeExpiredRunning(await getExpiredRunning({ ttlMs: READ_PATH_TTL_MS })));
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_TYPE=sqlite npx vitest run src/routes/api/__tests__/expiredRunningRoute.test.js src/routes/api/__tests__/analyticsComparison.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/analytics.js src/routes/api/__tests__/expiredRunningRoute.test.js
git commit -m "feat: serve expired running apps at /api/apps/expired-running"
```

---

### Task 7: "Expired running" view on the Apps card

**Files:**
- Modify: `src/lib/components/AppInstancesCard.svelte`

**Interfaces:**
- Consumes: `GET /api/apps/expired-running` (Task 6 shape); `getApiUrl`, `DASHBOARD_REFRESH_MS` from `$lib/config.js`; `refreshSignal` from `$lib/stores/refresh.js`.
- Produces: no new props — the card fetches this view's data itself, like `DecentralizationCard`'s demand view.

No component test harness exists in this repo (no `@testing-library/svelte`); this task is verified by `npm run build`, the header-smoke run and the browser check in Task 9.

- [ ] **Step 1: Script additions** — add to the imports:
```js
  import { getApiUrl, DASHBOARD_REFRESH_MS } from '$lib/config.js';
  import { refreshSignal } from '$lib/stores/refresh.js';
```
and before `function toComparison`:
```js
  // Expired running view (spec 2026-10-06): apps still on nodes a day or more after their
  // subscription ended. Fetched on first switch, then at most once per dashboard refresh
  // interval, and again when the footer's Refresh fires while this view is open.
  let view = 'apps';
  let expired = null;          // /api/apps/expired-running response when available
  let expiredLoading = false;
  let expiredFetchedAt = 0;

  async function loadExpired(force = false) {
    if (expiredLoading) return;
    if (!force && Date.now() - expiredFetchedAt < DASHBOARD_REFRESH_MS) return;
    expiredLoading = true;
    try {
      const response = await fetch(`${getApiUrl()}/api/apps/expired-running`);
      const data = response.ok ? await response.json() : null;
      expired = data?.available ? data : null;
      expiredFetchedAt = expired ? Date.now() : 0;
    } catch (err) {
      console.error('Error fetching expired running apps:', err);
      expired = null;
    } finally {
      expiredLoading = false;
    }
  }

  function showView(next) {
    view = next;
    if (next === 'expired') loadExpired();
  }

  let lastRefresh = 0;
  $: if ($refreshSignal > lastRefresh) {
    lastRefresh = $refreshSignal;
    if (view === 'expired') loadExpired(true);
  }
```

- [ ] **Step 2: Header toggle** — replace
```svelte
    <div class="card-title">Apps</div>
  </div>
```
with
```svelte
    <div class="card-title">{view === 'expired' ? 'Expired running' : 'Apps'}</div>
    <div class="view-switch" role="group" aria-label="Apps view">
      <button type="button" class:active={view === 'apps'} aria-pressed={view === 'apps'} on:click={() => showView('apps')}>Apps</button>
      <button type="button" class:active={view === 'expired'} aria-pressed={view === 'expired'} on:click={() => showView('expired')}>Expired running</button>
    </div>
  </div>
```
and add `flex-wrap: wrap;` to `.card-header` in the `<style>` block (as DecentralizationCard has), so the buttons drop below the title on a narrow card instead of squeezing it.

- [ ] **Step 3: Expired view body** — change `{#if loading}` … `{:else}` so the expired view is a branch between them:
```svelte
  {#if loading}
    <div class="card-empty-state">Loading...</div>
  {:else if view === 'expired'}
    {#if expiredLoading && !expired}
      <div class="card-empty-state">Loading...</div>
    {:else if !expired}
      <div class="card-empty-state">n/a</div>
    {:else}
      <div class="expired-headline" title="Apps still running on Flux nodes at least 24 hours after their subscription ended. End = the app's last registration or update block + the blocks paid for.">
        <div class="total-value">{formatNumber(expired.apps)} <span class="expired-unit">{expired.apps === 1 ? 'app' : 'apps'}</span></div>
        <div class="total-subtitle">{formatNumber(expired.instances)} {expired.instances === 1 ? 'instance' : 'instances'} · still on nodes ≥ 24 h after the subscription ended</div>
      </div>
      {#if expired.apps === 0}
        <div class="card-empty-state">None — every running app has a live subscription.</div>
      {:else}
        <div class="expired-section">
          <div class="expired-row expired-head" aria-hidden="true">
            <span>Longest expired</span><span>Instances</span><span>Expired</span>
          </div>
          <ul class="expired-list">
            {#each expired.top as app (app.name)}
              <li class="expired-row">
                <span class="expired-name" title={app.name}>{app.name}</span>
                <span class="expired-num">{formatNumber(app.instances)} inst</span>
                <span class="expired-num">{formatNumber(app.daysExpired)} d</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  {:else}
```
(the existing `<div class="headline-row">…` and gaming section stay inside the final `{:else}` unchanged).

- [ ] **Step 4: Styles** — append inside `<style>`:
```css
  /* Same switch as DecentralizationCard (Demand | Datacenters); overrides app.css's global
     button fill and lift. */
  .view-switch {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  .view-switch button {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    box-shadow: none;
    transform: none;
  }

  .view-switch button:hover,
  .view-switch button:focus-visible {
    background: transparent;
    color: var(--text-white);
    border-color: var(--accent-cyan);
    box-shadow: none;
    transform: none;
  }

  .view-switch button.active {
    color: var(--text-primary);
    border-color: var(--accent-cyan);
  }

  .expired-headline {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    cursor: help;
  }

  .expired-unit {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    text-shadow: none;
  }

  /* Rows styled like the Gaming list: name, then two fixed right-aligned columns so the
     instance count and the age never run together. */
  .expired-section {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .expired-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .expired-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4.5rem 3.5rem;
    align-items: center;
    gap: var(--spacing-sm);
    padding: 2px 0 2px var(--spacing-sm);
  }

  .expired-head {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .expired-head span:not(:first-child),
  .expired-num {
    text-align: right;
  }

  .expired-name {
    font-size: 0.8rem;
    color: var(--text-dim);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expired-num {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
```

- [ ] **Step 5: Build**

Run: `DB_TYPE=sqlite npm run build`
Expected: build succeeds with no new Svelte warnings for `AppInstancesCard.svelte`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/AppInstancesCard.svelte
git commit -m "feat: Expired running view on the Apps card"
```

---

### Task 8: Chart series and README

**Files:**
- Modify: `src/lib/components/Chart.svelte` (after the `deployment_fill_percent` entry, ~line 248)
- Modify: `README.md` (new `## Expired Running Apps` section immediately before `## Terminal Header`)
- Modify: `src/routes/+page.svelte:300-302` (stale "Live only… not snapshotted" comment on deployment fill — correct it while here: it IS snapshotted since #421)

- [ ] **Step 1: Chart entries** — after the `deployment_fill_percent` object:
```js
        // Expired running apps (spec 2026-10-06, migration 031): still on nodes a day or more
        // after the subscription ended. A level, so weekly/monthly average it; dropNulls --
        // days before it was recorded are a gap, never 0.
        { id: 'expired_running_apps', label: 'Expired running apps', field: 'expired_running_apps', format: 'number', dropNulls: true, group: 'Daily',
          description: 'Apps still running on Flux nodes at least 24 hours after their subscription ended. Recorded daily since October 2026.',
          emptyMessage: 'Recorded daily since October 2026 -- no readings in this period yet.' },
        { id: 'expired_running_instances', label: 'Expired running instances', field: 'expired_running_instances', format: 'number', dropNulls: true, group: 'Daily',
          description: 'How many app deployments (one per node) belong to apps whose subscription ended at least 24 hours ago. Recorded daily since October 2026.',
          emptyMessage: 'Recorded daily since October 2026 -- no readings in this period yet.' },
```

- [ ] **Step 2: README section** — insert before `## Terminal Header`:
```markdown
## Expired Running Apps

The Apps card's **Expired running** view lists apps that are still running on Flux nodes after
their subscription has ended — work the network should have stopped. It shows how many there
are, on how many nodes, and the three that ended longest ago. The count is recorded daily, so
the Historical Performance chart (Applications → *Expired running apps*) shows whether
cleanup is getting better or worse.

### How an app's end is calculated

Every app registration and update message carries the block it was mined in (`height`) and
the number of blocks paid for (`expire`; Flux's default is 22,000 when a spec omits it). Blocks
are 30 seconds, so 2,880 a day:

    end block      = height of the app's latest register/update + expire
    blocks expired = current block − end block
    days expired   = floor(blocks expired / 2,880)

The `height` and `expire` come from the app's spec in `globalappsspecifications` while Flux
still lists it (it keeps some for a while after they expire). Once the spec is gone, they come
from the app's last message on `permanentmessages?appname=<name>` — looked up once per app
and cached, since an ended app's end block never changes. A running container with no spec and
no permanent message at all is a local container that never had a subscription, and is not
counted.

### The 24-hour grace period

Containers take a while to be removed after an app ends, and the stats crawl that reports
running containers lags too. To keep normal cleanup out of the figure, an app only counts once
it is **at least 2,880 blocks (24 hours) past its end block**.

### Worked example (real data, 6 October 2026)

`palworld1785555251684`'s last message was an update at block **2,867,975** with `expire`
**100** — that is how an owner cancels an app: they set it to end 100 blocks later.

    end block      = 2,867,975 + 100       = 2,868,075
    current block  =                         3,012,176
    blocks expired = 3,012,176 − 2,868,075 = 144,101
    days expired   = floor(144,101 / 2,880) = 50

144,101 blocks is well past the 2,880-block grace period and the app was still running on one
node, so it counts: **1 app, 1 instance, 50 days expired**.

Counter-example: an app whose end block was 1,500 blocks ago (about 12.5 hours) is past its
end but still inside the grace period, so it is **not** counted yet. If it is still running
1,380 blocks later, it will be.

"Instances" counts nodes, not containers: a WordPress app running its `wp`, `mysql` and
`operator` containers on 3 nodes is 3 instances.
```

- [ ] **Step 3: Fix the stale `+page.svelte` comment** — replace the "Live only… not snapshotted" wording at lines ~300-302 with a statement that the fill is recorded daily (migration 028, #421). Read the lines first and keep the rest of the comment.

- [ ] **Step 4: Build and full test run**

Run: `DB_TYPE=sqlite npm test && DB_TYPE=sqlite npm run build`
Expected: all tests pass (including `adapterRouter.test.js`, unchanged at 103); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/Chart.svelte README.md src/routes/+page.svelte
git commit -m "docs: expired running apps in the README and chart dropdown"
```

---

### Task 9: Verification against the live network and the real page

No code unless something fails. Follow CLAUDE.md "Verification Before Claiming Done".

- [ ] **Step 1: Live figure vs an independent count.** Start the dev stack against SQLite with a scratch DB (`DB_PATH` set to a scratchpad file — never the real dev DB), wait for one services cycle, then:
  `curl -s localhost:<api-port>/api/apps/expired-running`
  Compare with a fresh run of the 2026-10-06 comparison approach (specs + running census + `permanentmessages` for the orphans, 2,880-block grace). Counts and the top 3 must match, allowing for anything that changed between the two pulls; explain any difference before continuing.

- [ ] **Step 2: Snapshot write.** Trigger the cycle (`POST /api/admin/test-services`), then confirm `current_metrics.expired_running_apps` holds the endpoint's figure; take a snapshot via the existing admin path and confirm the `daily_snapshots` row carries both columns.

- [ ] **Step 3: Header smoke.** Run `scripts/header-smoke/check-header.mjs` to completion per its README (exclusive port 3100; no branch switches or edits while it runs).

- [ ] **Step 4: Browser check (the real acceptance test).** Load the dashboard, wait for data, click **Expired running**: the title changes, real app names appear with separate instance and day columns, `aria-pressed` flips, **Apps** switches back with the original content intact. Click the footer Refresh while on the expired view and confirm a new request to `/api/apps/expired-running`. In Historical Performance → Applications, select *Expired running apps* and confirm it plots (one point on a fresh DB) or shows the empty message — never a line at 0. Check at phone width (≈375 px) that the switch wraps under the title and names ellipsize.

- [ ] **Step 5: Supabase migration.** Note in the PR that `031_expired_running.sql` must be applied on the Supabase instance(s); the adapter guard means a deploy before the migration loses nothing.

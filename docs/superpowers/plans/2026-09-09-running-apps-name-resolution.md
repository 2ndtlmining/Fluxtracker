# Running-Apps Name Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover app-census and categorization data (Total Apps, category cards, `repo_snapshots`, Top Repos carousel) after FluxOS v8.18 removed `Image` from the running-apps API, by resolving each running container's Docker name back to its app spec's `repotag` via `globalappsspecifications`.

**Architecture:** A new shared cache module (`appSpecsCache.js`) fetches and indexes `globalappsspecifications` by app name and by `component_appName`, exposing a `resolveRunningAppName()` lookup. `runningAppsProvider.js` — the single shared fetch every category service already goes through — uses it to turn a running container's `Names` into the same repotag string `categorizeImage()` and friends already expect, so none of that matching logic changes. `revenueService.js`'s existing private spec cache is refactored to reuse the shared module instead of duplicating it. `carouselService.js`'s separate running-apps fetch is folded into the shared provider.

**Tech Stack:** Node.js, Vitest, axios (via `resilientFetch.js`)

**Spec:** `docs/superpowers/specs/2026-09-09-running-apps-name-resolution-design.md`

## Global Constraints

- `config.js`'s `categorizeImage()`, `CATEGORY_EXCLUDE`, `GAMING_REPOS`/`CRYPTO_REPOS` `imageMatch`, `DISPLAY_NAME_OVERRIDES`, `CANONICAL_NAME_OVERRIDES` must not change — they already match on a repotag-shaped string.
- `RUNNING_APPS` projection changes from `apps.runningapps.Image` to `apps.runningapps.Names` (verified live: same ~500KB payload size).
- Name resolution uses only `globalappsspecifications` (~1.5MB), never `permanentmessages` (~80MB) — the latter adds negligible coverage for currently-running apps and is far too heavy for a per-cycle fetch.
- Resolution rule: strip leading `/flux` from the container name; try a direct app-name match first (legacy flat-spec apps), then split at the first `_` into `componentName` + `appName` and match that pair (compose apps) — first-`_` split is correct even when `appName` itself contains underscores, since `componentName` always comes first.
- An unresolved container name still counts toward `totalInstances`; it just doesn't add to any per-image bucket (same as an already-uncategorized image today).
- `cloudService.js`, `gamingService.js`, `cryptoService.js`, `wordpressService.js` must not change — they consume `runningAppsProvider.js`'s output as-is.

---

### Task 1: `appSpecsCache.js` — shared global-specs cache and name resolver

**Files:**
- Create: `src/lib/services/appSpecsCache.js`
- Create: `src/lib/services/__tests__/appSpecsCache.test.js`

**Interfaces:**
- Consumes: `API_ENDPOINTS.APPS` (from `config.js`, existing constant `'https://api.runonflux.io/apps'`), `resilientFetch(url, options)` (from `./resilientFetch.js`, existing — resolves to the parsed response body), `createLogger(name)` (from `../logger.js`, existing)
- Produces (used by Task 2 and Task 3):
  - `export async function ensureGlobalSpecsCache(): Promise<void>`
  - `export function getAppSpecByName(name: string): object | null`
  - `export function getAppNameByHash(hash: string): string | null`
  - `export function getAppTypeByName(name: string): 'git' | 'docker' | null`
  - `export function determineAppType(appSpec: object | null): 'git' | 'docker'`
  - `export function resolveRunningAppName(containerName: string): { appName: string, repotag: string } | null`
  - `export function clearGlobalSpecsCache(): void` (test hook)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/__tests__/appSpecsCache.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import {
    ensureGlobalSpecsCache,
    getAppSpecByName,
    getAppNameByHash,
    getAppTypeByName,
    determineAppType,
    resolveRunningAppName,
    clearGlobalSpecsCache
} from '../appSpecsCache.js';

const SAMPLE_SPECS = [
    {
        version: 8,
        name: 'FoldingAtRunOnFlux2',
        hash: 'hash-folding',
        compose: [
            { name: 'FoldingAtHome', repotag: 'runonflux/foldingathome:latest' }
        ]
    },
    {
        version: 8,
        name: '131barb1',
        hash: 'hash-131barb1',
        compose: [
            { name: 'fm1', repotag: 'earnfm/earnfm-client:latest' },
            { name: 'ps1', repotag: 'packetstream/psclient:latest' }
        ]
    },
    {
        version: 3,
        name: 'EthereumNodeLight',
        hash: 'hash-eth',
        repotag: 'ethereum/client-go:stable'
    }
];

function apiResponse(data) {
    return { data: { status: 'success', data } };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalSpecsCache();
});

describe('ensureGlobalSpecsCache', () => {
    it('fetches and indexes specs by name', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));

        await ensureGlobalSpecsCache();

        expect(getAppSpecByName('FoldingAtRunOnFlux2')).toMatchObject({ name: 'FoldingAtRunOnFlux2' });
        expect(getAppSpecByName('foldingatrunonflux2')).toBeTruthy(); // case-insensitive lookup
    });

    it('does not refetch within the TTL', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));

        await ensureGlobalSpecsCache();
        await ensureGlobalSpecsCache();
        await ensureGlobalSpecsCache();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

describe('getAppNameByHash / getAppTypeByName', () => {
    it('resolves hash to name and name to git/docker type', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));
        await ensureGlobalSpecsCache();

        expect(getAppNameByHash('hash-eth')).toBe('EthereumNodeLight');
        expect(getAppNameByHash('no-such-hash')).toBeNull();
        expect(getAppTypeByName('EthereumNodeLight')).toBe('docker');
    });
});

describe('determineAppType', () => {
    it('detects git apps via runonflux/orbit repotag in compose', () => {
        const spec = { compose: [{ repotag: 'runonflux/orbit:latest' }] };
        expect(determineAppType(spec)).toBe('git');
    });

    it('detects git apps via flat repotag (legacy format)', () => {
        const spec = { repotag: 'runonflux/orbit:latest' };
        expect(determineAppType(spec)).toBe('git');
    });

    it('defaults to docker for anything else, including null', () => {
        expect(determineAppType({ compose: [{ repotag: 'nginx:latest' }] })).toBe('docker');
        expect(determineAppType(null)).toBe('docker');
    });
});

describe('resolveRunningAppName', () => {
    beforeEach(async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));
        await ensureGlobalSpecsCache();
    });

    it('resolves a compose app from "/flux<component>_<appName>"', () => {
        const resolved = resolveRunningAppName('/fluxFoldingAtHome_FoldingAtRunOnFlux2');
        expect(resolved).toEqual({ appName: 'FoldingAtRunOnFlux2', repotag: 'runonflux/foldingathome:latest' });
    });

    it('resolves the correct component when an app has several', () => {
        expect(resolveRunningAppName('/fluxfm1_131barb1'))
            .toEqual({ appName: '131barb1', repotag: 'earnfm/earnfm-client:latest' });
        expect(resolveRunningAppName('/fluxps1_131barb1'))
            .toEqual({ appName: '131barb1', repotag: 'packetstream/psclient:latest' });
    });

    it('resolves a legacy flat-spec app with no component prefix', () => {
        expect(resolveRunningAppName('/fluxEthereumNodeLight'))
            .toEqual({ appName: 'EthereumNodeLight', repotag: 'ethereum/client-go:stable' });
    });

    it('returns null for a container name with no matching spec', () => {
        expect(resolveRunningAppName('/fluxcloudgit_bsserver')).toBeNull();
    });

    it('returns null for empty or missing input', () => {
        expect(resolveRunningAppName('')).toBeNull();
        expect(resolveRunningAppName(null)).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/__tests__/appSpecsCache.test.js`
Expected: FAIL — `Cannot find module '../appSpecsCache.js'` (file doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Create `src/lib/services/appSpecsCache.js`:

```javascript
// src/lib/services/appSpecsCache.js
//
// Shared cache of current app specs from `globalappsspecifications`, indexed for two
// lookups: hash -> name (used by revenueService for historical tx app-name lookup) and
// container-name -> repotag (used by runningAppsProvider to recover categorization after
// FluxOS v8.18 dropped `Image` from the running-apps census). See
// docs/superpowers/specs/2026-09-09-running-apps-name-resolution-design.md.
//
// Deliberately does NOT touch `permanentmessages` — that payload is ~80MB vs this one's
// ~1.5MB, and only adds coverage for apps no longer in globalappsspecifications (revenueService
// already handles that case separately for historical transactions).

import { API_ENDPOINTS } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';

const log = createLogger('appSpecsCache');

const globalSpecsCache = {
    map: new Map(),            // hash -> name
    typeMap: new Map(),        // name (lowercase) -> 'git' | 'docker'
    specByName: new Map(),     // name (lowercase) -> full spec object
    componentIndex: new Map(), // "componentName_appName" (lowercase) -> repotag
    lastFetched: 0,
    TTL: 60 * 60 * 1000 // 1 hour
};

/**
 * Determine if an app is git-based (runonflux/Orbit) or docker-based.
 * Works with both old single-component and new compose-array spec formats.
 */
export function determineAppType(appSpec) {
    if (!appSpec) return 'docker';

    if (Array.isArray(appSpec.compose)) {
        const isGit = appSpec.compose.some(
            c => c.repotag && c.repotag.toLowerCase().includes('runonflux/orbit')
        );
        return isGit ? 'git' : 'docker';
    }

    if (appSpec.repotag && appSpec.repotag.toLowerCase().includes('runonflux/orbit')) {
        return 'git';
    }

    return 'docker';
}

async function fetchGlobalSpecs() {
    try {
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/globalappsspecifications`, {
            timeout: 30000,
            breakerKey: 'global-apps-specs'
        });

        if (body && body.status === 'success' && Array.isArray(body.data)) {
            globalSpecsCache.map.clear();
            globalSpecsCache.typeMap.clear();
            globalSpecsCache.specByName.clear();
            globalSpecsCache.componentIndex.clear();

            for (const appSpec of body.data) {
                const name = appSpec.name;
                if (!name) continue;
                const lowerName = name.toLowerCase();

                globalSpecsCache.specByName.set(lowerName, appSpec);
                globalSpecsCache.typeMap.set(lowerName, determineAppType(appSpec));
                if (appSpec.hash) globalSpecsCache.map.set(appSpec.hash, name);

                if (Array.isArray(appSpec.compose)) {
                    for (const component of appSpec.compose) {
                        if (component.name && component.repotag) {
                            globalSpecsCache.componentIndex.set(
                                `${component.name.toLowerCase()}_${lowerName}`,
                                component.repotag
                            );
                        }
                    }
                }
            }

            globalSpecsCache.lastFetched = Date.now();
            log.info({ count: globalSpecsCache.specByName.size }, 'Loaded %d app specs', globalSpecsCache.specByName.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch global specs');
    }
}

/** Refreshes the cache if stale or empty. No-op otherwise. */
export async function ensureGlobalSpecsCache() {
    const age = Date.now() - globalSpecsCache.lastFetched;
    if (age > globalSpecsCache.TTL || globalSpecsCache.specByName.size === 0) {
        await fetchGlobalSpecs();
    }
}

export function getAppSpecByName(name) {
    if (!name) return null;
    return globalSpecsCache.specByName.get(name.toLowerCase()) || null;
}

export function getAppNameByHash(hash) {
    if (!hash) return null;
    return globalSpecsCache.map.get(hash) || null;
}

export function getAppTypeByName(name) {
    if (!name) return null;
    return globalSpecsCache.typeMap.get(name.toLowerCase()) || null;
}

/**
 * Resolve a running container's Docker name (e.g. "/fluxFoldingAtHome_FoldingAtRunOnFlux2",
 * or "/fluxEthereumNodeLight" for a legacy flat-spec app with no component) to the repotag
 * of the specific app+component it belongs to.
 *
 * Returns null when the app's spec isn't in globalappsspecifications (private/enterprise
 * apps, or a spec that's since expired) — callers should still count the instance toward
 * their totals, just not toward a per-image bucket.
 */
export function resolveRunningAppName(containerName) {
    if (!containerName) return null;
    const stripped = containerName.replace(/^\//, '').replace(/^flux/, '');
    if (!stripped) return null;

    // Legacy flat-spec app: container name is the bare app name, no component prefix.
    const directSpec = getAppSpecByName(stripped);
    if (directSpec) {
        const repotag = Array.isArray(directSpec.compose)
            ? directSpec.compose[0]?.repotag
            : directSpec.repotag;
        if (repotag) return { appName: directSpec.name, repotag };
    }

    // Compose app: "<componentName>_<appName>" — split at the FIRST underscore, since
    // componentName always comes first and appName may itself contain underscores.
    const underscoreIndex = stripped.indexOf('_');
    if (underscoreIndex > 0) {
        const componentName = stripped.slice(0, underscoreIndex);
        const appName = stripped.slice(underscoreIndex + 1);
        const spec = getAppSpecByName(appName);
        if (spec) {
            const repotag = globalSpecsCache.componentIndex.get(
                `${componentName.toLowerCase()}_${appName.toLowerCase()}`
            );
            if (repotag) return { appName: spec.name, repotag };
        }
    }

    return null;
}

/** Test hook — drops the cached payload. */
export function clearGlobalSpecsCache() {
    globalSpecsCache.map.clear();
    globalSpecsCache.typeMap.clear();
    globalSpecsCache.specByName.clear();
    globalSpecsCache.componentIndex.clear();
    globalSpecsCache.lastFetched = 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/__tests__/appSpecsCache.test.js`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/appSpecsCache.js src/lib/services/__tests__/appSpecsCache.test.js
git commit -m "feat: add shared app-specs cache with running-container name resolution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 2: Wire `runningAppsProvider.js` to resolve `Names` via the new cache

**Files:**
- Modify: `src/lib/config.js:110` and `src/lib/config.js:113`
- Modify: `src/lib/services/runningAppsProvider.js`
- Modify: `src/lib/services/__tests__/runningAppsProvider.test.js`

**Interfaces:**
- Consumes: `ensureGlobalSpecsCache()`, `resolveRunningAppName()` (from Task 1's `appSpecsCache.js`)
- Produces: `getRunningApps()`'s returned `imageCounts` is now keyed by resolved `repotag` strings instead of raw `Image` strings — same `Map<string, number>` shape, no change to callers (`countByCategory`, `countConfiguredRepos`, `toRepoCounts` are untouched)

- [ ] **Step 1: Update the config endpoint**

In `src/lib/config.js`, change:

```javascript
    RUNNING_APPS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
    
    // WordPress API - UPDATED to use running apps endpoint
    WORDPRESS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
```

to:

```javascript
    RUNNING_APPS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Names',
    
    // WordPress API - UPDATED to use running apps endpoint
    WORDPRESS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Names',
```

- [ ] **Step 2: Rewrite the provider test fixtures for `Names` and mock the resolver**

Replace `src/lib/services/__tests__/runningAppsProvider.test.js` in full:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Shared running-apps payload.
 *
 * gaming/crypto/wordpress/cloud each used to download this ~450KB response separately every
 * cycle, and each counted category totals its own way — which is why the metrics card said
 * Gaming 309 while the gaming category card said 343.
 *
 * FluxOS v8.18 dropped `Image` from this endpoint; it now returns `Names` (the Docker
 * container name), which runningAppsProvider resolves back to a repotag via
 * appSpecsCache.resolveRunningAppName(). These tests mock that resolver directly rather than
 * reconstructing globalappsspecifications fixtures — the resolution logic itself is covered
 * by appSpecsCache.test.js.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn().mockResolvedValue(undefined),
    resolveRunningAppName: vi.fn()
}));

import axios from 'axios';
import { resolveRunningAppName } from '../appSpecsCache.js';
import {
    getRunningApps,
    getCachedRunningApps,
    clearRunningAppsCache,
    toRepoCounts,
    countByCategory,
    countConfiguredRepos
} from '../runningAppsProvider.js';
import { GAMING_REPOS } from '../../config.js';

/** Build a stats.runonflux.io style response from containerName -> instance count. */
function apiResponse(nameCounts) {
    const nodes = [];
    for (const [name, count] of Object.entries(nameCounts)) {
        for (let i = 0; i < count; i++) {
            nodes.push({ apps: { runningapps: [{ Names: [name] }] } });
        }
    }
    return { data: { data: nodes } };
}

/** Wires resolveRunningAppName's mock to a fixed containerName -> repotag map. */
function mockResolution(nameToRepotag) {
    resolveRunningAppName.mockImplementation(name => {
        const repotag = nameToRepotag[name];
        return repotag ? { appName: name, repotag } : null;
    });
}

const LIVE_SAMPLE_NAMES = {
    '/fluxPalworld_pal1': 'thijsvanloef/palworld-server-docker:latest',
    '/fluxMinecraft_mc1': 'itzg/minecraft-server:latest',
    '/fluxBedrock_mc2': 'itzg/minecraft-bedrock-server:latest',
    '/fluxWebsite_mc3': 'runonflux/minecraft-server-website:latest',
    '/fluxPresearch_ps1': 'presearch/node:latest',
    '/fluxWp_wp1': 'runonflux/wp-nginx:latest',
    '/fluxDb_db1': 'mysql:8.3.0'
};

const LIVE_SAMPLE_COUNTS = {
    '/fluxPalworld_pal1': 6,
    '/fluxMinecraft_mc1': 4,
    '/fluxBedrock_mc2': 2,
    '/fluxWebsite_mc3': 3,
    '/fluxPresearch_ps1': 5,
    '/fluxWp_wp1': 2,
    '/fluxDb_db1': 7
};

beforeEach(() => {
    vi.clearAllMocks();
    clearRunningAppsCache();
    mockResolution(LIVE_SAMPLE_NAMES);
});

describe('getRunningApps', () => {
    it('aggregates instances per resolved repotag across nodes', async () => {
        mockResolution({ '/fluxa_1': 'a/b:1', '/fluxc_2': 'c/d:2' });
        axios.get.mockResolvedValue(apiResponse({ '/fluxa_1': 3, '/fluxc_2': 2 }));

        const result = await getRunningApps();

        expect(result.imageCounts.get('a/b:1')).toBe(3);
        expect(result.imageCounts.get('c/d:2')).toBe(2);
        expect(result.totalInstances).toBe(5);
    });

    it('counts an unresolved container toward totalInstances but not any image bucket', async () => {
        mockResolution({}); // nothing resolves
        axios.get.mockResolvedValue(apiResponse({ '/fluxcloudgit_bsserver': 2 }));

        const result = await getRunningApps();

        expect(result.totalInstances).toBe(2);
        expect(result.imageCounts.size).toBe(0);
    });

    it('serves the cache instead of refetching within the TTL', async () => {
        axios.get.mockResolvedValue(apiResponse({ '/fluxa_1': 1 }));

        await getRunningApps();
        await getRunningApps();
        await getRunningApps();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent callers into a single fetch', async () => {
        // This is the case that matters: four services all run in the same cycle
        axios.get.mockResolvedValue(apiResponse({ '/fluxa_1': 1 }));

        await Promise.all([getRunningApps(), getRunningApps(), getRunningApps(), getRunningApps()]);

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('refetches when force is set', async () => {
        axios.get.mockResolvedValue(apiResponse({ '/fluxa_1': 1 }));

        await getRunningApps();
        await getRunningApps({ force: true });

        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('retries then throws when every attempt fails', async () => {
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('network down'));

        const pending = expect(getRunningApps()).rejects.toThrow('network down');
        await vi.runAllTimersAsync();   // skip the retry backoff
        await pending;

        expect(axios.get).toHaveBeenCalledTimes(3);
        expect(getCachedRunningApps()).toBeNull();
        vi.useRealTimers();
    });

    it('rejects an empty payload rather than reporting zero instances', async () => {
        vi.useFakeTimers();
        axios.get.mockResolvedValue({ data: { data: [] } });

        const pending = expect(getRunningApps()).rejects.toThrow(/empty or invalid/);
        await vi.runAllTimersAsync();
        await pending;

        vi.useRealTimers();
    });
});

describe('countByCategory', () => {
    it('counts every gaming image, not just the configured ones', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE_COUNTS));
        const runningApps = await getRunningApps();

        // palworld 6 + minecraft 4 + bedrock 2 = 12. The website is excluded.
        expect(countByCategory(runningApps, 'gaming')).toBe(12);
    });

    it('excludes companion websites from the total', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE_COUNTS));
        const runningApps = await getRunningApps();

        expect(countByCategory(runningApps, 'gaming')).not.toBe(15);
    });

    it('counts crypto and wordpress', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE_COUNTS));
        const runningApps = await getRunningApps();

        expect(countByCategory(runningApps, 'crypto')).toBe(5);
        expect(countByCategory(runningApps, 'wordpress')).toBe(2);
    });
});

describe('countConfiguredRepos', () => {
    it('sums every image a configured repo matches', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE_COUNTS));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);

        expect(counts.gaming_palworld).toBe(6);
        expect(counts.gaming_minecraft).toBe(6); // java 4 + bedrock 2
        expect(counts.gaming_valheim).toBe(0);
    });

    it('returns a zeroed entry for every configured repo', async () => {
        mockResolution({ '/fluxDb_db1': 'mysql:8.3.0' });
        axios.get.mockResolvedValue(apiResponse({ '/fluxDb_db1': 1 }));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);

        for (const repo of GAMING_REPOS) {
            expect(counts[repo.dbKey]).toBe(0);
        }
    });

    it('counts an image toward at most one configured repo', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE_COUNTS));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);
        const summed = Object.values(counts).reduce((a, b) => a + b, 0);

        expect(summed).toBe(12);
    });
});

describe('toRepoCounts', () => {
    it('produces the plain object createRepoSnapshots expects', async () => {
        mockResolution({ '/fluxa_1': 'a/b:1', '/fluxc_2': 'c/d:2' });
        axios.get.mockResolvedValue(apiResponse({ '/fluxa_1': 3, '/fluxc_2': 2 }));
        const runningApps = await getRunningApps();

        expect(toRepoCounts(runningApps)).toEqual({ 'a/b:1': 3, 'c/d:2': 2 });
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/__tests__/runningAppsProvider.test.js`
Expected: FAIL — the implementation still reads `app.Image` and never calls `resolveRunningAppName`, so `imageCounts` stays empty and assertions on resolved repotags fail.

- [ ] **Step 4: Update the implementation**

In `src/lib/services/runningAppsProvider.js`, change the import block:

```javascript
import { API_ENDPOINTS, categorizeImage } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';
```

to:

```javascript
import { API_ENDPOINTS, categorizeImage } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, resolveRunningAppName } from './appSpecsCache.js';
import { createLogger } from '../logger.js';
```

Then replace `fetchRunningApps()`:

```javascript
async function fetchRunningApps({ retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS } = {}) {
    const body = await resilientFetch(API_ENDPOINTS.RUNNING_APPS, {
        timeout: 15000,
        retries,
        delayMs,
        breakerKey: 'running-apps'
    });

    if (body?.status === 'error' && body.data) {
        throw new Error(`API Error: ${body.data.name} - ${body.data.message}`);
    }

    const nodes = body?.data;
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('RUNNING_APPS returned empty or invalid data');
    }

    // Key on the full image string (tag included) — that's what repo_snapshots stores,
    // and the read queries strip the tag when they group.
    const imageCounts = new Map();
    let totalInstances = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        if (!Array.isArray(runningApps)) continue;

        for (const app of runningApps) {
            const image = app?.Image || '';
            if (!image) continue;
            imageCounts.set(image, (imageCounts.get(image) || 0) + 1);
            totalInstances++;
        }
    }

    log.info(
        { nodes: nodes.length, uniqueImages: imageCounts.size, totalInstances },
        'Running apps fetched: %d instances across %d images',
        totalInstances,
        imageCounts.size
    );

    return { imageCounts, totalInstances, nodeCount: nodes.length, fetchedAt: Date.now() };
}
```

with:

```javascript
async function fetchRunningApps({ retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS } = {}) {
    const [body] = await Promise.all([
        resilientFetch(API_ENDPOINTS.RUNNING_APPS, {
            timeout: 15000,
            retries,
            delayMs,
            breakerKey: 'running-apps'
        }),
        ensureGlobalSpecsCache()
    ]);

    if (body?.status === 'error' && body.data) {
        throw new Error(`API Error: ${body.data.name} - ${body.data.message}`);
    }

    const nodes = body?.data;
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('RUNNING_APPS returned empty or invalid data');
    }

    // FluxOS v8.18 dropped `Image` from this endpoint; each entry now carries `Names`
    // (the Docker container name), which we resolve back to a repotag via
    // appSpecsCache so categorizeImage() and friends keep working unchanged. An
    // unresolved name (spec not in globalappsspecifications — private/enterprise apps,
    // mostly) still counts toward totalInstances, just not toward any image bucket.
    const imageCounts = new Map();
    let totalInstances = 0;
    let unresolvedCount = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        if (!Array.isArray(runningApps)) continue;

        for (const app of runningApps) {
            const containerName = app?.Names?.[0];
            if (!containerName) continue;
            totalInstances++;

            const resolved = resolveRunningAppName(containerName);
            if (!resolved) {
                unresolvedCount++;
                continue;
            }
            imageCounts.set(resolved.repotag, (imageCounts.get(resolved.repotag) || 0) + 1);
        }
    }

    log.info(
        { nodes: nodes.length, uniqueImages: imageCounts.size, totalInstances, unresolvedCount },
        'Running apps fetched: %d instances across %d images (%d unresolved)',
        totalInstances,
        imageCounts.size,
        unresolvedCount
    );

    return { imageCounts, totalInstances, nodeCount: nodes.length, fetchedAt: Date.now() };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/__tests__/runningAppsProvider.test.js`
Expected: PASS (all tests green)

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — `categorization.test.js` and every other suite unaffected (they don't import `runningAppsProvider.js`)

- [ ] **Step 7: Commit**

```bash
git add src/lib/config.js src/lib/services/runningAppsProvider.js src/lib/services/__tests__/runningAppsProvider.test.js
git commit -m "fix: resolve running-app Names to repotags after FluxOS v8.18 dropped Image

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 3: Refactor `revenueService.js` to reuse the shared spec cache

**Files:**
- Modify: `src/lib/services/revenueService.js:1-24` (imports)
- Modify: `src/lib/services/revenueService.js:301-407` (cache definitions + fetch/ensure functions)
- Modify: `src/lib/services/revenueService.js:438-451` (`lookupAppName` / `lookupAppType`)

**Interfaces:**
- Consumes: `ensureGlobalSpecsCache`, `getAppNameByHash`, `getAppTypeByName`, `determineAppType` (from Task 1's `appSpecsCache.js`)
- Produces: `lookupAppName(hash)` and `lookupAppType(appName)` keep their exact existing signatures and behavior — this task is a pure refactor, not a behavior change. No test file exists for `revenueService.js`; correctness is verified by the full suite staying green plus a manual read-through in Step 3.

- [ ] **Step 1: Update imports**

In `src/lib/services/revenueService.js`, change:

```javascript
import { API_ENDPOINTS, TARGET_ADDRESSES, EXCLUDED_TRANSACTIONS, REVENUE_SYNC } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';
```

to:

```javascript
import { API_ENDPOINTS, TARGET_ADDRESSES, EXCLUDED_TRANSACTIONS, REVENUE_SYNC } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, getAppNameByHash, getAppTypeByName, determineAppType } from './appSpecsCache.js';
import { createLogger } from '../logger.js';
```

- [ ] **Step 2: Remove the duplicated global-specs cache and rewire `ensurePermanentMessagesCache`**

Replace this block (currently lines 305-407):

```javascript
const permanentMessagesCache = {
    map: new Map(),      // hash -> name
    typeMap: new Map(),  // name (lowercase) -> 'git' | 'docker'
    lastFetched: 0,
    TTL: 60 * 60 * 1000  // 1 hour
};

// Secondary fallback: globalappsspecifications (hash -> name + type)
const globalSpecsCache = {
    map: new Map(),      // hash -> name
    typeMap: new Map(),  // name (lowercase) -> 'git' | 'docker'
    lastFetched: 0,
    TTL: 60 * 60 * 1000
};

async function fetchGlobalSpecs() {
    try {
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/globalappsspecifications`, {
            timeout: 30000,
            breakerKey: 'global-apps-specs'
        });
        if (body && body.status === 'success' && Array.isArray(body.data)) {
            globalSpecsCache.map.clear();
            globalSpecsCache.typeMap.clear();
            for (const appSpec of body.data) {
                const hash = appSpec.hash;
                const name = appSpec.name;
                if (hash && name) {
                    globalSpecsCache.map.set(hash, name);
                    globalSpecsCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            globalSpecsCache.lastFetched = Date.now();
            log.info({ count: globalSpecsCache.map.size }, 'Loaded %d app names from global specs', globalSpecsCache.map.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch global specs');
    }
}

/**
 * Determine if an app is git-based (runonflux/Orbit) or docker-based.
 * Works with both old single-component and new compose-array spec formats.
 */
function determineAppType(appSpec) {
    if (!appSpec) return 'docker';

    // New compose format: array of components each with a repotag
    if (Array.isArray(appSpec.compose)) {
        const isGit = appSpec.compose.some(
            c => c.repotag && c.repotag.toLowerCase().includes('runonflux/orbit')
        );
        return isGit ? 'git' : 'docker';
    }

    // Old single-component format: repotag directly on spec
    if (appSpec.repotag && appSpec.repotag.toLowerCase().includes('runonflux/orbit')) {
        return 'git';
    }

    return 'docker';
}

async function fetchPermanentMessages() {
    try {
        log.info('Fetching permanent messages for app name lookup');
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/permanentmessages`, {
            timeout: 30000,
            breakerKey: 'permanent-messages'
        });

        if (body && body.status === 'success' && Array.isArray(body.data)) {
            permanentMessagesCache.map.clear();
            permanentMessagesCache.typeMap.clear();
            for (const msg of body.data) {
                const hash = msg.hash;
                const appSpec = msg.zelAppSpecification || msg.appSpecifications;
                const name = appSpec?.name || msg.name;
                if (hash && name) {
                    permanentMessagesCache.map.set(hash, name);
                    permanentMessagesCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            permanentMessagesCache.lastFetched = Date.now();
            log.info({ count: permanentMessagesCache.map.size }, 'Loaded %d app names from permanent messages', permanentMessagesCache.map.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch permanent messages');
    }
}

async function ensurePermanentMessagesCache() {
    const pmAge = Date.now() - permanentMessagesCache.lastFetched;
    const gsAge = Date.now() - globalSpecsCache.lastFetched;
    const fetches = [];
    if (pmAge > permanentMessagesCache.TTL || permanentMessagesCache.map.size === 0) {
        fetches.push(fetchPermanentMessages());
    }
    if (gsAge > globalSpecsCache.TTL || globalSpecsCache.map.size === 0) {
        fetches.push(fetchGlobalSpecs());
    }
    if (fetches.length > 0) await Promise.all(fetches);
}
```

with:

```javascript
const permanentMessagesCache = {
    map: new Map(),      // hash -> name
    typeMap: new Map(),  // name (lowercase) -> 'git' | 'docker'
    lastFetched: 0,
    TTL: 60 * 60 * 1000  // 1 hour
};

async function fetchPermanentMessages() {
    try {
        log.info('Fetching permanent messages for app name lookup');
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/permanentmessages`, {
            timeout: 30000,
            breakerKey: 'permanent-messages'
        });

        if (body && body.status === 'success' && Array.isArray(body.data)) {
            permanentMessagesCache.map.clear();
            permanentMessagesCache.typeMap.clear();
            for (const msg of body.data) {
                const hash = msg.hash;
                const appSpec = msg.zelAppSpecification || msg.appSpecifications;
                const name = appSpec?.name || msg.name;
                if (hash && name) {
                    permanentMessagesCache.map.set(hash, name);
                    permanentMessagesCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            permanentMessagesCache.lastFetched = Date.now();
            log.info({ count: permanentMessagesCache.map.size }, 'Loaded %d app names from permanent messages', permanentMessagesCache.map.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch permanent messages');
    }
}

// The globalappsspecifications half of this cache now lives in appSpecsCache.js, shared
// with runningAppsProvider.js. permanentMessages stays here — it's only needed for
// historical/undeployed-app transaction lookups, not live categorization.
async function ensurePermanentMessagesCache() {
    const pmAge = Date.now() - permanentMessagesCache.lastFetched;
    const fetches = [ensureGlobalSpecsCache()];
    if (pmAge > permanentMessagesCache.TTL || permanentMessagesCache.map.size === 0) {
        fetches.push(fetchPermanentMessages());
    }
    await Promise.all(fetches);
}
```

- [ ] **Step 3: Update `lookupAppName` and `lookupAppType`**

Replace:

```javascript
/**
 * Look up app name from hash — permanentMessages first, globalSpecs as fallback
 */
function lookupAppName(hash) {
    if (!hash) return null;
    return permanentMessagesCache.map.get(hash) || globalSpecsCache.map.get(hash) || null;
}

/**
 * Look up app type (git/docker) by app name
 */
function lookupAppType(appName) {
    if (!appName) return null;
    return permanentMessagesCache.typeMap.get(appName.toLowerCase())
        || globalSpecsCache.typeMap.get(appName.toLowerCase())
        || null;
}
```

with:

```javascript
/**
 * Look up app name from hash — permanentMessages first, globalSpecs (shared cache) as fallback
 */
function lookupAppName(hash) {
    if (!hash) return null;
    return permanentMessagesCache.map.get(hash) || getAppNameByHash(hash) || null;
}

/**
 * Look up app type (git/docker) by app name
 */
function lookupAppType(appName) {
    if (!appName) return null;
    return permanentMessagesCache.typeMap.get(appName.toLowerCase())
        || getAppTypeByName(appName)
        || null;
}
```

- [ ] **Step 4: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — no test file exercises `revenueService.js`'s internals directly, so this confirms nothing else broke; the module still parses and every other suite stays green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/revenueService.js
git commit -m "refactor: revenueService reuses the shared appSpecsCache for globalappsspecifications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 4: Fold `carouselService.fetchTopApps` into the shared provider

**Files:**
- Modify: `src/lib/services/carouselService.js:1-7` (imports)
- Modify: `src/lib/services/carouselService.js:224-288` (`fetchTopApps`)
- Create: `src/lib/services/__tests__/carouselTopApps.test.js`

**Interfaces:**
- Consumes: `getRunningApps()` (from `runningAppsProvider.js`, existing — returns `{ imageCounts: Map<string, number>, totalInstances, nodeCount, fetchedAt }`)
- Produces: `fetchTopApps()`'s return shape is unchanged — `Array<{ type, rank, label, name, value, unit }>`, still deduped by image-without-tag, sorted descending, capped at 10

- [ ] **Step 1: Write the failing test**

Create `src/lib/services/__tests__/carouselTopApps.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: (...args) => mockGetRunningApps(...args)
}));

vi.mock('../resilientFetch.js', () => ({
    resilientFetch: vi.fn()
}));

import { fetchTopApps } from '../carouselService.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchTopApps', () => {
    it('groups by image-without-tag, sums counts, sorts descending', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['itzg/minecraft-server:latest', 4],
                ['itzg/minecraft-server:1.20', 2], // same image, different tag — should merge
                ['presearch/node:latest', 5]
            ])
        });

        const result = await fetchTopApps();

        expect(result[0]).toMatchObject({ name: 'itzg/minecraft-server', value: 6, rank: 1 });
        expect(result[1]).toMatchObject({ name: 'presearch/node', value: 5, rank: 2 });
    });

    it('excludes watchtower', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['containrrr/watchtower:latest', 999],
                ['presearch/node:latest', 5]
            ])
        });

        const result = await fetchTopApps();

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('presearch/node');
    });

    it('caps at 10 entries', async () => {
        const entries = Array.from({ length: 15 }, (_, i) => [`repo${i}/image:latest`, 15 - i]);
        mockGetRunningApps.mockResolvedValue({ imageCounts: new Map(entries) });

        const result = await fetchTopApps();

        expect(result).toHaveLength(10);
        expect(result[0].name).toBe('repo0/image');
    });

    it('returns an empty array when the provider throws', async () => {
        mockGetRunningApps.mockRejectedValue(new Error('network down'));

        const result = await fetchTopApps();

        expect(result).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/__tests__/carouselTopApps.test.js`
Expected: FAIL — `fetchTopApps` is not exported from `carouselService.js` yet (it's currently a private, unexported function)

- [ ] **Step 3: Update the implementation**

In `src/lib/services/carouselService.js`, change the import block:

```javascript
// flux-performance-dashboard/src/lib/services/carouselService.js

import { API_ENDPOINTS, CAROUSEL_CONFIG } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';
```

to:

```javascript
// flux-performance-dashboard/src/lib/services/carouselService.js

import { API_ENDPOINTS, CAROUSEL_CONFIG } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { getRunningApps } from './runningAppsProvider.js';
import { createLogger } from '../logger.js';
```

Then replace `fetchTopApps` (currently `async function fetchTopApps() {` through its closing `}`, lines 224-288):

```javascript
/**
 * Fetch top 10 running apps
 */
async function fetchTopApps() {
    try {
        const body = await resilientFetch(API_ENDPOINTS.RUNNING_APPS, { timeout: 15000, breakerKey: 'running-apps' });

        // Check for API error response
        if (body && body.status === 'error' && body.data) {
            throw new Error(`API Error: ${body.data.message}`);
        }

        const appsData = body?.data;
        
        if (!Array.isArray(appsData)) {
            throw new Error('Invalid data structure received from apps API');
        }
        
        // Count all running images across all nodes
        const imageCounts = {};
        
        appsData.forEach(node => {
            if (node.apps && node.apps.runningapps) {
                node.apps.runningapps.forEach(app => {
                    const image = app.Image || '';
                    
                    if (!image) return;
                    
                    // Skip excluded images
                    const isExcluded = EXCLUDED_IMAGES.some(excluded => 
                        image.toLowerCase().includes(excluded.toLowerCase())
                    );
                    if (isExcluded) return;
                    
                    const imageWithoutTag = image.split(':')[0];
                    
                    if (!imageCounts[imageWithoutTag]) {
                        imageCounts[imageWithoutTag] = {
                            name: imageWithoutTag,
                            count: 0
                        };
                    }
                    
                    imageCounts[imageWithoutTag].count++;
                });
            }
        });
        
        // Convert to array, sort, and take top 10
        const topApps = Object.values(imageCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map((app, index) => ({
                type: 'app',
                rank: index + 1,
                label: `#${index + 1} App`,
                name: app.name,
                value: app.count,
                unit: 'instances'
            }));
        
        return topApps;
        
    } catch (error) {
        log.error({ err: error }, 'Error fetching top apps');
        return [];
    }
}
```

with:

```javascript
/**
 * Fetch top 10 running apps.
 *
 * Reuses runningAppsProvider's shared per-cycle fetch instead of hitting RUNNING_APPS
 * separately — this used to duplicate the ~450KB download every cycle.
 */
export async function fetchTopApps() {
    try {
        const runningApps = await getRunningApps();

        // Group by image-without-tag, since gaming/crypto category images ship several
        // tagged variants (e.g. Minecraft Java vs a pinned version).
        const imageCounts = {};

        for (const [image, count] of runningApps.imageCounts) {
            const isExcluded = EXCLUDED_IMAGES.some(excluded =>
                image.toLowerCase().includes(excluded.toLowerCase())
            );
            if (isExcluded) continue;

            const imageWithoutTag = image.split(':')[0];

            if (!imageCounts[imageWithoutTag]) {
                imageCounts[imageWithoutTag] = { name: imageWithoutTag, count: 0 };
            }
            imageCounts[imageWithoutTag].count += count;
        }

        // Convert to array, sort, and take top 10
        const topApps = Object.values(imageCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map((app, index) => ({
                type: 'app',
                rank: index + 1,
                label: `#${index + 1} App`,
                name: app.name,
                value: app.count,
                unit: 'instances'
            }));

        return topApps;

    } catch (error) {
        log.error({ err: error }, 'Error fetching top apps');
        return [];
    }
}
```

(`fetchTopApps` changes from a private function to a named export — this is required so `carouselTopApps.test.js` can import it directly. Its one existing caller inside this same file keeps working unchanged, since it's called by unqualified name within the module either way.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/__tests__/carouselTopApps.test.js`
Expected: PASS (all tests green)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — including `carouselSnapshot.test.js`, which doesn't touch `fetchTopApps`

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/carouselService.js src/lib/services/__tests__/carouselTopApps.test.js
git commit -m "refactor: carouselService.fetchTopApps reuses the shared running-apps provider

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

---

### Task 5: Full-suite verification and build

**Files:** none (verification only)

**Interfaces:** none — this task produces no new code, only confirms Tasks 1-4 integrate cleanly.

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS — every suite green, including `categorization.test.js` (untouched), `appSpecsCache.test.js`, `runningAppsProvider.test.js`, `carouselTopApps.test.js`, and `carouselSnapshot.test.js`

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: build completes with no errors (catches any stray import/export mismatch across the four touched files)

- [ ] **Step 3: Commit (only if Steps 1-2 required any fix-ups)**

If Steps 1-2 passed cleanly with no changes needed, skip this step — there's nothing to commit.
If a fix was needed, commit it:

```bash
git add -A
git commit -m "fix: address integration issue found in full-suite verification

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KGkhny5TJMSVfiP6gdFvTt"
```

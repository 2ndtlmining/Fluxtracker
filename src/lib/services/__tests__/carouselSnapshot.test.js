import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getFluxCloudSnapshot — the live Flux Cloud readings behind the daily KPI:
 * the apps deployed in the last 24 hours and the apps expiring within them.
 * Raw registry entries (deduping happens in dedupeAppsByName/getFluxCloudActivity,
 * below); `cached` flags tell a failed on-demand fetch apart from a genuine "none".
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import { getFluxCloudSnapshot, getFluxCloudActivity, dedupeAppsByName } from '../carouselService.js';

const BLOCK_HEIGHT = 294918;

/** Registry entries exercising the 24h deployment and expiry windows. */
const REGISTRY = [
    // Registered 918 blocks ago -> deployed today
    { name: 'app-active', height: 294000, expire: 5000, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    // Registered 4918 blocks ago -> NOT deployed today
    { name: 'app-old', height: 290000, expire: 1000, instances: 1 },
    // Registered 118 blocks ago -> deployed today
    { name: 'app-noexpire', height: 294800, instances: 1, cpu: 1, ram: 512, hdd: 5 },
    // Registered 218 blocks ago -> deployed today AND expiring within the day
    { name: 'app-expiring', height: 294700, expire: 300, instances: 1 },
    // No name: unusable, dropped by the KPI layer's dedupe
    { height: 294000, expire: 2000, instances: 1 }
];

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation(async url => {
        if (String(url).includes('getblockcount')) {
            return { data: { data: BLOCK_HEIGHT } };
        }
        if (String(url).includes('globalappsspecifications')) {
            return { data: { data: REGISTRY } };
        }
        throw new Error(`unexpected axios call: ${url}`);
    });
});

describe('getFluxCloudSnapshot', () => {
    it('returns empty uncached lists when the fetch fails — an absent reading, not a zero', async () => {
        // Runs FIRST: the fetchers' module caches are still cold, so the rejection
        // actually reaches the snapshot instead of being served a stale copy.
        axios.get.mockRejectedValue(new Error('down'));

        const snapshot = await getFluxCloudSnapshot();

        expect(snapshot.appsDeployedToday).toEqual({ cached: false, apps: [] });
        expect(snapshot.appsExpiring24h).toEqual({ cached: false, apps: [] });
    });

    it('exposes the 24h lists with their cache flags', async () => {
        const snapshot = await getFluxCloudSnapshot();

        expect(snapshot.appsDeployedToday.cached).toBe(true);
        // Registered within 2880 blocks, sorted by name (the nameless spec sorts first)
        expect(snapshot.appsDeployedToday.apps.map(a => a.name)).toEqual([
            undefined, 'app-active', 'app-expiring', 'app-noexpire'
        ]);
        expect(snapshot.appsExpiring24h.cached).toBe(true);
        // Expiring within 2880 blocks; app-old's expiry is already past, app-active's
        // is too far out, app-noexpire has none. The nameless spec is expiring too —
        // raw registry behaviour; the KPI layer's dedupe drops nameless entries.
        expect(snapshot.appsExpiring24h.apps.map(a => a.name)).toEqual(['app-expiring', undefined]);
    });
});

describe('dedupeAppsByName', () => {
    it('drops nameless entries', () => {
        const result = dedupeAppsByName(
            [{ name: 'a', blockAge: 1 }, { blockAge: 0 }],
            (a, b) => a.blockAge < b.blockAge
        );
        expect(result.map(a => a.name)).toEqual(['a']);
    });

    it('keeps the entry the prefer function chooses when names collide', () => {
        const result = dedupeAppsByName(
            [
                { name: 'redeployed', repo: 'old', blockAge: 2800 },
                { name: 'redeployed', repo: 'new', blockAge: 100 },
                { name: 'solo', repo: 'solo', blockAge: 50 }
            ],
            (a, b) => (a.blockAge ?? Infinity) < (b.blockAge ?? Infinity)
        );
        expect(result.map(a => a.name)).toEqual(['redeployed', 'solo']);
        expect(result.find(a => a.name === 'redeployed').repo).toBe('new'); // lower blockAge wins
    });

    it('is a no-op on an already-unique list', () => {
        const apps = [{ name: 'a', blockAge: 1 }, { name: 'b', blockAge: 2 }];
        expect(dedupeAppsByName(apps, (a, b) => a.blockAge < b.blockAge)).toEqual(apps);
    });
});

describe('getFluxCloudActivity', () => {
    it('dedupes deployed and expiring lists, keeping the newest registration and most urgent expiry', async () => {
        const activity = await getFluxCloudActivity();

        // Registry (from the top of this file): the nameless spec is dropped, the rest
        // are all unique names, so this exercises pass-through plus the drop of the
        // nameless entry -- the collision-resolution rule is covered directly above.
        expect(activity.deployedToday.cached).toBe(true);
        expect(activity.deployedToday.apps.map(a => a.name).sort()).toEqual(
            ['app-active', 'app-expiring', 'app-noexpire']
        );
        expect(activity.expiring24h.cached).toBe(true);
        expect(activity.expiring24h.apps.map(a => a.name)).toEqual(['app-expiring']);
    });

    // A fetch-failure/re-deployment-collision round trip through getFluxCloudActivity()
    // itself is not exercised here: carouselService.js's Flux API cache is module-level
    // and warms from the tests above within this same file (matching the "Runs FIRST"
    // constraint noted at the top of this file), so a later mock change has no effect.
    // The collision-resolution rule (newest registration / most urgent expiry wins) is
    // covered directly against dedupeAppsByName above; the failure-propagation shape
    // (`{cached: false, apps: []}`) is covered by getFluxCloudSnapshot's own "Runs FIRST"
    // test, and getFluxCloudActivity does nothing but pass that shape through.
});

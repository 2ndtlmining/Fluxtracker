import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Shared running-apps payload.
 *
 * gaming/crypto/wordpress/cloud each used to download this ~450KB response separately every
 * cycle, and each counted category totals its own way — which is why the metrics card said
 * Gaming 309 while the gaming category card said 343.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import {
    getRunningApps,
    getCachedRunningApps,
    clearRunningAppsCache,
    toRepoCounts,
    countByCategory,
    countConfiguredRepos
} from '../runningAppsProvider.js';
import { GAMING_REPOS } from '../../config.js';

/** Build a stats.runonflux.io style response from image -> instance count. */
function apiResponse(imageCounts) {
    const nodes = [];
    for (const [image, count] of Object.entries(imageCounts)) {
        for (let i = 0; i < count; i++) {
            nodes.push({ apps: { runningapps: [{ Image: image }] } });
        }
    }
    return { data: { data: nodes } };
}

const LIVE_SAMPLE = {
    'thijsvanloef/palworld-server-docker:latest': 6,
    'itzg/minecraft-server:latest': 4,
    'itzg/minecraft-bedrock-server:latest': 2,
    'runonflux/minecraft-server-website:latest': 3,
    'presearch/node:latest': 5,
    'runonflux/wp-nginx:latest': 2,
    'mysql:8.3.0': 7
};

beforeEach(() => {
    vi.clearAllMocks();
    clearRunningAppsCache();
});

describe('getRunningApps', () => {
    it('aggregates instances per image across nodes', async () => {
        axios.get.mockResolvedValue(apiResponse({ 'a/b:1': 3, 'c/d:2': 2 }));

        const result = await getRunningApps();

        expect(result.imageCounts.get('a/b:1')).toBe(3);
        expect(result.imageCounts.get('c/d:2')).toBe(2);
        expect(result.totalInstances).toBe(5);
    });

    it('serves the cache instead of refetching within the TTL', async () => {
        axios.get.mockResolvedValue(apiResponse({ 'a/b:1': 1 }));

        await getRunningApps();
        await getRunningApps();
        await getRunningApps();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent callers into a single fetch', async () => {
        // This is the case that matters: four services all run in the same cycle
        axios.get.mockResolvedValue(apiResponse({ 'a/b:1': 1 }));

        await Promise.all([getRunningApps(), getRunningApps(), getRunningApps(), getRunningApps()]);

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('refetches when force is set', async () => {
        axios.get.mockResolvedValue(apiResponse({ 'a/b:1': 1 }));

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
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE));
        const runningApps = await getRunningApps();

        // palworld 6 + minecraft 4 + bedrock 2 = 12. The website is excluded.
        expect(countByCategory(runningApps, 'gaming')).toBe(12);
    });

    it('excludes companion websites from the total', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE));
        const runningApps = await getRunningApps();

        expect(countByCategory(runningApps, 'gaming')).not.toBe(15);
    });

    it('counts crypto and wordpress', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE));
        const runningApps = await getRunningApps();

        expect(countByCategory(runningApps, 'crypto')).toBe(5);
        expect(countByCategory(runningApps, 'wordpress')).toBe(2);
    });
});

describe('countConfiguredRepos', () => {
    it('sums every image a configured repo matches', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);

        expect(counts.gaming_palworld).toBe(6);
        expect(counts.gaming_minecraft).toBe(6); // java 4 + bedrock 2
        expect(counts.gaming_valheim).toBe(0);
    });

    it('returns a zeroed entry for every configured repo', async () => {
        axios.get.mockResolvedValue(apiResponse({ 'mysql:8.3.0': 1 }));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);

        for (const repo of GAMING_REPOS) {
            expect(counts[repo.dbKey]).toBe(0);
        }
    });

    it('counts an image toward at most one configured repo', async () => {
        axios.get.mockResolvedValue(apiResponse(LIVE_SAMPLE));
        const runningApps = await getRunningApps();

        const counts = countConfiguredRepos(runningApps, GAMING_REPOS);
        const summed = Object.values(counts).reduce((a, b) => a + b, 0);

        expect(summed).toBe(12);
    });
});

describe('toRepoCounts', () => {
    it('produces the plain object createRepoSnapshots expects', async () => {
        axios.get.mockResolvedValue(apiResponse({ 'a/b:1': 3, 'c/d:2': 2 }));
        const runningApps = await getRunningApps();

        expect(toRepoCounts(runningApps)).toEqual({ 'a/b:1': 3, 'c/d:2': 2 });
    });
});

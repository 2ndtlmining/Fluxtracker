import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * fetchAppCount() used to sum runningApps.imageCounts to get total_apps. FluxOS v8.18
 * dropped Image from the running-apps census, so imageCounts is now only the fraction
 * of running instances that resolved to a known app spec via globalappsspecifications
 * (~76-78% live) — totalInstances (computed by runningAppsProvider from the raw Names
 * list) is the true census. Watchtower is likewise no longer identifiable by image
 * string, so it's tallied by the provider (from the container name) and passed through
 * here rather than recomputed from imageCounts.
 */

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: (...args) => mockGetRunningApps(...args)
}));

vi.mock('../resilientFetch.js', () => ({
    resilientFetch: vi.fn()
}));

vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn(),
    getCurrentMetrics: vi.fn()
}));

import { fetchAppCount } from '../cloudService.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchAppCount', () => {
    it('derives totalApps from totalInstances minus watchtowerCount, not from summing imageCounts', async () => {
        // imageCounts only sums to 5 (the resolved fraction) but 10 instances actually ran —
        // total_apps must reflect the true census, not the resolved subset.
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['presearch/node:latest', 3],
                ['itzg/minecraft-server:latest', 2]
            ]),
            totalInstances: 10,
            watchtowerCount: 1,
            unresolvedCount: 4
        });

        const result = await fetchAppCount();

        // 10 total - 1 watchtower = 9, NOT 5 (the imageCounts sum)
        expect(result.totalApps).toBe(9);
    });

    it('computes gitappsCount/dockerappsCount/percentages from the resolved imageCounts', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['runonflux/orbit:git-app-1', 4],
                ['presearch/node:latest', 6]
            ]),
            totalInstances: 10,
            watchtowerCount: 0,
            unresolvedCount: 0
        });

        const result = await fetchAppCount();

        expect(result.totalApps).toBe(10);
        expect(result.gitappsCount).toBe(4);
        expect(result.dockerappsCount).toBe(6);
        expect(result.gitappsPercent).toBe(40);
        expect(result.dockerappsPercent).toBe(60);
    });

    it('passes watchtowerCount through from the provider rather than recomputing it', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([['presearch/node:latest', 5]]),
            totalInstances: 12,
            watchtowerCount: 7,
            unresolvedCount: 0
        });

        const result = await fetchAppCount();

        expect(result.watchtowerCount).toBe(7);
        expect(result.totalApps).toBe(5); // 12 - 7, unrelated to imageCounts summing to 5 here
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #421 -- getDeploymentFill(), the one definition the Apps card, the stored daily figure
 * and (via the same block height) the Missing Deployments carousel share: fill over UNEXPIRED
 * specs only. Owner decision 2026-09-27: an expired app will never be filled, so it is not
 * "ordered".
 */

vi.mock('../appSpecsCache.js', () => ({
    getAllAppSpecs: vi.fn(),
    ensureGlobalSpecsCache: vi.fn(),
    resolveRunningAppName: vi.fn(() => ({ repotag: 'some/image:latest' })),
    getAppSpecByName: vi.fn(() => null)
}));
vi.mock('../fluxNetworkData.js', () => ({ fetchCurrentBlockHeight: vi.fn() }));
vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));

import { getAllAppSpecs } from '../appSpecsCache.js';
import { fetchCurrentBlockHeight } from '../fluxNetworkData.js';
import { resilientFetch } from '../resilientFetch.js';
import { getDeploymentFill, clearRunningAppsCache } from '../runningAppsProvider.js';

const BLOCK = 3_000_000;
const node = (...apps) => ({ apps: { runningapps: apps.map(a => ({ Names: [`/flux${a}`] })) } });

beforeEach(() => {
    vi.clearAllMocks();
    clearRunningAppsCache();
    // live: 2 ordered, 1 running. lapsed: expired 100 blocks ago, 3 ordered, none running.
    getAllAppSpecs.mockReturnValue([
        { name: 'live', instances: 2, height: BLOCK - 1000, expire: 22000 },
        { name: 'lapsed', instances: 3, height: BLOCK - 22100, expire: 22000 }
    ]);
    resilientFetch.mockResolvedValue({ status: 'success', data: [node('live')] });
    fetchCurrentBlockHeight.mockResolvedValue(BLOCK);
});

describe('getDeploymentFill (issue #421)', () => {
    it('leaves expired specs out of "ordered"', async () => {
        const { fill } = await getDeploymentFill();

        expect(fill.ordered).toBe(2);          // not 5: the lapsed app is not ordered
        expect(fill.running).toBe(1);
        expect(fill.fillPct).toBe(50);
    });

    it('is unavailable without a block height, rather than falling back to every spec', async () => {
        // Counting the lapsed app would silently restate the figure (1 of 5 = 20%).
        fetchCurrentBlockHeight.mockRejectedValue(new Error('daemon down'));

        const { apps, fill } = await getDeploymentFill();

        expect(fill).toBeNull();
        expect(apps.totalInstances).toBe(1);   // the census itself is still returned
    });
});

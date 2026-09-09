import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getSharedFluxApiData's in-flight dedup: fetchLatestDeployedApps() and
 * fetchExpiringApps() are called concurrently every header poll (issue #104 Phase 2's
 * idle rotation, Header.svelte's pollLatestApps). Without dedup, two callers landing on
 * a cold cache each pay the full ~450KB globalappsspecifications fetch independently --
 * this is a separate file (not carouselSnapshot.test.js) so the cache genuinely starts
 * cold for this test, rather than depending on file-internal test order.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import { fetchLatestDeployedApps, fetchExpiringApps } from '../carouselService.js';

const BLOCK_HEIGHT = 294918;
// height 294800 -> deployed 118 blocks ago (within the 2880-block "today" window).
// expire 318 -> expires at block 295118, i.e. 200 blocks from BLOCK_HEIGHT (also within
// the 2880-block "expiring soon" window), so this one fixture satisfies both endpoints.
const REGISTRY = [
    { name: 'app-active', height: 294800, expire: 318, instances: 1, cpu: 1, ram: 1024, hdd: 10 }
];

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation(async url => {
        if (String(url).includes('getblockcount')) return { data: { data: BLOCK_HEIGHT } };
        if (String(url).includes('globalappsspecifications')) return { data: { data: REGISTRY } };
        throw new Error(`unexpected axios call: ${url}`);
    });
});

describe('getSharedFluxApiData (via fetchLatestDeployedApps/fetchExpiringApps)', () => {
    it('two concurrent cold-cache callers share one upstream fetch, not two', async () => {
        // Runs first in this file: the module cache is still cold.
        await Promise.all([fetchLatestDeployedApps(), fetchExpiringApps()]);

        const blockCountCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('getblockcount'));
        const specsCalls = axios.get.mock.calls.filter(([url]) => String(url).includes('globalappsspecifications'));

        expect(blockCountCalls).toHaveLength(1);
        expect(specsCalls).toHaveLength(1);
    });

    it('both callers still get correct, independent results from the shared fetch', async () => {
        const [deployed, expiring] = await Promise.all([fetchLatestDeployedApps(), fetchExpiringApps()]);

        expect(deployed.map(a => a.name)).toEqual(['app-active']);
        expect(expiring.map(a => a.name)).toEqual(['app-active']);
    });
});

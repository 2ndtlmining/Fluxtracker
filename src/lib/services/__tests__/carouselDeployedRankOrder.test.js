import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #140: fetchLatestDeployedApps()'s #rank badge is the only "which app is newest"
 * signal the "Latest Deployed Apps" carousel shows -- it has to agree with the header's
 * own "NEW APP DEPLOYED" spotlight, which picks strictly by blockAge (pickLatestDeployed in
 * terminalAnimation.js). Sorting alphabetically (the previous behavior) made #1 whichever
 * app's name happened to sort first, unrelated to recency -- a real, user-visible mismatch.
 * Separate file (not carouselSharedFetch.test.js) so the shared Flux-API cache starts cold,
 * per that file's own comment on why this repo splits these tests across files.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));
vi.mock('../../db/database.js', () => ({ getTransactionsByBlockRange: vi.fn() }));

import axios from 'axios';
import { getTransactionsByBlockRange } from '../../db/database.js';
import { fetchLatestDeployedApps, latestPaidHeights } from '../carouselService.js';
import { clearBlockHeightCache } from '../fluxNetworkData.js';

const BLOCK_HEIGHT = 300000;
// Deliberately out of alphabetical order relative to recency: "aaa-oldest" would sort
// first alphabetically but was deployed longest ago; "zzz-newest" sorts last alphabetically
// but is the most recently deployed. All three are within the 2880-block "today" window.
const REGISTRY = [
    { name: 'aaa-oldest', height: 299000, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    { name: 'mid-app', height: 299500, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    { name: 'zzz-newest', height: 299900, instances: 1, cpu: 1, ram: 1024, hdd: 10, expire: 88000 },
    // Same blockAge as another entry, to verify the name tiebreaker.
    { name: 'zeta-tie', height: 299500, instances: 1, cpu: 1, ram: 1024, hdd: 10 }
];
// One paid row per app at its spec height: the case before issue #534 changed anything.
const PAYMENTS = REGISTRY.map(app => ({ app_name: app.name, block_height: app.height, amount: 20 }));

beforeEach(() => {
    clearBlockHeightCache(); // the shared height cache (#415) must not leak between tests
    vi.clearAllMocks();
    axios.get.mockImplementation(async url => {
        if (String(url).includes('getblockcount')) return { data: { status: 'success', data: BLOCK_HEIGHT } };
        if (String(url).includes('globalappsspecifications')) return { data: { status: 'success', data: REGISTRY } }; // appSpecsCache checks status (#293)
        throw new Error(`unexpected axios call: ${url}`);
    });
    getTransactionsByBlockRange.mockResolvedValue(PAYMENTS);
});

describe('fetchLatestDeployedApps rank order (issue #140)', () => {
    it('ranks most-recently-deployed first, not alphabetically', async () => {
        const deployed = await fetchLatestDeployedApps();

        expect(deployed.map(a => a.name)).toEqual(['zzz-newest', 'mid-app', 'zeta-tie', 'aaa-oldest']);
    });

    it('assigns rank 1 to the single most-recent app, matching pickLatestDeployed', async () => {
        const deployed = await fetchLatestDeployedApps();

        expect(deployed[0].rank).toBe(1);
        expect(deployed[0].name).toBe('zzz-newest');
        // pickLatestDeployed (terminalAnimation.js) independently picks by minimum blockAge --
        // the carousel's #1 must be the same app the header spotlight shows.
        const trueLatest = deployed.reduce((latest, app) => (app.blockAge < latest.blockAge ? app : latest));
        expect(trueLatest.name).toBe(deployed[0].name);
    });

    it('breaks ties in blockAge by name, for a stable order', async () => {
        const deployed = await fetchLatestDeployedApps();
        const tied = deployed.filter(a => a.blockAge === 500); // mid-app and zeta-tie

        expect(tied.map(a => a.name)).toEqual(['mid-app', 'zeta-tie']);
    });
});

describe('fetchLatestDeployedApps subscription term (header TERM row)', () => {
    it('carries the spec expire and the blocks left until it runs out', async () => {
        const deployed = await fetchLatestDeployedApps();
        const newest = deployed.find(a => a.name === 'zzz-newest');
        expect(newest.expireBlocks).toBe(88000);
        expect(newest.blocksUntilExpiry).toBe(299900 + 88000 - BLOCK_HEIGHT);
    });

    it('is null, not a guessed default, when the spec has no expire', async () => {
        const deployed = await fetchLatestDeployedApps();
        const old = deployed.find(a => a.name === 'aaa-oldest');
        expect(old.expireBlocks).toBeNull();
        expect(old.blocksUntilExpiry).toBeNull();
    });
});

/**
 * Issue #534: the header listed an app at its spec's latest height, and about half of those
 * heights are 0.02 FLUX spec-only updates the transaction grid never stores. A reader saw
 * "deployed 3 minutes ago" and could not find the app in the grid. Only paid events count now.
 */
describe('fetchLatestDeployedApps follows payments, not spec updates (issue #534)', () => {
    it('drops an app whose only recent message is a spec update with no payment', async () => {
        getTransactionsByBlockRange.mockResolvedValue(PAYMENTS.filter(p => p.app_name !== 'mid-app'));

        const deployed = await fetchLatestDeployedApps();

        expect(deployed.map(a => a.name)).not.toContain('mid-app');
        expect(deployed).toHaveLength(3);
    });

    it('places an updated app at its payment height, not at the later update', async () => {
        // zzz-newest's spec says 299900 (a 0.02 update); it was paid at 298000.
        getTransactionsByBlockRange.mockResolvedValue([
            ...PAYMENTS.filter(p => p.app_name !== 'zzz-newest'),
            { app_name: 'zzz-newest', block_height: 298000, amount: 20 }
        ]);

        const deployed = await fetchLatestDeployedApps();
        const app = deployed.find(a => a.name === 'zzz-newest');

        expect(app.height).toBe(298000);
        expect(app.blockAge).toBe(BLOCK_HEIGHT - 298000);
        expect(deployed.at(-1).name).toBe('zzz-newest'); // now the oldest of the four
    });

    it('asks only for the last day of payments', async () => {
        await fetchLatestDeployedApps();

        expect(getTransactionsByBlockRange).toHaveBeenCalledWith(BLOCK_HEIGHT - 2880 + 1, BLOCK_HEIGHT);
    });
});

describe('latestPaidHeights', () => {
    it("keeps each app's newest payment, case-insensitively", () => {
        const heights = latestPaidHeights([
            { app_name: 'Valheim1', block_height: 100 },
            { app_name: 'valheim1', block_height: 250 },
            { app_name: 'valheim1', block_height: 200 }
        ]);

        expect(heights.get('valheim1')).toBe(250);
        expect(heights.size).toBe(1);
    });

    it('skips rows with no app name, such as FluxDrive payments', () => {
        const heights = latestPaidHeights([
            { app_name: null, app_type: 'fluxdrive', block_height: 300 },
            { app_name: '', block_height: 301 },
            { app_name: 'a', block_height: null }
        ]);

        expect(heights.size).toBe(0);
        expect(latestPaidHeights(undefined).size).toBe(0);
    });
});

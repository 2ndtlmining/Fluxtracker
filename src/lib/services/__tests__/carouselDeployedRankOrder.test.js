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

import axios from 'axios';
import { fetchLatestDeployedApps } from '../carouselService.js';

const BLOCK_HEIGHT = 300000;
// Deliberately out of alphabetical order relative to recency: "aaa-oldest" would sort
// first alphabetically but was deployed longest ago; "zzz-newest" sorts last alphabetically
// but is the most recently deployed. All three are within the 2880-block "today" window.
const REGISTRY = [
    { name: 'aaa-oldest', height: 299000, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    { name: 'mid-app', height: 299500, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    { name: 'zzz-newest', height: 299900, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    // Same blockAge as another entry, to verify the name tiebreaker.
    { name: 'zeta-tie', height: 299500, instances: 1, cpu: 1, ram: 1024, hdd: 10 }
];

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation(async url => {
        if (String(url).includes('getblockcount')) return { data: { data: BLOCK_HEIGHT } };
        if (String(url).includes('globalappsspecifications')) return { data: { data: REGISTRY } };
        throw new Error(`unexpected axios call: ${url}`);
    });
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Decentralization metric (issues #108, #457): the share of Flux NODES hosted in datacenters.
 *
 * The rules under test:
 *   - the unit is the node -- two nodes on one IP are two nodes
 *   - datacenter = the node's own geolocation flag, or a provider on DATACENTER_OVERRIDES
 *   - a node with no flag and no override is unknown: out of the percentage, never independent
 *   - PROVIDER_GROUPS join spellings of one company for display and snapshots
 */

vi.mock('../busiestNodeService.js', () => ({
    getBusiestNode: vi.fn().mockResolvedValue(null),
    getCachedNetworkNodes: vi.fn().mockReturnValue([])
}));

import { getBusiestNode, getCachedNetworkNodes } from '../busiestNodeService.js';
import {
    providerName,
    isDatacenterOverride,
    classifyNode,
    runDecentralizationCycle,
    getDecentralizationStats,
    clearDecentralizationStatsCache,
    getFullDatacenterBreakdown,
    getFullCountryBreakdown,
    getFullContinentBreakdown
} from '../decentralizationService.js';

const GERMANY = { country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' };
const USA = { country: 'United States', countryCode: 'US', continent: 'North America', continentCode: 'NA' };

/** A node row as busiestNodeService.getCachedNetworkNodes() returns it. */
const node = (org, dataCenter, place = GERMANY, extra = {}) =>
    ({ ip: '1.2.3.4', org, isp: org, dataCenter, ...place, ...extra });

beforeEach(() => {
    vi.clearAllMocks();
    clearDecentralizationStatsCache();
    getBusiestNode.mockResolvedValue(null);
    getCachedNetworkNodes.mockReturnValue([]);
});

describe('providerName (PROVIDER_GROUPS)', () => {
    it('joins every spelling of one company', () => {
        expect(providerName('Hetzner Online GmbH')).toBe('Hetzner');
        expect(providerName('Hetzner')).toBe('Hetzner');
        expect(providerName('HETZNER-DC')).toBe('Hetzner');
        expect(providerName('OVH US LLC')).toBe('OVH');
        expect(providerName('OVH.CZ s.r.o')).toBe('OVH');
        expect(providerName('NETCUP-GMBH')).toBe('netcup');
        expect(providerName('De Fra Ionos Cloud Fra')).toBe('IONOS');
        expect(providerName('JSC "TIMEWEB"')).toBe('Timeweb');
    });

    it('keeps a provider outside every group as reported', () => {
        expect(providerName('  GHOSTnet Network used for Internet Access Services ')).toBe('GHOSTnet Network used for Internet Access Services');
    });

    it('falls back to the isp when the org is empty, and is null when both are', () => {
        expect(providerName('', 'Hetzner Online GmbH')).toBe('Hetzner');
        expect(providerName('', '')).toBeNull();
        expect(providerName(undefined, undefined)).toBeNull();
    });
});

describe('isDatacenterOverride (DATACENTER_OVERRIDES)', () => {
    it('matches DataVex (issue #196) on org or isp, case-insensitively', () => {
        expect(isDatacenterOverride('DataVex', '')).toBe(true);
        expect(isDatacenterOverride('', 'DATAVEX')).toBe(true);
    });

    it('does not match anything it does not name', () => {
        expect(isDatacenterOverride('OVH SAS', 'OVH SAS')).toBe(false);
        expect(isDatacenterOverride('', '')).toBe(false);
    });
});

describe('classifyNode', () => {
    it('takes the node\'s own datacenter flag', () => {
        expect(classifyNode(node('GHOSTnet', true))).toMatchObject({ isDatacenter: true, classified: true });
        expect(classifyNode(node('Stofa A/S', false))).toMatchObject({ isDatacenter: false, classified: true });
    });

    it('does not second-guess the flag for a provider it does not name', () => {
        // OVH is grouped but not overridden: a node flagged not-hosting stays that way
        expect(classifyNode(node('OVH SAS', false))).toMatchObject({ org: 'OVH', isDatacenter: false });
    });

    it('counts every Hetzner and Contabo node, including ones flagged not-hosting', () => {
        // 8 HETZNER-DC nodes and 1 Contabo node carried a false flag (#457)
        expect(classifyNode(node('HETZNER-DC', false))).toMatchObject({ org: 'Hetzner', isDatacenter: true });
        expect(classifyNode(node('Contabo GmbH', false))).toMatchObject({ org: 'Contabo', isDatacenter: true });
    });

    it('an override counts the provider as a datacenter whatever the flag says', () => {
        expect(classifyNode(node('DataVex', false))).toMatchObject({ isDatacenter: true, classified: true });
        expect(classifyNode(node('DataVex', null))).toMatchObject({ isDatacenter: true, classified: true });
    });

    it('a node with no flag and no override is unknown, not independent', () => {
        expect(classifyNode(node('', null))).toMatchObject({ classified: false, isDatacenter: false, org: null });
    });
});

describe('getDecentralizationStats', () => {
    it('counts NODES: two nodes on one IP are two', async () => {
        getCachedNetworkNodes.mockReturnValue([
            node('Hetzner', true, GERMANY, { ip: '5.5.5.5' }),
            node('Comcast', false, USA, { ip: '9.9.9.9' }),
            node('Comcast', false, USA, { ip: '9.9.9.9' }),   // same IP, second node
            node('Comcast', false, USA, { ip: '9.9.9.9' })
        ]);

        const stats = await getDecentralizationStats();

        expect(stats.totalNodes).toBe(4);
        expect(stats.datacenterCount).toBe(1);
        expect(stats.datacenterPercent).toBe(25);   // per IP it would have read 50%
    });

    it('leaves unknown nodes out of the percentage and reports them as coverage', async () => {
        getCachedNetworkNodes.mockReturnValue([
            node('Hetzner', true),
            node('Comcast', false, USA),
            node('', null),
            node('', null)
        ]);

        const stats = await getDecentralizationStats();

        expect(stats.totalNodes).toBe(4);
        expect(stats.classifiedCount).toBe(2);
        expect(stats.datacenterPercent).toBe(50);
        expect(stats.coveragePercent).toBe(50);
    });

    it('is null (not 0) when nothing is classified', async () => {
        getCachedNetworkNodes.mockReturnValue([node('', null)]);
        const stats = await getDecentralizationStats();
        expect(stats.datacenterPercent).toBeNull();
    });

    it('lists the top datacenter providers grouped, with percent of all classified nodes', async () => {
        getCachedNetworkNodes.mockReturnValue([
            node('Hetzner Online GmbH', true),
            node('Hetzner', true),
            node('HETZNER-DC', true),
            node('OVH SAS', true),
            node('Comcast', false, USA)
        ]);

        const { topDatacenters } = await getDecentralizationStats();

        expect(topDatacenters).toEqual([
            { org: 'Hetzner', count: 3, percent: 60 },
            { org: 'OVH', count: 1, percent: 20 }
        ]);
    });

    it('caps topDatacenters at 6 and reports the rest via otherProviderCount', async () => {
        getCachedNetworkNodes.mockReturnValue(
            ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(name => node(`Provider ${name}`, true))
        );

        const stats = await getDecentralizationStats();

        expect(stats.topDatacenters).toHaveLength(6);
        expect(stats.otherProviderCount).toBe(2);
    });

    it('caches between cycles, and a cycle refreshes what the next read returns', async () => {
        getCachedNetworkNodes.mockReturnValue([node('Hetzner', true)]);
        expect((await getDecentralizationStats()).datacenterPercent).toBe(100);

        getCachedNetworkNodes.mockReturnValue([node('Hetzner', true), node('Comcast', false, USA)]);
        expect((await getDecentralizationStats()).datacenterPercent).toBe(100);   // cached

        await runDecentralizationCycle();
        expect((await getDecentralizationStats()).datacenterPercent).toBe(50);
    });

    it('computes from a context when given one, never a stale cache (the snapshot passes one)', async () => {
        getCachedNetworkNodes.mockReturnValue([node('Hetzner', true)]);
        await getDecentralizationStats();

        const context = { nodes: [classifyNode(node('Comcast', false, USA))], relevant: [classifyNode(node('Comcast', false, USA))] };
        expect((await getDecentralizationStats(context)).datacenterPercent).toBe(0);
    });
});

describe('runDecentralizationCycle', () => {
    it('does nothing when there are no nodes yet', async () => {
        await runDecentralizationCycle();
        getCachedNetworkNodes.mockReturnValue([node('Hetzner', true)]);
        // nothing was cached by the empty cycle, so this computes fresh
        expect((await getDecentralizationStats()).totalNodes).toBe(1);
    });

    it('never throws -- a failed warm-up just leaves the last stats in place', async () => {
        getBusiestNode.mockRejectedValue(new Error('stats.runonflux.io unreachable'));
        await expect(runDecentralizationCycle()).resolves.toBeUndefined();
    });
});

describe('getFullDatacenterBreakdown', () => {
    it('returns every datacenter provider uncapped, grouped, plus the (independent) bucket', async () => {
        getCachedNetworkNodes.mockReturnValue([
            node('Hetzner Online GmbH', true),
            node('Hetzner', true),
            node('DataVex', false),               // override
            node('Comcast', false, USA),
            node('Stofa A/S', false),
            node('', null)                        // unknown: in neither
        ]);

        expect(await getFullDatacenterBreakdown()).toEqual([
            { org: 'Hetzner', count: 2 },
            { org: 'DataVex', count: 1 },
            { org: '(independent)', count: 2 }
        ]);
    });

    it('omits (independent) when every classified node is a datacenter, and is [] with none', async () => {
        getCachedNetworkNodes.mockReturnValue([node('Hetzner', true)]);
        expect(await getFullDatacenterBreakdown()).toEqual([{ org: 'Hetzner', count: 1 }]);

        getCachedNetworkNodes.mockReturnValue([]);
        expect(await getFullDatacenterBreakdown()).toEqual([]);
    });
});

describe('getFullCountryBreakdown / getFullContinentBreakdown', () => {
    it('group every classified node, keeping a missing location under "(unknown)"', async () => {
        getCachedNetworkNodes.mockReturnValue([
            node('Hetzner', true, GERMANY),
            node('Hetzner', true, GERMANY),
            node('Comcast', false, USA),
            node('Somewhere', false, { country: null, countryCode: null, continent: null, continentCode: null }),
            node('', null, GERMANY)               // unknown: left out
        ]);

        expect(await getFullCountryBreakdown()).toEqual([
            { country: 'Germany', countryCode: 'DE', count: 2 },
            { country: 'United States', countryCode: 'US', count: 1 },
            { country: '(unknown)', countryCode: null, count: 1 }
        ]);
        expect(await getFullContinentBreakdown()).toEqual([
            { continent: 'Europe', continentCode: 'EU', count: 2 },
            { continent: 'North America', continentCode: 'NA', count: 1 },
            { continent: '(unknown)', continentCode: null, count: 1 }
        ]);
    });
});

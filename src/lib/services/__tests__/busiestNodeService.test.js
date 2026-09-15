import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Busiest Node card (issue #108): the node with the most running instances, its resolved
 * app names, and CPU/RAM/SSD used vs. that node's own benchmarked capacity. One combined
 * `fluxinfo` projection gives per-node app names + resources + benchmark together, so no
 * separate fetches need pairing up by IP.
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
    getBusiestNode,
    getCachedBusiestNode,
    getCachedNetworkNodeIps,
    clearBusiestNodeCache,
    appNameForContainer
} from '../busiestNodeService.js';

function node({ ip = '1.2.3.4', country = 'Testland', countryCode = 'TL', tier = 'CUMULUS',
    names = [], cpuUsed = 0, ramUsedMb = 0, hddUsed = 0, cores = 4, ramGb = 8, ssd = 220 } = {}) {
    return {
        ip: `${ip}:16137`,
        tier,
        geolocation: { ip, country, countryCode },
        apps: {
            runningapps: names.map(n => ({ Names: [n] })),
            resources: { appsCpusLocked: cpuUsed, appsRamLocked: ramUsedMb, appsHddLocked: hddUsed }
        },
        benchmark: { bench: { cores, ram: ramGb, ssd } }
    };
}

function apiResponse(nodes) {
    return { data: { status: 'success', data: nodes } };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearBusiestNodeCache();
    resolveRunningAppName.mockImplementation(name => {
        if (name === '/fluxfm1_myapp') return { appName: 'myapp', repotag: 'earnfm/earnfm-client:latest' };
        if (name === '/fluxWeb_site') return { appName: 'site', repotag: 'nginx:latest' };
        return null;
    });
});

describe('getBusiestNode', () => {
    it('picks the node with the most running instances', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '1.1.1.1', names: ['/fluxfm1_myapp'] }),
            node({ ip: '2.2.2.2', names: ['/fluxfm1_myapp', '/fluxWeb_site'] }),
            node({ ip: '3.3.3.3', names: [] })
        ]));

        const result = await getBusiestNode();

        expect(result.ip).toBe('2.2.2.2');
        expect(result.appCount).toBe(2);
    });

    it('names a container the spec cache does not know, rather than dropping it (issue #190)', async () => {
        // The old behaviour counted this container but omitted its name, so the card said
        // "3 apps running" while listing two. One number now stands behind both.
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '9.9.9.9', names: ['/fluxfm1_myapp', '/fluxunknown_thing', '/fluxWeb_site'] })
        ]));

        const result = await getBusiestNode();

        expect(result.appCount).toBe(3);
        expect(result.appNames).toEqual(['myapp', 'thing', 'site']);
    });

    it('converts locked RAM (MB) to the same GB unit as benchmarked RAM', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '5.5.5.5', names: ['/fluxfm1_myapp'], ramUsedMb: 5100, ramGb: 7.7 })
        ]));

        const result = await getBusiestNode();

        expect(result.resources.ram.used).toBeCloseTo(5.1, 6);
        expect(result.resources.ram.total).toBe(7.7);
    });

    it('reports CPU and SSD used/total as-is (already the same unit)', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '6.6.6.6', names: ['/fluxfm1_myapp'], cpuUsed: 2.1, cores: 4, hddUsed: 55, ssd: 220 })
        ]));

        const result = await getBusiestNode();

        expect(result.resources.cpu).toEqual({ used: 2.1, total: 4 });
        expect(result.resources.ssd).toEqual({ used: 55, total: 220 });
    });

    it('includes tier and geolocation country', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '7.7.7.7', names: ['/fluxfm1_myapp'], tier: 'STRATUS', country: 'Australia', countryCode: 'AU' })
        ]));

        const result = await getBusiestNode();

        expect(result.tier).toBe('STRATUS');
        expect(result.country).toBe('Australia');
        expect(result.countryCode).toBe('AU');
    });

    it('ignores nodes with no running apps when picking the busiest', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '8.8.8.8', names: [] })
        ]));

        await expect(getBusiestNode()).rejects.toThrow(/no node with running apps/i);
    });

    it('rejects an empty payload rather than reporting a fake result', async () => {
        axios.get.mockResolvedValue(apiResponse([]));

        await expect(getBusiestNode()).rejects.toThrow(/empty or invalid/i);
    });

    it('serves the cache instead of refetching within the TTL', async () => {
        axios.get.mockResolvedValue(apiResponse([node({ names: ['/fluxfm1_myapp'] })]));

        await getBusiestNode();
        await getBusiestNode();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

describe('getCachedBusiestNode', () => {
    it('returns null when nothing has been fetched yet', () => {
        expect(getCachedBusiestNode()).toBeNull();
    });

    it('returns the last successful result after a fetch', async () => {
        axios.get.mockResolvedValue(apiResponse([node({ ip: '4.4.4.4', names: ['/fluxfm1_myapp'] })]));

        await getBusiestNode();

        expect(getCachedBusiestNode().ip).toBe('4.4.4.4');
    });
});

describe('getCachedNetworkNodeIps', () => {
    it('returns [] when nothing has been fetched yet', () => {
        expect(getCachedNetworkNodeIps()).toEqual([]);
    });

    it('returns every node IP from the last fetch, decentralizationService\'s candidate set', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '1.1.1.1', names: ['/fluxfm1_myapp'] }),
            node({ ip: '2.2.2.2', names: [] }),
            node({ ip: '3.3.3.3', names: [] })
        ]));

        await getBusiestNode();

        expect(getCachedNetworkNodeIps().sort()).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3']);
    });

    it('dedupes IPs shared by multiple node entries (one host running several instances)', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '1.1.1.1', names: ['/fluxfm1_myapp'] }),
            node({ ip: '1.1.1.1', names: [] })
        ]));

        await getBusiestNode();

        expect(getCachedNetworkNodeIps()).toEqual(['1.1.1.1']);
    });

    it('is cleared by the test hook alongside the busiest-node cache', async () => {
        axios.get.mockResolvedValue(apiResponse([node({ ip: '1.1.1.1', names: ['/fluxfm1_myapp'] })]));
        await getBusiestNode();

        clearBusiestNodeCache();

        expect(getCachedNetworkNodeIps()).toEqual([]);
    });
});

// ---- Issue #190: apps vs containers ----------------------------------------------------
//
// A compose app runs one container PER COMPONENT on the same node, so runningapps.length is
// a container count. The real node in the report ran 13 containers belonging to 6 apps, and
// the card claimed "13 apps running" where Flux's own dashboard said 6.

describe('counting apps rather than containers (issue #190)', () => {
    // The exact container list from node 99.56.151.69 in the report.
    const REAL_NODE_CONTAINERS = [
        '/fluxddns_ghostddns',
        '/fluxnginx_ghostddns',
        '/fluxoperator_ghostddns',
        '/fluxmysql_ghostddns',
        '/fluxghost_ghostddns',
        '/fluxoperator_wordpress1691169388403',
        '/fluxmysql_wordpress1691169388403',
        '/fluxwp_wordpress1691169388403',
        '/fluxnginx_whoogleflux',
        '/fluxexperiment_softethervpn1783759222914',
        '/fluxtupelotreeservices_tupelotreeservices',
        '/fluxwhoogle_whoogleflux',
        '/fluxFoldingAtHome_FoldingAtRunOnFlux13'
    ];

    it('reports 6 apps for the 13-container node, the number Flux itself shows', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '99.56.151.69', names: REAL_NODE_CONTAINERS })
        ]));

        const result = await getBusiestNode();

        expect(result.appCount).toBe(6);
        expect(result.containerCount).toBe(13);
        expect(result.appNames).toEqual([
            'ghostddns',
            'wordpress1691169388403',
            'whoogleflux',
            'softethervpn1783759222914',
            'tupelotreeservices',
            'FoldingAtRunOnFlux13'
        ]);
    });

    it('reports each app with the number of containers it runs, summing to the total', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '99.56.151.69', names: REAL_NODE_CONTAINERS })
        ]));

        const result = await getBusiestNode();

        expect(result.apps).toEqual([
            { name: 'ghostddns', containers: 5 },
            { name: 'wordpress1691169388403', containers: 3 },
            { name: 'whoogleflux', containers: 2 },
            { name: 'softethervpn1783759222914', containers: 1 },
            { name: 'tupelotreeservices', containers: 1 },
            { name: 'FoldingAtRunOnFlux13', containers: 1 }
        ]);
        // Every running container is accounted for -- nothing is hidden by the dedupe.
        expect(result.apps.reduce((sum, a) => sum + a.containers, 0)).toBe(result.containerCount);
    });

    it('lists every app once, however many components it runs', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '5.5.5.5', names: ['/fluxa_one', '/fluxb_one', '/fluxc_one'] })
        ]));

        const result = await getBusiestNode();

        expect(result.appNames).toEqual(['one']);
        expect(result.appCount).toBe(1);
    });

    // Ranking stays on containers: that is the node's real workload, and the resource bars
    // under the headline measure exactly that. #190 was about calling containers "apps", not
    // about which number to rank by -- the card now reports both.
    it('picks the node running more CONTAINERS, even when another runs more distinct apps', async () => {
        axios.get.mockResolvedValue(apiResponse([
            // 10 containers, but all of it is two compose apps -- the busier MACHINE.
            node({ ip: '1.1.1.1', names: [
                '/fluxa_alpha', '/fluxb_alpha', '/fluxc_alpha', '/fluxd_alpha', '/fluxe_alpha',
                '/fluxa_beta', '/fluxb_beta', '/fluxc_beta', '/fluxd_beta', '/fluxe_beta'
            ] }),
            // 4 containers, four separate apps.
            node({ ip: '2.2.2.2', names: ['/fluxx_one', '/fluxx_two', '/fluxx_three', '/fluxx_four'] })
        ]));

        const result = await getBusiestNode();

        expect(result.ip).toBe('1.1.1.1');
        expect(result.containerCount).toBe(10);
        // ...and it still reports 2 apps, not 10 -- the miscount from #190 stays fixed.
        expect(result.appCount).toBe(2);
        expect(result.appNames).toEqual(['alpha', 'beta']);
    });

    it('breaks a container tie on distinct apps -- same load, more varied work', async () => {
        axios.get.mockResolvedValue(apiResponse([
            // 4 containers, 2 apps.
            node({ ip: '1.1.1.1', names: ['/fluxa_one', '/fluxb_one', '/fluxa_two', '/fluxb_two'] }),
            // 4 containers, 4 apps.
            node({ ip: '2.2.2.2', names: ['/fluxx_one', '/fluxx_two', '/fluxx_three', '/fluxx_four'] })
        ]));

        const result = await getBusiestNode();

        expect(result.ip).toBe('2.2.2.2');
        expect(result.containerCount).toBe(4);
        expect(result.appCount).toBe(4);
    });

    it('keeps the first node on a full tie, so the choice is stable between fetches', async () => {
        // Same containers AND same app count -- nothing left to separate them.
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '1.1.1.1', names: ['/fluxx_one', '/fluxx_two'] }),
            node({ ip: '2.2.2.2', names: ['/fluxx_three', '/fluxx_four'] })
        ]));

        expect((await getBusiestNode()).ip).toBe('1.1.1.1');
    });
});

describe('appNameForContainer', () => {
    it('prefers the spec cache, which confirms the app', () => {
        expect(appNameForContainer('/fluxfm1_myapp')).toBe('myapp');
    });

    it('falls back to the container name for an app the cache does not know', () => {
        expect(appNameForContainer('/fluxoperator_wordpress1691169388403')).toBe('wordpress1691169388403');
    });

    it('handles a legacy flat-spec container with no component prefix', () => {
        expect(appNameForContainer('/fluxpresearchnode')).toBe('presearchnode');
    });

    it('splits at the FIRST underscore, so an app name may contain underscores', () => {
        expect(appNameForContainer('/fluxweb_my_app_name')).toBe('my_app_name');
    });

    it('returns null for nothing usable', () => {
        expect(appNameForContainer(null)).toBeNull();
        expect(appNameForContainer('')).toBeNull();
        expect(appNameForContainer('/flux')).toBeNull();
    });
});

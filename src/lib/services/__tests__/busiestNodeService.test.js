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
    clearBusiestNodeCache
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

    it('resolves app names via appSpecsCache, dropping unresolved entries from the name list', async () => {
        axios.get.mockResolvedValue(apiResponse([
            node({ ip: '9.9.9.9', names: ['/fluxfm1_myapp', '/fluxunknown_thing', '/fluxWeb_site'] })
        ]));

        const result = await getBusiestNode();

        expect(result.appCount).toBe(3);            // raw count, unaffected by resolution
        expect(result.appNames).toEqual(['myapp', 'site']);   // only the resolved ones
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

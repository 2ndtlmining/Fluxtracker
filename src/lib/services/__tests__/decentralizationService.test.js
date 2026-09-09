import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Decentralization metric (issue #108): % of node IPs in known datacenters vs. not,
 * classified gradually via the free ipwho.is/ip-api.com chain and cached in the DB.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

vi.mock('../busiestNodeService.js', () => ({
    getBusiestNode: vi.fn().mockResolvedValue(null),
    getCachedNetworkNodeIps: vi.fn().mockReturnValue([])
}));

vi.mock('../../db/database.js', () => ({
    getAllNodeIpClassifications: vi.fn().mockResolvedValue([]),
    upsertNodeIpClassifications: vi.fn().mockResolvedValue(0)
}));

import axios from 'axios';
import { getBusiestNode, getCachedNetworkNodeIps } from '../busiestNodeService.js';
import { getAllNodeIpClassifications, upsertNodeIpClassifications } from '../../db/database.js';
import {
    isKnownDatacenterOrg,
    classifyIp,
    runDecentralizationCycle,
    getDecentralizationStats,
    clearDecentralizationStatsCache
} from '../decentralizationService.js';

function ipwhoisResponse(overrides = {}) {
    return {
        data: {
            success: true,
            ip: '1.2.3.4',
            connection: { asn: 24940, org: 'Hetzner Online GmbH', isp: 'Hetzner Online GmbH', domain: 'hetzner.com' },
            ...overrides
        }
    };
}

function ipApiResponse(overrides = {}) {
    return {
        data: {
            status: 'success',
            as: 'AS24940 Hetzner Online GmbH',
            isp: 'Hetzner Online GmbH',
            org: 'Hetzner Online GmbH',
            query: '1.2.3.4',
            ...overrides
        }
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearDecentralizationStatsCache();
    getBusiestNode.mockResolvedValue(null);
    getCachedNetworkNodeIps.mockReturnValue([]);
    getAllNodeIpClassifications.mockResolvedValue([]);
    upsertNodeIpClassifications.mockResolvedValue(0);
});

describe('isKnownDatacenterOrg', () => {
    it('matches a known cloud/hosting provider, case-insensitively', () => {
        expect(isKnownDatacenterOrg('Hetzner Online GmbH')).toBe(true);
        expect(isKnownDatacenterOrg('AMAZON-02')).toBe(true);
        expect(isKnownDatacenterOrg('digitalocean, llc')).toBe(true);
    });

    it('is false for a residential/consumer ISP', () => {
        expect(isKnownDatacenterOrg('Free SAS')).toBe(false);
        expect(isKnownDatacenterOrg('SingTel Optus Pty Ltd')).toBe(false);
    });

    it('does not false-positive on a substring match for an unrelated word (e.g. Colombia)', () => {
        expect(isKnownDatacenterOrg('Telefonica Colombia')).toBe(false);
    });

    it('handles missing/empty input without throwing', () => {
        expect(isKnownDatacenterOrg(null)).toBe(false);
        expect(isKnownDatacenterOrg(undefined)).toBe(false);
        expect(isKnownDatacenterOrg('')).toBe(false);
    });
});

describe('classifyIp', () => {
    it('classifies via ipwho.is, marking a known datacenter org', async () => {
        axios.get.mockResolvedValueOnce(ipwhoisResponse());

        const result = await classifyIp('1.2.3.4');

        expect(result).toEqual({ asn: 24940, org: 'Hetzner Online GmbH', isDatacenter: true });
    });

    it('strips the app port before looking up the IP', async () => {
        axios.get.mockResolvedValueOnce(ipwhoisResponse());

        await classifyIp('1.2.3.4:16137');

        expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('1.2.3.4'), expect.anything());
        expect(axios.get).toHaveBeenCalledWith(expect.not.stringContaining('16137'), expect.anything());
    });

    it('falls back to ip-api.com when ipwho.is fails', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('network down'))
            .mockResolvedValueOnce(ipApiResponse());

        const result = await classifyIp('1.2.3.4');

        expect(result).toEqual({ asn: 24940, org: 'Hetzner Online GmbH', isDatacenter: true });
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('marks a residential ISP as not a datacenter', async () => {
        axios.get.mockResolvedValueOnce(ipwhoisResponse({
            connection: { asn: 12322, org: 'Free SAS', isp: 'Free SAS', domain: 'free.fr' }
        }));

        const result = await classifyIp('82.65.75.131');

        expect(result.isDatacenter).toBe(false);
    });

    it('throws with both providers\' errors when both fail', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('ipwhois down'))
            .mockRejectedValueOnce(new Error('ipapi down'));

        await expect(classifyIp('1.2.3.4')).rejects.toThrow(/ipwhois down.*ipapi down/s);
    });

    it('rejects an invalid IP without making a network call', async () => {
        await expect(classifyIp('')).rejects.toThrow(/invalid ip/i);
        await expect(classifyIp(null)).rejects.toThrow(/invalid ip/i);
        expect(axios.get).not.toHaveBeenCalled();
    });
});

describe('runDecentralizationCycle', () => {
    it('does nothing when there are no candidate node IPs yet', async () => {
        getCachedNetworkNodeIps.mockReturnValue([]);

        await runDecentralizationCycle();

        expect(getAllNodeIpClassifications).not.toHaveBeenCalled();
        expect(upsertNodeIpClassifications).not.toHaveBeenCalled();
    });

    it('classifies unclassified candidate IPs and upserts the results', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1', '2.2.2.2']);
        getAllNodeIpClassifications.mockResolvedValue([]);
        axios.get.mockResolvedValue(ipwhoisResponse());

        await runDecentralizationCycle();

        expect(upsertNodeIpClassifications).toHaveBeenCalledTimes(1);
        const [rows] = upsertNodeIpClassifications.mock.calls[0];
        expect(rows.map(r => r.ip).sort()).toEqual(['1.1.1.1', '2.2.2.2']);
        expect(rows.every(r => r.isDatacenter === true)).toBe(true);
    });

    it('skips IPs already classified recently (not stale)', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1.1.1.1', isDatacenter: true, classifiedAt: Date.now() }
        ]);

        await runDecentralizationCycle();

        expect(axios.get).not.toHaveBeenCalled();
        expect(upsertNodeIpClassifications).not.toHaveBeenCalled();
    });

    it('re-classifies an IP whose classification has gone stale', async () => {
        const THIRTY_ONE_DAYS_AGO = Date.now() - 31 * 24 * 60 * 60 * 1000;
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1.1.1.1', isDatacenter: false, classifiedAt: THIRTY_ONE_DAYS_AGO }
        ]);
        axios.get.mockResolvedValue(ipwhoisResponse());

        await runDecentralizationCycle();

        expect(upsertNodeIpClassifications).toHaveBeenCalledTimes(1);
    });

    it('caps the batch at DECENTRALIZATION_CONFIG.batchSize (20)', async () => {
        const ips = Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`);
        getCachedNetworkNodeIps.mockReturnValue(ips);
        getAllNodeIpClassifications.mockResolvedValue([]);
        axios.get.mockResolvedValue(ipwhoisResponse());

        await runDecentralizationCycle();

        const [rows] = upsertNodeIpClassifications.mock.calls[0];
        expect(rows.length).toBe(20);
    });

    it('continues the batch past a single IP failing classification', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1', '2.2.2.2']);
        getAllNodeIpClassifications.mockResolvedValue([]);
        axios.get
            .mockRejectedValueOnce(new Error('ipwhois down for 1.1.1.1'))
            .mockRejectedValueOnce(new Error('ipapi down for 1.1.1.1'))
            .mockResolvedValueOnce(ipwhoisResponse({ ip: '2.2.2.2' }));

        await runDecentralizationCycle();

        const [rows] = upsertNodeIpClassifications.mock.calls[0];
        expect(rows.map(r => r.ip)).toEqual(['2.2.2.2']);
    });

    it('never throws — a total failure just leaves classification for next cycle', async () => {
        getBusiestNode.mockRejectedValue(new Error('flux api down'));
        getCachedNetworkNodeIps.mockReturnValue([]);

        await expect(runDecentralizationCycle()).resolves.toBeUndefined();
    });
});

describe('getDecentralizationStats', () => {
    it('computes datacenterPercent over the classified subset and coveragePercent over all candidates', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1.1.1.1', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '2.2.2.2', isDatacenter: false, classifiedAt: Date.now() }
        ]);

        const stats = await getDecentralizationStats();

        expect(stats.totalNodes).toBe(4);
        expect(stats.classifiedCount).toBe(2);
        expect(stats.datacenterCount).toBe(1);
        expect(stats.datacenterPercent).toBe(50);
        expect(stats.coveragePercent).toBe(50);
    });

    it('only counts classifications for IPs still in the current candidate set', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([
            { ip: '1.1.1.1', isDatacenter: true, classifiedAt: Date.now() },
            { ip: '9.9.9.9', isDatacenter: false, classifiedAt: Date.now() } // no longer a live node
        ]);

        const stats = await getDecentralizationStats();

        expect(stats.classifiedCount).toBe(1);
        expect(stats.datacenterCount).toBe(1);
    });

    it('reports datacenterPercent as null (not 0) when nothing is classified yet', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([]);

        const stats = await getDecentralizationStats();

        expect(stats.classifiedCount).toBe(0);
        expect(stats.datacenterPercent).toBeNull();
        expect(stats.coveragePercent).toBe(0);
    });

    it('caches the snapshot rather than recomputing on every call', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([]);

        await getDecentralizationStats();
        await getDecentralizationStats();

        expect(getAllNodeIpClassifications).toHaveBeenCalledTimes(1);
    });

    it('a scheduler cycle refreshes the cache the next getDecentralizationStats call reads', async () => {
        getCachedNetworkNodeIps.mockReturnValue(['1.1.1.1']);
        getAllNodeIpClassifications.mockResolvedValue([]);
        axios.get.mockResolvedValue(ipwhoisResponse());

        await runDecentralizationCycle();
        const stats = await getDecentralizationStats();

        expect(stats.classifiedCount).toBe(1);
        expect(getAllNodeIpClassifications).toHaveBeenCalledTimes(1); // only the cycle's own read
    });
});

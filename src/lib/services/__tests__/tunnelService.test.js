import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #532 — tunnelled nodes, from FluxOS 8.21's flux.uplink.tunnel verdict.
 *
 * The share is likely / nodes reporting the field. Nodes on an older FluxOS have not said
 * either way, so they stay out of the denominator; counting them as "none" would understate
 * the share by however many nodes have not upgraded yet.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn()
}));

import { resilientFetch } from '../resilientFetch.js';
import { updateCurrentMetrics, updateSyncStatus } from '../../db/database.js';
import { countTunnels, summariseFluxInfo, clearFluxInfoCache } from '../fluxInfoFeed.js';
import { fetchTunnelStats, refreshTunnelStatsIfStale, __resetTunnelCacheForTests } from '../tunnelService.js';
import { getArcaneCodename, clearArcaneCodenameCache } from '../arcaneCodenameService.js';

const node = tunnel => ({ flux: { uplink: { tunnel, mtu: 1500, rttMs: 0.2 } } });

beforeEach(() => {
    vi.clearAllMocks();
    clearFluxInfoCache();
    clearArcaneCodenameCache();
    __resetTunnelCacheForTests();
});

describe('countTunnels', () => {
    it('divides likely by the nodes that report the field', () => {
        const records = [node('likely'), node('none'), node('none'), node('unknown'), { flux: { version: '8.20.0' } }];

        expect(countTunnels(records)).toEqual({ likely: 1, none: 2, unknown: 1, percent: 25 });
    });

    it('counts an unrecognised verdict as unknown, not as none', () => {
        expect(countTunnels([node('likely'), node('maybe'), node(undefined)]))
            .toEqual({ likely: 1, none: 0, unknown: 2, percent: 33.33 });
    });

    it('is null when no node reports the field, so a bad payload is a gap and not 0%', () => {
        expect(countTunnels([])).toBeNull();
        expect(countTunnels(undefined)).toBeNull();
        expect(countTunnels([{ flux: {} }, null, { flux: { uplink: null } }])).toBeNull();
    });
});

describe('summariseFluxInfo', () => {
    it('reads the codename and the tunnel counts from one payload', () => {
        const summary = summariseFluxInfo({
            data: [node('none'), { flux: { arcaneHumanVersion: 'jolly wombat', uplink: { tunnel: 'likely' } } }]
        });

        expect(summary).toEqual({ codename: 'jolly wombat', tunnels: { likely: 1, none: 1, unknown: 0, percent: 50 } });
    });
});

describe('fetchTunnelStats', () => {
    it('writes the four columns in one update', async () => {
        resilientFetch.mockResolvedValueOnce({ data: [node('likely'), node('none'), node('none'), node('none')] });

        const result = await fetchTunnelStats();

        const expected = { node_tunnel_likely: 1, node_tunnel_none: 3, node_tunnel_unknown: 0, node_tunnel_percent: 25 };
        expect(result).toEqual(expected);
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
        expect(updateCurrentMetrics).toHaveBeenCalledWith(expected);
        expect(updateSyncStatus).toHaveBeenCalledWith('tunnels', 'completed');
    });

    it('throws and writes nothing when no node reports the field', async () => {
        resilientFetch.mockResolvedValueOnce({ data: [] });

        await expect(fetchTunnelStats()).rejects.toThrow(/flux\.uplink/);
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        expect(updateSyncStatus).toHaveBeenCalledWith('tunnels', 'failed', expect.any(String));
    });

    it('throws when the fetch fails, so the step is recorded as failed', async () => {
        resilientFetch.mockRejectedValueOnce(new Error('upstream down'));

        await expect(fetchTunnelStats()).rejects.toThrow('upstream down');
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
    });
});

describe('one download for the codename and the tunnel count', () => {
    it('the header codename reuses the payload the tunnel count fetched', async () => {
        resilientFetch.mockResolvedValueOnce({
            data: [{ flux: { arcaneHumanVersion: 'jolly wombat', uplink: { tunnel: 'none' } } }]
        });

        await fetchTunnelStats();
        expect(await getArcaneCodename()).toBe('jolly wombat');

        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });
});

describe('refreshTunnelStatsIfStale', () => {
    it('fetches once, then skips until the hour is up', async () => {
        resilientFetch.mockResolvedValue({ data: [node('none')] });

        await refreshTunnelStatsIfStale();
        const second = await refreshTunnelStatsIfStale();

        expect(second).toEqual({ skipped: true });
        expect(resilientFetch).toHaveBeenCalledTimes(1);
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
    });

    it('retries on the next cycle after a failure', async () => {
        resilientFetch.mockRejectedValueOnce(new Error('upstream down'));
        await expect(refreshTunnelStatsIfStale()).rejects.toThrow();

        resilientFetch.mockResolvedValueOnce({ data: [node('likely')] });
        await refreshTunnelStatsIfStale();

        expect(resilientFetch).toHaveBeenCalledTimes(2);
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
    });
});

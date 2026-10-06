import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The live half of expired-running detection: the per-app permanentmessages lookup, its
 * cache, and the guards that make an unavailable input read as "unknown", never as 0.
 */

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({ getRunningApps: (...a) => mockGetRunningApps(...a) }));
const mockSpecs = vi.fn();
vi.mock('../appSpecsCache.js', () => ({ getAllAppSpecs: (...a) => mockSpecs(...a) }));
const mockBlock = vi.fn();
vi.mock('../fluxNetworkData.js', () => ({ fetchCurrentBlockHeight: (...a) => mockBlock(...a) }));
const mockFetch = vi.fn();
vi.mock('../resilientFetch.js', () => ({ resilientFetch: (...a) => mockFetch(...a) }));

import { getExpiredRunning, lookupEndBlock, clearExpiredRunningCaches } from '../expiredRunningService.js';

const BLOCK = 3_012_176;
const messages = (...m) => ({ status: 'success', data: m.map(([height, expire]) => ({ height, appSpecifications: { expire } })) });

function census(apps) {
    return {
        deploymentCounts: new Map(Object.entries(apps).map(([n, c]) => [n.toLowerCase(), c])),
        deploymentNames: new Map(Object.keys(apps).map(n => [n.toLowerCase(), n]))
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearExpiredRunningCaches();
    mockBlock.mockResolvedValue(BLOCK);
    mockSpecs.mockReturnValue([{ name: 'live', height: BLOCK, expire: 1000 }]);
});

describe('lookupEndBlock', () => {
    it('uses the highest-height message: height + expire', async () => {
        mockFetch.mockResolvedValue(messages([2_960_391, 20160], [2_989_904, 100], [2_962_953, 105618]));
        expect(await lookupEndBlock('dragonwilds1789699856366')).toBe(2_990_004);
    });

    it('queries with the original-case name, URL-encoded', async () => {
        mockFetch.mockResolvedValue(messages([10, 100]));
        await lookupEndBlock('AbioticFactor');
        expect(mockFetch.mock.calls[0][0]).toMatch(/permanentmessages\?appname=AbioticFactor$/);
        expect(mockFetch.mock.calls[0][1]).toMatchObject({ breakerKey: 'permanent-messages-app' });
    });

    it('returns null when the app has no messages', async () => {
        mockFetch.mockResolvedValue({ status: 'success', data: [] });
        expect(await lookupEndBlock('v11')).toBeNull();
    });

    it('throws on an error body', async () => {
        mockFetch.mockResolvedValue({ status: 'error', data: { message: 'boom' } });
        await expect(lookupEndBlock('a')).rejects.toThrow();
    });
});

describe('getExpiredRunning', () => {
    it('looks up spec-less apps with their original casing and counts the expired ones', async () => {
        mockGetRunningApps.mockResolvedValue(census({ live: 2, AbioticFactor: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3 - 100, 100]));

        const r = await getExpiredRunning();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch.mock.calls[0][0]).toContain('appname=AbioticFactor');
        expect(r).toMatchObject({ apps: 1, instances: 1, unresolved: 0 });
        expect(r.top[0]).toMatchObject({ name: 'AbioticFactor', daysExpired: 3 });
    });

    it('caches a resolved end block: no second request next cycle', async () => {
        mockGetRunningApps.mockResolvedValue(census({ gone: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3 - 100, 100]));
        await getExpiredRunning();
        await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed lookup, and never counts it', async () => {
        mockGetRunningApps.mockResolvedValue(census({ gone: 1 }));
        mockFetch.mockRejectedValueOnce(new Error('timeout'));
        const first = await getExpiredRunning();
        expect(first).toMatchObject({ apps: 0, unresolved: 1 });

        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3 - 100, 100]));
        const second = await getExpiredRunning();
        expect(second).toMatchObject({ apps: 1, unresolved: 0 });
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('caches "no messages" for 24 h', async () => {
        vi.useFakeTimers();
        try {
            mockGetRunningApps.mockResolvedValue(census({ v11: 1 }));
            mockFetch.mockResolvedValue({ status: 'success', data: [] });
            await getExpiredRunning();
            await getExpiredRunning();
            expect(mockFetch).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
            await getExpiredRunning();
            expect(mockFetch).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('forgets a cached end block once the app has a spec again (renewal)', async () => {
        mockGetRunningApps.mockResolvedValue(census({ app: 1 }));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 40 - 100, 100]));
        await getExpiredRunning();                                   // cached: 40 days

        mockSpecs.mockReturnValue([{ name: 'app', height: BLOCK, expire: 1000 }]);
        expect((await getExpiredRunning()).apps).toBe(0);            // renewed -> live

        // Expired again later: its spec is gone (another app keeps the specs list non-empty).
        mockSpecs.mockReturnValue([{ name: 'other', height: BLOCK, expire: 1000 }]);
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 2 - 100, 100]));
        const r = await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(2);                  // looked up afresh
        expect(r.top[0].daysExpired).toBe(2);                        // not the stale 40
    });

    it('caps lookups per run; the rest wait as unresolved', async () => {
        const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`app${i}`, 1]));
        mockGetRunningApps.mockResolvedValue(census(many));
        mockFetch.mockResolvedValue(messages([BLOCK - 2880 * 3 - 100, 100]));
        const r = await getExpiredRunning();
        expect(mockFetch).toHaveBeenCalledTimes(50);
        expect(r.apps).toBe(50);
        expect(r.unresolved).toBe(10);
    });

    it('returns null without a block height', async () => {
        mockGetRunningApps.mockResolvedValue(census({ a: 1 }));
        mockBlock.mockRejectedValue(new Error('down'));
        expect(await getExpiredRunning()).toBeNull();
    });

    it('returns null when the specs cache is empty, rather than looking up every app', async () => {
        mockGetRunningApps.mockResolvedValue(census({ a: 1, b: 1 }));
        mockSpecs.mockReturnValue([]);
        expect(await getExpiredRunning()).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when the census fails', async () => {
        mockGetRunningApps.mockRejectedValue(new Error('down'));
        expect(await getExpiredRunning()).toBeNull();
    });

    it('serves a recent result within ttlMs without recomputing', async () => {
        mockGetRunningApps.mockResolvedValue(census({ live: 1 }));
        await getExpiredRunning();
        await getExpiredRunning({ ttlMs: 60_000 });
        expect(mockGetRunningApps).toHaveBeenCalledTimes(1);
    });
});

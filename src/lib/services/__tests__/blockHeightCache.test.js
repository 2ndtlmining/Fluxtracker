import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #415 -- one cached block height for every caller. getblockcount takes ~1.3 s, and the
 * footer and header waited on it per request. It is cached for 20 s, deduplicated while in
 * flight, and falls back to the last good height (up to 5 minutes old) when the daemon fails.
 */

const { resilientFetch } = vi.hoisted(() => ({ resilientFetch: vi.fn() }));
vi.mock('../resilientFetch.js', () => ({ resilientFetch }));
vi.mock('../../db/database.js', () => ({ updateCurrentMetrics: vi.fn() }));

import { fetchCurrentBlockHeight, clearBlockHeightCache } from '../fluxNetworkData.js';

const ok = height => ({ status: 'success', data: height });
let now;

beforeEach(() => {
    clearBlockHeightCache();
    resilientFetch.mockReset();
    now = Date.parse('2026-09-29T10:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => vi.restoreAllMocks());

describe('fetchCurrentBlockHeight cache (issue #415)', () => {
    it('serves a height fetched in the last 20 s without calling the daemon', async () => {
        resilientFetch.mockResolvedValue(ok(2991000));
        expect(await fetchCurrentBlockHeight()).toBe(2991000);
        now += 19_000;
        expect(await fetchCurrentBlockHeight()).toBe(2991000);
        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('past 20 s answers at once with the cached height and refreshes in the background', async () => {
        resilientFetch.mockResolvedValueOnce(ok(2991000)).mockResolvedValueOnce(ok(2991001));
        await fetchCurrentBlockHeight();
        now += 21_000;

        // No wait on the daemon: this used to cost one caller ~1.2 s every 20 s
        expect(await fetchCurrentBlockHeight()).toBe(2991000);
        expect(resilientFetch).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(fetchCurrentBlockHeight()).resolves.toBe(2991001));
    });

    it('a failed background refresh keeps the cached height and does not throw', async () => {
        resilientFetch.mockResolvedValueOnce(ok(2991000)).mockRejectedValueOnce(new Error('daemon down'));
        await fetchCurrentBlockHeight();
        now += 60_000;

        expect(await fetchCurrentBlockHeight()).toBe(2991000);
    });

    it('a cold cache, or one older than 5 minutes, waits for the daemon', async () => {
        resilientFetch.mockResolvedValueOnce(ok(2991000)).mockResolvedValueOnce(ok(2991020));
        expect(await fetchCurrentBlockHeight()).toBe(2991000);
        now += 6 * 60_000;
        expect(await fetchCurrentBlockHeight()).toBe(2991020);
    });

    it('shares one request between concurrent callers', async () => {
        let release;
        resilientFetch.mockImplementation(() => new Promise(r => { release = () => r(ok(2991000)); }));
        const calls = [fetchCurrentBlockHeight(), fetchCurrentBlockHeight(), fetchCurrentBlockHeight()];
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        release();
        expect(await Promise.all(calls)).toEqual([2991000, 2991000, 2991000]);
        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to the last good height for up to 5 minutes when the daemon fails', async () => {
        resilientFetch.mockResolvedValueOnce(ok(2991000));
        await fetchCurrentBlockHeight();

        resilientFetch.mockRejectedValue(new Error('daemon down'));
        now += 4 * 60_000;
        expect(await fetchCurrentBlockHeight()).toBe(2991000);

        now += 2 * 60_000; // 6 minutes old now: too stale to stand in
        await expect(fetchCurrentBlockHeight()).rejects.toThrow('daemon down');
    });

    it('throws when the daemon fails and there is no height yet', async () => {
        resilientFetch.mockRejectedValue(new Error('daemon down'));
        await expect(fetchCurrentBlockHeight()).rejects.toThrow('daemon down');
    });

    it('rejects a height of 0 (it would mark every spec as expiring in the future)', async () => {
        resilientFetch.mockResolvedValue(ok(0));
        await fetchCurrentBlockHeight().catch(() => {});
        const { validate } = resilientFetch.mock.calls[0][1];
        expect(validate(ok(0))).toBe(false);
        expect(validate({ status: 'error', data: 5 })).toBe(false);
        expect(validate(ok(2991000))).toBe(true);
    });
});

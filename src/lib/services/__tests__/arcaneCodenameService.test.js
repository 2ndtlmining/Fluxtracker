import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #221 — /api/header re-downloaded the whole network's fluxinfo document, measured
 * live at 3,764,706 bytes and 1.28s, to pluck one string that changes about monthly. The
 * 30s cache TTL sat under a 30s client poll, so roughly every second poll missed:
 * ~1,440 fetches/day, ~5.4 GB/day inbound, independent of how many people were looking.
 *
 * It also bypassed resilientFetch, against the rule CLAUDE.md states for every outbound
 * GET. That matters more than the bytes: undici's fetch has no per-request timeout, so a
 * STALLED upstream (not a rejected one) held each request for minutes, and `.catch(() =>
 * null)` cannot help with that. Header.svelte already documents net::ERR_NO_BUFFER_SPACE
 * from stalled /api/header fetches stacking up.
 *
 * Same shape as hostLocationService: module-level cache, in-flight dedup, never throws.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));

import { resilientFetch } from '../resilientFetch.js';
import {
    getArcaneCodename,
    clearArcaneCodenameCache,
    ARCANE_CODENAME_TTL_MS
} from '../arcaneCodenameService.js';

const payload = (codename) => ({
    data: [
        { flux: { version: '8.18.0' } },
        { flux: { arcaneHumanVersion: codename } },
        { flux: { arcaneHumanVersion: 'later node, ignored' } }
    ]
});

beforeEach(() => {
    vi.clearAllMocks();
    clearArcaneCodenameCache();
});

describe('getArcaneCodename', () => {
    it('returns the first node carrying a codename', async () => {
        resilientFetch.mockResolvedValueOnce(payload('jolly wombat'));

        expect(await getArcaneCodename()).toBe('jolly wombat');
    });

    it('goes through resilientFetch with a breaker key and a real timeout', async () => {
        resilientFetch.mockResolvedValueOnce(payload('jolly wombat'));

        await getArcaneCodename();

        const [, options] = resilientFetch.mock.calls[0];
        expect(options.breakerKey).toBeTruthy();
        expect(options.timeout).toBeGreaterThan(0);
    });

    it('serves later calls from cache instead of re-downloading 3.76 MB', async () => {
        resilientFetch.mockResolvedValueOnce(payload('jolly wombat'));

        await getArcaneCodename();
        await getArcaneCodename();
        await getArcaneCodename();

        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('holds the value for hours, not seconds', () => {
        expect(ARCANE_CODENAME_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    });

    it('collapses concurrent callers into one fetch', async () => {
        // Without dedup, every viewer whose poll lands in the same miss window pays its
        // own full download -- a cache stampede on a 3.76 MB payload.
        let release;
        resilientFetch.mockImplementationOnce(() => new Promise(r => { release = () => r(payload('jolly wombat')); }));

        const all = Promise.all([getArcaneCodename(), getArcaneCodename(), getArcaneCodename()]);
        release();

        expect(await all).toEqual(['jolly wombat', 'jolly wombat', 'jolly wombat']);
        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('returns null rather than throwing when the fetch fails', async () => {
        resilientFetch.mockRejectedValueOnce(new Error('upstream down'));

        await expect(getArcaneCodename()).resolves.toBeNull();
    });

    it('keeps serving the last good value after a later failure', async () => {
        resilientFetch.mockResolvedValueOnce(payload('jolly wombat'));
        await getArcaneCodename();

        clearArcaneCodenameCache.length; // no-op, keep the cache
        resilientFetch.mockRejectedValueOnce(new Error('upstream down'));

        // Still cached, so no second call happens at all.
        expect(await getArcaneCodename()).toBe('jolly wombat');
        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('returns null when no node reports a codename', async () => {
        resilientFetch.mockResolvedValueOnce({ data: [{ flux: { version: '8.18.0' } }] });

        await expect(getArcaneCodename()).resolves.toBeNull();
    });
});

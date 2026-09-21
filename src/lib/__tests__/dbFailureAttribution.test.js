import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #219 — withDbFallback recorded a DATABASE failure for any error thrown inside it.
 *
 * Two endpoints do upstream-only work in the wrapper (/api/apps/deployment-fill, and
 * /api/games/live which does upstream AND database work). `api.runonflux.io` going down,
 * polled from a few open tabs, reached the breaker's 5-failure threshold in one burst and
 * tripped the DB breaker -- 503ing every other endpoint, stopping snapshot checks, and
 * auto-failing-over Supabase while the primary was healthy.
 *
 * The mirror of the same bug: recordSuccess() fired for an upstream-only route that never
 * touched the database, so a healthy Flux API could keep clearing the failure count of a
 * database that was genuinely down.
 */

vi.mock('../db/circuitBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
}));

import { withDbFallback, createCache } from '../serverHelpers.js';
import { recordSuccess, recordFailure } from '../db/circuitBreaker.js';
import { instrumentAdapter } from '../db/dbCallTracker.js';

/** Stands in for the real adapter: its throws are tagged, an upstream client's are not. */
const db = instrumentAdapter({
    read: async () => ({ rows: 1 }),
    readFailing: async () => { throw new Error('connection refused'); }
});

const fetchUpstream = async () => { throw new Error('api.runonflux.io returned 502'); };

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('withDbFallback failure attribution (issue #219)', () => {
    it('does not blame the database for an upstream failure', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, fetchUpstream);

        expect(recordFailure).not.toHaveBeenCalled();
    });

    it('still answers 503 with the error so the client behaviour is unchanged', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, fetchUpstream);

        expect(res.statusCode).toBe(503);
        expect(res.body.error).toMatch(/runonflux/);
    });

    it('serves stale cache on an upstream failure, as before', async () => {
        const cache = createCache(1000);
        const res1 = fakeRes();
        await withDbFallback(cache, 'k', res1, async () => ({ value: 'fresh' }));

        // Expire the entry, then fail upstream.
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 5000);
        const res2 = fakeRes();
        await withDbFallback(cache, 'k', res2, fetchUpstream);
        vi.useRealTimers();

        expect(res2.statusCode).toBe(503);
        expect(res2.body).toMatchObject({ value: 'fresh', _stale: true });
    });

    it('does blame the database when the database is what failed', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, () => db.readFailing());

        expect(recordFailure).toHaveBeenCalledTimes(1);
    });

    it('blames the database when a mixed route fails on its database call', async () => {
        // /api/games/live does upstream work AND a database read. Which one broke decides.
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, async () => {
            const live = { total: 5 };
            const history = await db.readFailing();
            return { ...live, history };
        });

        expect(recordFailure).toHaveBeenCalledTimes(1);
    });

    it('does not blame the database when a mixed route fails upstream', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, async () => {
            await db.read();
            return await fetchUpstream();
        });

        expect(recordFailure).not.toHaveBeenCalled();
    });
});

describe('withDbFallback success attribution (issue #219)', () => {
    it('clears the failure count when a database read succeeded', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, () => db.read());

        expect(recordSuccess).toHaveBeenCalledTimes(1);
        expect(res.statusCode).toBe(200);
    });

    it('does not clear it for a route that never touched the database', async () => {
        const res = fakeRes();

        await withDbFallback(createCache(1000), 'k', res, async () => ({ apps: 450 }));

        expect(recordSuccess).not.toHaveBeenCalled();
        expect(res.body).toEqual({ apps: 450 });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #221 — withDbFallback checked the cache and then called fetchFn(), with nothing in
 * between. Every concurrent viewer whose poll landed in the same miss window paid its own
 * full upstream fetch and its own database fan-out: a cache stampede, worst on /api/header
 * where a miss meant a 3.76 MB download plus two exact counts of revenue_transactions.
 *
 * Dedup here benefits every cached endpoint at once, which is why it belongs in the helper
 * rather than in each route. runningAppsProvider.getRunningApps() already uses the pattern.
 */

vi.mock('../db/circuitBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
}));

import { withDbFallback, createCache } from '../serverHelpers.js';

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

/** Let every pending microtask run, so releasing does not race the helper calling fetchFn. */
const tick = () => new Promise(r => setTimeout(r, 0));

/**
 * A fetchFn that stays pending until released, so concurrency is deterministic.
 *
 * Every invocation's resolver is kept, not just the last: without dedup the helper calls
 * fetchFn once per caller, and releasing only the newest would make these tests fail by
 * timing out instead of on the call count that is actually being asserted.
 */
function deferred(value) {
    const pending = [];
    const fn = vi.fn(() => new Promise(r => pending.push(() => r(value))));
    return { fn, release: () => pending.forEach(r => r()) };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('withDbFallback in-flight dedup (issue #221)', () => {
    it('runs one fetch for concurrent misses on the same key', async () => {
        const cache = createCache(30_000);
        const { fn, release } = deferred({ value: 'expensive' });
        const responses = [fakeRes(), fakeRes(), fakeRes()];

        const all = Promise.all(responses.map(res => withDbFallback(cache, 'header', res, fn)));
        await tick();
        release();
        await all;

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('answers every one of those callers with the same payload', async () => {
        const cache = createCache(30_000);
        const { fn, release } = deferred({ value: 'expensive' });
        const responses = [fakeRes(), fakeRes(), fakeRes()];

        const all = Promise.all(responses.map(res => withDbFallback(cache, 'header', res, fn)));
        await tick();
        release();
        await all;

        for (const res of responses) {
            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual({ value: 'expensive' });
        }
    });

    it('keeps different cache keys independent', async () => {
        const cache = createCache(30_000);
        const a = deferred({ value: 'a' });
        const b = deferred({ value: 'b' });
        const resA = fakeRes();
        const resB = fakeRes();

        const all = Promise.all([
            withDbFallback(cache, 'key-a', resA, a.fn),
            withDbFallback(cache, 'key-b', resB, b.fn)
        ]);
        await tick();
        a.release();
        b.release();
        await all;

        expect(resA.body).toEqual({ value: 'a' });
        expect(resB.body).toEqual({ value: 'b' });
    });

    it('shares one failure across concurrent callers without re-running the fetch', async () => {
        const cache = createCache(30_000);
        const pending = [];
        const fn = vi.fn(() => new Promise((_, reject) => pending.push(() => reject(new Error('upstream down')))));
        const responses = [fakeRes(), fakeRes()];

        const all = Promise.all(responses.map(res => withDbFallback(cache, 'header', res, fn)));
        await tick();
        pending.forEach(r => r());
        await all;

        expect(fn).toHaveBeenCalledTimes(1);
        for (const res of responses) {
            expect(res.statusCode).toBe(503);
            expect(res.body.error).toMatch(/upstream down/);
        }
    });

    it('does not wedge the key after a failure -- the next request retries', async () => {
        const cache = createCache(30_000);
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValueOnce({ value: 'recovered' });

        const failed = fakeRes();
        await withDbFallback(cache, 'header', failed, fn);
        expect(failed.statusCode).toBe(503);

        const ok = fakeRes();
        await withDbFallback(cache, 'header', ok, fn);

        expect(fn).toHaveBeenCalledTimes(2);
        expect(ok.statusCode).toBe(200);
        expect(ok.body).toEqual({ value: 'recovered' });
    });

    it('serves the cache once populated, without another fetch', async () => {
        const cache = createCache(30_000);
        const fn = vi.fn(async () => ({ value: 'once' }));

        await withDbFallback(cache, 'header', fakeRes(), fn);
        const second = fakeRes();
        await withDbFallback(cache, 'header', second, fn);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(second.body).toEqual({ value: 'once' });
    });
});

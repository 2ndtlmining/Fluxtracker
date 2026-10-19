import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import etag from 'etag';

/**
 * withDbFallback keeps each cached answer's JSON and its ETag, so a cache hit no longer
 * re-serializes the data (res.json) and re-hashes it (Express's ETag) -- ~35 ms of blocked
 * event loop per hit on a 4 MB /snapshots/full answer. The bytes on the wire, the ETag and
 * 304 revalidation must stay exactly what res.json() produced.
 */

vi.mock('../db/circuitBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
}));

import { withDbFallback, createCache } from '../serverHelpers.js';

let server;
afterEach(() => server?.close());

async function serve(handler) {
    const app = express();
    app.get('/x', handler);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${server.address().port}/x`;
}

describe('withDbFallback cached JSON', () => {
    it('serializes once: a cache hit does not stringify the data again', async () => {
        const cache = createCache(60_000);
        const data = { rows: [1, 2, 3] };
        const url = await serve((req, res) => withDbFallback(cache, 'k', res, async () => data));

        await fetch(url);
        const stringify = vi.spyOn(JSON, 'stringify');
        const res = await fetch(url);
        const calls = stringify.mock.calls.length;
        stringify.mockRestore();

        expect(await res.json()).toEqual(data);
        expect(calls).toBe(0);
    });

    it('sends the same body, content type and ETag res.json() would', async () => {
        const cache = createCache(60_000);
        const data = { count: 2, data: [{ a: 'é', b: 1.5 }, { a: null, b: -2 }] };
        const url = await serve((req, res) => withDbFallback(cache, 'k', res, async () => data));

        for (let i = 0; i < 2; i++) { // miss, then hit
            const res = await fetch(url);
            const text = await res.text();
            expect(text).toBe(JSON.stringify(data));
            expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
            expect(res.headers.get('etag')).toBe(etag(text, { weak: true }));
        }
    });

    it('still answers a matching revalidation with 304', async () => {
        const cache = createCache(60_000);
        const url = await serve((req, res) => withDbFallback(cache, 'k', res, async () => ({ v: 1 })));

        const tag = (await fetch(url)).headers.get('etag');
        // max-age=0 as hooks.server.js sends it: Node's fetch otherwise adds no-cache, and
        // Express never answers 304 to that.
        const res = await fetch(url, { headers: { 'if-none-match': tag, 'cache-control': 'max-age=0' } });
        expect(res.status).toBe(304);
    });

    it('passes a deliberate status through to callers that joined the in-flight run', async () => {
        const cache = createCache(60_000);
        let release;
        const gate = new Promise(r => { release = r; });
        const fn = vi.fn(async () => {
            await gate;
            throw Object.assign(new Error('No current metrics found'), { httpStatus: 404 });
        });
        const fakeRes = () => ({
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        });
        const leader = fakeRes();
        const joiner = fakeRes();

        const all = Promise.all([
            withDbFallback(cache, 'k', leader, fn),
            withDbFallback(cache, 'k', joiner, fn)
        ]);
        release();
        await all;

        expect(fn).toHaveBeenCalledTimes(1);
        expect(leader.statusCode).toBe(404);
        expect(joiner.statusCode).toBe(404);
    });
});

// Issue #242: the SvelteKit layer must hand the browser a compressed body -- for the proxied
// /api/* JSON and for its own HTML/JS, neither of which was compressed before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { handle } from '../hooks.server.js';

const bigJson = JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: 'app-node' })) });

/** Minimal stand-in for SvelteKit's RequestEvent, with only what handle() touches. */
function eventFor(path, { acceptEncoding = 'gzip, br', method = 'GET' } = {}) {
    const headers = new Headers();
    if (acceptEncoding) headers.set('accept-encoding', acceptEncoding);
    return {
        url: new URL(`http://localhost:5173${path}`),
        request: new Request(`http://localhost:5173${path}`, { method, headers })
    };
}

const neverResolves = () => {
    throw new Error('resolve() should not be called for an /api/* request');
};

let fetchSpy;

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    fetchSpy = undefined;
});

function stubApi(body, init = { headers: { 'content-type': 'application/json' } }) {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, init));
    return fetchSpy;
}

describe('API proxy compression', () => {
    it('brotli-compresses a large JSON payload for a browser that accepts br', async () => {
        stubApi(bigJson);

        const response = await handle({ event: eventFor('/api/running-apps'), resolve: neverResolves });

        expect(response.headers.get('content-encoding')).toBe('br');
        const raw = Buffer.from(await response.arrayBuffer());
        expect(raw.byteLength).toBeLessThan(bigJson.length / 4);
        expect(brotliDecompressSync(raw).toString()).toBe(bigJson);
    });

    it('gzips for a client that does not accept brotli', async () => {
        stubApi(bigJson);

        const response = await handle({
            event: eventFor('/api/running-apps', { acceptEncoding: 'gzip, deflate' }),
            resolve: neverResolves
        });

        expect(response.headers.get('content-encoding')).toBe('gzip');
        expect(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(bigJson);
    });

    it('asks the API for an identity body, so nothing is gzipped only to be decoded again', async () => {
        stubApi(bigJson);

        await handle({ event: eventFor('/api/running-apps'), resolve: neverResolves });

        const [, init] = fetchSpy.mock.calls[0];
        expect(new Headers(init.headers).get('accept-encoding')).toBe('identity');
    });

    it('serves a plain body to a client that accepts no encoding', async () => {
        stubApi(bigJson);

        const response = await handle({
            event: eventFor('/api/running-apps', { acceptEncoding: null }),
            resolve: neverResolves
        });

        expect(response.headers.get('content-encoding')).toBeNull();
        expect(await response.text()).toBe(bigJson);
    });

    it('still passes the upstream status and cache headers through', async () => {
        stubApi(bigJson, {
            status: 503,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });

        const response = await handle({ event: eventFor('/api/health'), resolve: neverResolves });

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-security-policy')).toBeTruthy();
    });

    it('leaves a small response uncompressed', async () => {
        stubApi('{"ok":true}');

        const response = await handle({ event: eventFor('/api/health'), resolve: neverResolves });

        expect(response.headers.get('content-encoding')).toBeNull();
        expect(await response.text()).toBe('{"ok":true}');
    });

    it('returns the 503 fallback when the API is unreachable', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

        const response = await handle({ event: eventFor('/api/health'), resolve: neverResolves });

        expect(response.status).toBe(503);
        expect(JSON.parse(await response.text()).error).toBe('Backend API unavailable');
    });
});

describe('page response compression', () => {
    it('compresses the SvelteKit HTML response and keeps the hardening headers', async () => {
        const html = `<!doctype html><html><body>${'<p>flux</p>'.repeat(500)}</body></html>`;
        const resolve = async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

        const response = await handle({ event: eventFor('/'), resolve });

        expect(response.headers.get('content-encoding')).toBe('br');
        expect(response.headers.get('vary')).toBe('Accept-Encoding');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString()).toBe(html);
    });

    it('does not touch a server-sent event stream', async () => {
        const resolve = async () =>
            new Response('data: hello\n\n'.repeat(500), { headers: { 'content-type': 'text/event-stream' } });

        const response = await handle({ event: eventFor('/api-stream'), resolve });

        expect(response.headers.get('content-encoding')).toBeNull();
    });
});

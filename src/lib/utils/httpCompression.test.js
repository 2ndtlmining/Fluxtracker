import { describe, it, expect } from 'vitest';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { negotiateEncoding, shouldCompress, compressResponse } from './httpCompression.js';

const json = (bytes) => JSON.stringify({ pad: 'x'.repeat(bytes) });

describe('negotiateEncoding', () => {
    it('prefers brotli when the client accepts both', () => {
        expect(negotiateEncoding('gzip, deflate, br')).toBe('br');
    });

    it('falls back to gzip when brotli is not offered', () => {
        expect(negotiateEncoding('gzip, deflate')).toBe('gzip');
    });

    it('returns null when the client offers no encoding we support', () => {
        expect(negotiateEncoding('deflate')).toBeNull();
        expect(negotiateEncoding('')).toBeNull();
        expect(negotiateEncoding(null)).toBeNull();
    });

    it('honours an explicit q=0 refusal of an encoding', () => {
        expect(negotiateEncoding('br;q=0, gzip')).toBe('gzip');
        expect(negotiateEncoding('gzip;q=0')).toBeNull();
    });
});

describe('shouldCompress', () => {
    it('compresses JSON above the size threshold', () => {
        expect(shouldCompress('application/json', 5000)).toBe(true);
    });

    it('skips bodies below the threshold, where framing costs more than it saves', () => {
        expect(shouldCompress('application/json', 200)).toBe(false);
    });

    it('skips already-compressed media types', () => {
        expect(shouldCompress('image/png', 500000)).toBe(false);
        expect(shouldCompress('application/zip', 500000)).toBe(false);
    });

    it('skips server-sent events, which must not be buffered', () => {
        expect(shouldCompress('text/event-stream', 500000)).toBe(false);
    });

    it('compresses html, css, js and svg', () => {
        for (const type of [
            'text/html; charset=utf-8',
            'text/css',
            'application/javascript',
            'image/svg+xml'
        ]) {
            expect(shouldCompress(type, 5000)).toBe(true);
        }
    });

    it('does not compress an unknown content type', () => {
        expect(shouldCompress('application/octet-stream', 5000)).toBe(false);
        expect(shouldCompress(null, 5000)).toBe(false);
    });
});

describe('compressResponse', () => {
    it('gzips a large JSON response and labels it', async () => {
        const body = json(20000);
        const input = new Response(body, { headers: { 'content-type': 'application/json' } });

        const out = await compressResponse(input, 'gzip, deflate');

        expect(out.headers.get('content-encoding')).toBe('gzip');
        expect(out.headers.get('vary')).toBe('Accept-Encoding');
        const raw = Buffer.from(await out.arrayBuffer());
        expect(raw.byteLength).toBeLessThan(body.length / 2);
        expect(gunzipSync(raw).toString()).toBe(body);
    });

    it('brotli-compresses when the client accepts br', async () => {
        const body = json(20000);
        const input = new Response(body, { headers: { 'content-type': 'application/json' } });

        const out = await compressResponse(input, 'br, gzip');

        expect(out.headers.get('content-encoding')).toBe('br');
        const raw = Buffer.from(await out.arrayBuffer());
        expect(brotliDecompressSync(raw).toString()).toBe(body);
    });

    it('sets content-length to the compressed size', async () => {
        const input = new Response(json(20000), { headers: { 'content-type': 'application/json' } });

        const out = await compressResponse(input, 'gzip');

        const raw = Buffer.from(await out.arrayBuffer());
        expect(Number(out.headers.get('content-length'))).toBe(raw.byteLength);
    });

    it('preserves status, statusText and the other headers', async () => {
        const input = new Response(json(20000), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });

        const out = await compressResponse(input, 'gzip');

        expect(out.status).toBe(503);
        expect(out.statusText).toBe('Service Unavailable');
        expect(out.headers.get('cache-control')).toBe('no-store');
        expect(out.headers.get('content-type')).toBe('application/json');
    });

    it('returns the response untouched when the client accepts nothing we speak', async () => {
        const input = new Response(json(20000), { headers: { 'content-type': 'application/json' } });

        const out = await compressResponse(input, 'identity');

        expect(out).toBe(input);
        expect(out.headers.get('content-encoding')).toBeNull();
    });

    it('returns the response untouched when it is too small to be worth it', async () => {
        const input = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });

        const out = await compressResponse(input, 'gzip, br');

        expect(out).toBe(input);
        expect(out.headers.get('content-encoding')).toBeNull();
    });

    it('never double-encodes a response that is already compressed', async () => {
        const input = new Response(json(20000), {
            headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }
        });

        const out = await compressResponse(input, 'gzip, br');

        expect(out).toBe(input);
    });

    it('leaves a 304 alone, which carries no body', async () => {
        const input = new Response(null, {
            status: 304,
            headers: { 'content-type': 'application/json', 'content-length': '999999' }
        });

        const out = await compressResponse(input, 'gzip, br');

        expect(out).toBe(input);
    });
});

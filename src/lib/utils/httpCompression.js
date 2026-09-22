// src/lib/utils/httpCompression.js
//
// Compression for everything the SvelteKit layer serves (issue #242).
//
// The Express API already runs `compression()`, but the browser never saw the benefit: the
// /api/* proxy in hooks.server.js reads the upstream body with `await response.text()`, and
// Node's fetch transparently gunzips on the way in -- so the proxy re-served 1.3 MB of plain
// JSON with no Content-Encoding at all. Measured on the live instance:
//
//     Express direct (:3000)          1,316,988 -> 96,175 bytes, Content-Encoding: gzip
//     through the SvelteKit proxy     1,316,988 both ways, no encoding  <-- what browsers got
//
// Do NOT "fix" that by copying content-encoding through from the upstream response: by the
// time the proxy holds the body it really has been decoded, so the header would label plain
// text as gzip and break every client.
//
// adapter-node does not compress either (`precompress: false`, and it has no runtime gzip),
// so the HTML and the JS bundle went out uncompressed too. Compressing here covers both.
import { promisify } from 'node:util';
import { gzip as gzipCb, brotliCompress as brotliCb, constants as zlibConstants } from 'node:zlib';

const gzip = promisify(gzipCb);
const brotliCompress = promisify(brotliCb);

/**
 * Below this many bytes, the encoding's own framing plus the CPU cost outweighs what is saved.
 * Same threshold express's `compression` middleware uses by default.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/** Content types worth compressing. Matched against the type only, parameters stripped. */
const COMPRESSIBLE_TYPES = new Set([
    'text/html',
    'text/plain',
    'text/css',
    'text/csv',
    'text/xml',
    'application/json',
    'application/manifest+json',
    'application/javascript',
    'text/javascript',
    'application/xml',
    'application/xhtml+xml',
    'image/svg+xml'
]);

/**
 * Brotli quality. The default (11) is tuned for build-time precompression and is far too slow
 * for per-request use -- 4 is the level that stays comfortably faster than gzip while still
 * beating it on ratio for JSON.
 */
const BROTLI_QUALITY = 4;

/**
 * Pick the best encoding the client will actually accept, or null for none.
 *
 * Deliberately small: it understands the encodings we can produce and an explicit `q=0`
 * refusal, which is how a client opts out of one. Full q-value ranking is not worth it when
 * there are only two candidates and brotli is better whenever it is available.
 *
 * @param {string|null|undefined} acceptEncoding raw Accept-Encoding request header
 * @returns {'br'|'gzip'|null}
 */
export function negotiateEncoding(acceptEncoding) {
    if (!acceptEncoding) return null;

    const offered = new Map();
    for (const part of acceptEncoding.split(',')) {
        const [name, ...params] = part.trim().split(';');
        const q = params
            .map((p) => p.trim())
            .find((p) => p.startsWith('q='));
        offered.set(name.trim().toLowerCase(), q ? Number(q.slice(2)) : 1);
    }

    const accepts = (name) => offered.has(name) && offered.get(name) > 0;
    if (accepts('br')) return 'br';
    if (accepts('gzip')) return 'gzip';
    return null;
}

/**
 * Is this body worth compressing at all?
 *
 * @param {string|null|undefined} contentType
 * @param {number} byteLength
 */
export function shouldCompress(contentType, byteLength) {
    if (!contentType) return false;
    if (byteLength < COMPRESSION_THRESHOLD_BYTES) return false;

    const type = contentType.split(';')[0].trim().toLowerCase();

    // Buffering an event stream would hold every event until the stream closed.
    if (type === 'text/event-stream') return false;

    return COMPRESSIBLE_TYPES.has(type);
}

/**
 * Compress a Response if it is worth it and the client accepts an encoding we speak.
 *
 * Returns the *same* Response object untouched when it declines, so callers can hand it
 * straight back -- including for 204/304, which carry no body.
 *
 * @param {Response} response
 * @param {string|null|undefined} acceptEncoding raw Accept-Encoding request header
 * @returns {Promise<Response>}
 */
export async function compressResponse(response, acceptEncoding) {
    if (!response.body) return response;
    if (response.status === 204 || response.status === 304) return response;
    if (response.headers.get('content-encoding')) return response;

    const encoding = negotiateEncoding(acceptEncoding);
    if (!encoding) return response;

    const contentType = response.headers.get('content-type');
    const type = contentType ? contentType.split(';')[0].trim().toLowerCase() : null;
    if (!type || type === 'text/event-stream' || !COMPRESSIBLE_TYPES.has(type)) return response;

    // The body has to be read to know its size, and reading consumes it -- so clone first and
    // hand the original back untouched if the size turns out not to justify compression.
    const raw = Buffer.from(await response.clone().arrayBuffer());
    if (!shouldCompress(contentType, raw.byteLength)) return response;

    const compressed =
        encoding === 'br'
            ? await brotliCompress(raw, {
                  params: {
                      [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
                      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength
                  }
              })
            : await gzip(raw);

    const headers = new Headers(response.headers);
    headers.set('content-encoding', encoding);
    headers.set('content-length', String(compressed.byteLength));
    headers.set('vary', 'Accept-Encoding');

    return new Response(compressed, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

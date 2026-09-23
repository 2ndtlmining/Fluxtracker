// src/hooks.server.js
// API Proxy - Routes /api/* requests to the Express backend.

import { applySecurityHeaders, applyStaticSecurityHeaders } from './lib/security/contentSecurityPolicy.js';
import { compressResponse } from './lib/utils/httpCompression.js';

/**
 * Where the Express API is listening.
 *
 * Read from the environment rather than hardcoded, because the port has to agree with the one
 * the API was actually started on. It used to be a fixed 127.0.0.1:3000 while startup.sh and
 * scripts/start-all.mjs both accepted an API_PORT override — so moving the API off 3000 left
 * the proxy still calling 3000 and every request failed with "API proxy error: fetch failed",
 * which looks like the API is down rather than like a port mismatch.
 *
 * Evaluated when the built server boots, so it follows the runtime environment; the default
 * keeps existing deployments that set nothing working unchanged.
 */
const API_PORT = process.env.API_PORT || '3000';
const API_BASE = process.env.API_BASE || `http://127.0.0.1:${API_PORT}`;

console.log(`[API Proxy] forwarding /api/* to ${API_BASE}`);

/**
 * A GET that has not answered in this long is abandoned with a 504 (issue #300). There was no
 * timeout at all, so a hung API held the browser's request open indefinitely. Longer than the
 * slowest legitimate read -- the carousel's on-demand refetch budgets 15s upstream, and the
 * client gives it 25s. Non-GET requests (admin jobs such as recategorize or backfill, which can
 * legitimately run for minutes) are not timed out here.
 */
export const PROXY_GET_TIMEOUT_MS = 60_000;

/** Statuses that must not carry a body -- `new Response('', { status: 304 })` throws. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Response headers worth passing back from the API (issue #300). `retry-after` was dropped, so
 * the KPI endpoint's 429 never told the browser when to try again; `etag`/`last-modified` let
 * the browser revalidate instead of re-downloading.
 */
export const FORWARDED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'retry-after'];

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
    // Check if this is an API request
    if (event.url.pathname.startsWith('/api/')) {
        try {
            // Build the backend API URL. No per-request log line here: Express already logs
            // requests (see LOGGING_CONFIG), and the dashboard's polling made this one line
            // per request per viewer (issue #298).
            const apiUrl = `${API_BASE}${event.url.pathname}${event.url.search}`;
            const isGet = event.request.method === 'GET' || event.request.method === 'HEAD';

            // Prepare headers for the proxied request
            const headers = new Headers(event.request.headers);
            headers.delete('host'); // Remove host header to avoid conflicts
            headers.delete('connection'); // Remove connection header

            // Ask the API for an uncompressed body. Express runs compression(), but Node's
            // fetch transparently decodes it again a few lines below, so gzipping over this
            // loopback hop is CPU burnt at both ends for nothing. The body is compressed once,
            // for the client that actually benefits, on the way back out (issue #242).
            headers.set('accept-encoding', 'identity');

            // Let a revalidation reach Express as one (issue #300). Node's fetch follows the
            // fetch spec: a request carrying If-None-Match / If-Modified-Since gets
            // `Cache-Control: no-cache` added unless one is already present -- and Express
            // never answers 304 to a no-cache request. That is why a browser revalidating
            // through this proxy always got the full body back. An explicit max-age=0 keeps
            // the request a revalidation; a client's own Cache-Control (a hard reload) wins.
            if ((headers.has('if-none-match') || headers.has('if-modified-since')) && !headers.has('cache-control')) {
                headers.set('cache-control', 'max-age=0');
            }
            
            // Make the request to the Express backend
            const response = await fetch(apiUrl, {
                method: event.request.method,
                headers: headers,
                body: isGet ? undefined : await event.request.text(),
                signal: isGet ? AbortSignal.timeout(PROXY_GET_TIMEOUT_MS) : undefined
            });

            // Create response headers
            const responseHeaders = new Headers();
            responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
            FORWARDED_RESPONSE_HEADERS.forEach(header => {
                const value = response.headers.get(header);
                if (value) responseHeaders.set(header, value);
            });
            // Revalidate rather than reuse blindly: the API computes an ETag for every JSON
            // answer, so an unchanged poll becomes a body-less 304 instead of the full payload,
            // while the data is never older than the server's own cache (issue #300).
            if (isGet && !responseHeaders.has('cache-control')) {
                responseHeaders.set('Cache-Control', 'no-cache');
            }

            // Safe to set the CSP header here directly (unlike on the resolve() response
            // below) -- this is JSON, not HTML, so there's no inline script of its own for the
            // header to block.
            applySecurityHeaders(responseHeaders);

            // 304 and friends must be passed on WITHOUT a body. Building one with a body threw
            // "Invalid response status code 304", which the catch below turned into a 503 --
            // so the first conditional request a browser made would have failed (issue #300).
            if (NULL_BODY_STATUSES.has(response.status)) {
                return new Response(null, { status: response.status, headers: responseHeaders });
            }

            const body = await response.text();
            return await compressResponse(
                new Response(body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders
                }),
                event.request.headers.get('accept-encoding')
            );

        } catch (error) {
            console.error('[API Proxy Error]', error.message);
            const timedOut = error?.name === 'TimeoutError';

            const errorHeaders = new Headers({ 'Content-Type': 'application/json' });
            applySecurityHeaders(errorHeaders);
            return new Response(
                JSON.stringify({
                    error: 'Backend API unavailable',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }),
                {
                    status: timedOut ? 504 : 503,
                    headers: errorHeaders
                }
            );
        }
    }

    // For non-API requests, proceed normally with SvelteKit rendering. The Content-Security-
    // Policy header for this response comes from svelte.config.js's `kit.csp` (SvelteKit adds
    // it itself, with the nonce/hash its own inline hydration script needs) -- do NOT set one
    // here too; see the incident note in contentSecurityPolicy.js. Only the non-CSP hardening
    // headers are safe to add by hand.
    const response = await resolve(event);
    applyStaticSecurityHeaders(response.headers);

    // adapter-node serves its own HTML/JS/CSS uncompressed (precompress is off, and it has no
    // runtime gzip of its own), so this is the only place compression can happen without
    // putting a reverse proxy in front of it.
    return await compressResponse(response, event.request.headers.get('accept-encoding'));
}

/** @type {import('@sveltejs/kit').HandleServerError} */
export function handleError({ error, event }) {
    console.error('[SvelteKit Error]', error);
    
    return {
        message: 'An error occurred',
        code: error?.code ?? 'UNKNOWN'
    };
}
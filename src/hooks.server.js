// src/hooks.server.js
// API Proxy - Routes /api/* requests to the Express backend.

import { applySecurityHeaders, applyStaticSecurityHeaders } from './lib/security/contentSecurityPolicy.js';

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

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
    // Check if this is an API request
    if (event.url.pathname.startsWith('/api/')) {
        try {
            // Build the backend API URL
            const apiUrl = `${API_BASE}${event.url.pathname}${event.url.search}`;
            
            console.log(`[API Proxy] ${event.request.method} ${event.url.pathname} → ${apiUrl}`);
            
            // Prepare headers for the proxied request
            const headers = new Headers(event.request.headers);
            headers.delete('host'); // Remove host header to avoid conflicts
            headers.delete('connection'); // Remove connection header
            
            // Make the request to the Express backend
            const response = await fetch(apiUrl, {
                method: event.request.method,
                headers: headers,
                body: event.request.method !== 'GET' && event.request.method !== 'HEAD' 
                    ? await event.request.text() 
                    : undefined
            });
            
            // Get the response body
            const body = await response.text();
            
            // Create response headers
            const responseHeaders = new Headers();
            responseHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
            
            // Copy other important headers
            const headersToKeep = ['content-type', 'cache-control', 'etag', 'last-modified'];
            headersToKeep.forEach(header => {
                const value = response.headers.get(header);
                if (value) responseHeaders.set(header, value);
            });
            
            // Return the proxied response. Safe to set the CSP header here directly (unlike
            // on the resolve() response below) -- this is JSON, not HTML, so there's no inline
            // script of its own for the header to block.
            applySecurityHeaders(responseHeaders);
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders
            });

        } catch (error) {
            console.error('[API Proxy Error]', error.message);

            const errorHeaders = new Headers({ 'Content-Type': 'application/json' });
            applySecurityHeaders(errorHeaders);
            return new Response(
                JSON.stringify({
                    error: 'Backend API unavailable',
                    details: error.message,
                    timestamp: new Date().toISOString()
                }),
                {
                    status: 503,
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
    return response;
}

/** @type {import('@sveltejs/kit').HandleServerError} */
export function handleError({ error, event }) {
    console.error('[SvelteKit Error]', error);
    
    return {
        message: 'An error occurred',
        code: error?.code ?? 'UNKNOWN'
    };
}
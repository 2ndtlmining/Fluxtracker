// src/lib/security/contentSecurityPolicy.js
//
// Single source of truth for this app's Content-Security-Policy, shared between the two
// processes that both serve responses straight to the browser (see README's "Two processes
// are required" note):
//   - src/hooks.server.js — the SvelteKit-rendered dashboard pages, via the `handle` hook.
//     This is the one that actually matters for XSS protection: it's what the browser loads
//     and renders as HTML.
//   - src/server.js — the Express API (helmet consumes CSP_DIRECTIVES directly, since helmet
//     wants a plain object of camelCase directive arrays).
// A single shared source keeps the two policies from silently drifting apart.
//
// Reviewed against this app's actual asset loading (issue #125): everything is
// same-origin/bundled (no external scripts, no CDN images, no inline <style>/<script>) except
// app.css's Google Fonts @import — that's the only exception needed.
export const CSP_DIRECTIVES = {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"]
};

function toKebabCase(directiveName) {
    return directiveName.replace(/[A-Z]/g, match => '-' + match.toLowerCase());
}

/** Renders CSP_DIRECTIVES as the literal header value, e.g. "default-src 'self'; ...". */
export function buildCspHeaderValue(directives = CSP_DIRECTIVES) {
    return Object.entries(directives)
        .map(([directiveName, values]) => `${toKebabCase(directiveName)} ${values.join(' ')}`)
        .join('; ');
}

/**
 * The non-CSP hardening headers helmet applies by default in server.js. hooks.server.js
 * can't use helmet directly — adapter-node's production server is a plain Node HTTP server,
 * not Express — so these are set by hand for parity on the SvelteKit-rendered responses.
 */
export const STATIC_SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off'
};

/** Sets the CSP + static security headers on a fetch Response's headers in place. */
export function applySecurityHeaders(headers) {
    headers.set('Content-Security-Policy', buildCspHeaderValue());
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
        headers.set(name, value);
    }
    return headers;
}

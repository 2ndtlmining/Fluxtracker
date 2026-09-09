// src/lib/security/contentSecurityPolicy.js
//
// Single source of truth for this app's Content-Security-Policy directives, consumed three
// different ways depending on what's actually serving the response:
//   - svelte.config.js's `kit.csp` — the SvelteKit-rendered dashboard pages. This MUST be the
//     mechanism for those pages, not a hand-set header (see the incident note below): it's
//     SvelteKit itself that generates the response, and it needs to compute a nonce/hash for
//     its own inline hydration-bootstrap <script> and fold it into the header it emits.
//   - src/hooks.server.js — only the /api/* proxy branch, which builds raw Response objects
//     that bypass SvelteKit's renderer entirely (so kit.csp never touches them) and carry no
//     inline script anyway (JSON only) — applySecurityHeaders() is safe there.
//   - src/server.js — the Express API (helmet consumes CSP_DIRECTIVES directly, since helmet
//     wants a plain object of camelCase directive arrays).
//
// ── Incident note (do not hand-set this header on SvelteKit page responses) ──
// #125/#131 originally set this same policy directly in hooks.server.js's main `handle`
// branch (on the `resolve(event)` response). That silently broke EVERY page in production:
// SvelteKit's hydration bootstrap is an inline, unhashed <script> it writes into the response
// itself (`kit.start(app, ...)`) — under `default-src 'self'` with no `'unsafe-inline'`, hash,
// or nonce, the browser refuses to run it, so the client-side JS that fetches all the
// dashboard's data never executes and every card is stuck on "Loading...". No console error
// or network failure marks this (the script is refused before any request is even attempted),
// which is exactly why it went undetected for two PRs (#131 shipped it, #137 only fixed the
// separate `npm run dev` breakage without catching this one) until a full split-second-guessing
// re-verification with real elapsed wait time caught the dashboard never leaving its loading
// state. The fix is `kit.csp` (below), which lets SvelteKit inject the matching nonce/hash
// itself — never re-add a bare `Content-Security-Policy` header to a `resolve()`-derived
// response again; use `applyStaticSecurityHeaders` there instead (see hooks.server.js).
//
// Reviewed against this app's actual asset loading (issue #125): everything is
// same-origin/bundled (no external scripts, no CDN images, no inline <style>) except
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
 * CSP_DIRECTIVES reshaped to the kebab-case-keyed plain object svelte.config.js's `kit.csp.directives`
 * expects (SvelteKit's own CSP directive format matches the raw header syntax, not helmet's
 * camelCase). Consumed only by svelte.config.js — see the incident note above for why the
 * SvelteKit pages' CSP has to come from there, not a hand-set header.
 */
export function toKebabDirectives(directives = CSP_DIRECTIVES) {
    const result = {};
    for (const [directiveName, values] of Object.entries(directives)) {
        result[toKebabCase(directiveName)] = values;
    }
    return result;
}

/**
 * The non-CSP hardening headers helmet applies by default in server.js. hooks.server.js
 * can't use helmet directly — adapter-node's production server is a plain Node HTTP server,
 * not Express — so these are set by hand for parity. Safe to apply to ANY response, including
 * a `resolve()`-derived SvelteKit page response — unlike the CSP header, these carry no risk
 * of blocking that page's own inline content.
 */
export const STATIC_SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-DNS-Prefetch-Control': 'off'
};

/** Sets only the static (non-CSP) hardening headers on a fetch Response's headers in place. */
export function applyStaticSecurityHeaders(headers) {
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
        headers.set(name, value);
    }
    return headers;
}

/**
 * Sets the CSP + static security headers on a fetch Response's headers in place. Only safe
 * for a response with NO inline script/style of its own to protect — i.e. server.js's Express
 * API responses and hooks.server.js's /api/* proxy responses (JSON, no HTML). Never call this
 * on a SvelteKit page response — see the incident note above.
 */
export function applySecurityHeaders(headers) {
    headers.set('Content-Security-Policy', buildCspHeaderValue());
    return applyStaticSecurityHeaders(headers);
}

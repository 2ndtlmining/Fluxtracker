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
    styleSrc: ["'self'"], // fonts are self-hosted since #302 -- no Google stylesheet
    fontSrc: ["'self'", 'data:'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'self'"]
};

// SvelteKit's generated root component creates its route announcer (#svelte-announcer, the
// visually-hidden live region screen readers use) with an inline style attribute, which
// style-src 'self' refuses -- a CSP error on every page load. 'unsafe-hashes' plus this one
// hash allows exactly that attribute value and nothing else. The test re-derives it from
// @sveltejs/kit's own source, so an upgrade that changes the style fails CI.
export const SVELTEKIT_ANNOUNCER_STYLE_HASH = "'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='";

/**
 * The page policy for svelte.config.js's kit.csp. Production adds the announcer hash; dev
 * must NOT: the dev server injects component CSS as inline <style> tags and SvelteKit adds
 * 'unsafe-inline' to style-src for them, and a browser ignores 'unsafe-inline' as soon as any
 * hash is present -- one hash there blocks every stylesheet on the page.
 */
export function pageCspDirectives({ production }) {
    if (!production) return CSP_DIRECTIVES;
    return {
        ...CSP_DIRECTIVES,
        styleSrc: [...CSP_DIRECTIVES.styleSrc, "'unsafe-hashes'", SVELTEKIT_ANNOUNCER_STYLE_HASH]
    };
}

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

/**
 * Browsers ignore Cross-Origin-Opener-Policy on an untrustworthy origin (plain http from a LAN
 * IP or a Flux node URL) and log a console error for it on every page load. Sending it only
 * where it takes effect removes that noise without weakening anything: on those origins it
 * was never applied.
 */
const TRUSTWORTHY_ONLY_HEADERS = new Set(['Cross-Origin-Opener-Policy']);

/**
 * Whether the browser will treat the page's origin as potentially trustworthy: https (directly,
 * or behind a TLS-terminating proxy that says so in X-Forwarded-Proto) or a loopback host.
 *
 * The host is read from the request's Host header, not from `url`: adapter-node builds
 * `event.url` from the ORIGIN env var (the Dockerfile and start-all default it to
 * http://localhost:5173), so `url.hostname` said "localhost" for a visitor on a LAN IP and
 * the header was still sent to them.
 */
export function isTrustworthyOrigin(url, requestHeaders) {
    if (url.protocol === 'https:') return true;
    const forwarded = requestHeaders?.get?.('x-forwarded-proto') || '';
    if (forwarded.split(',')[0].trim().toLowerCase() === 'https') return true;
    let hostname = url.hostname;
    const hostHeader = requestHeaders?.get?.('host');
    if (hostHeader) {
        try {
            hostname = new URL(`http://${hostHeader}`).hostname;
        } catch {
            return false; // unparseable Host: not something to vouch for
        }
    }
    return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');
}

/**
 * Sets only the static (non-CSP) hardening headers on a fetch Response's headers in place.
 * `trustworthyOrigin: false` leaves out the headers browsers ignore on plain-http origins.
 */
export function applyStaticSecurityHeaders(headers, { trustworthyOrigin = true } = {}) {
    for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
        if (!trustworthyOrigin && TRUSTWORTHY_ONLY_HEADERS.has(name)) continue;
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

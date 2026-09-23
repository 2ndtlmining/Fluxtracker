import { describe, it, expect } from 'vitest';
import {
    CSP_DIRECTIVES,
    buildCspHeaderValue,
    toKebabDirectives,
    applySecurityHeaders,
    applyStaticSecurityHeaders,
    isTrustworthyOrigin,
    STATIC_SECURITY_HEADERS
} from '../contentSecurityPolicy.js';

describe('buildCspHeaderValue', () => {
    it('renders camelCase directives as kebab-case header syntax', () => {
        const value = buildCspHeaderValue(CSP_DIRECTIVES);
        expect(value).toContain("default-src 'self'");
        expect(value).toContain("frame-ancestors 'self'");
        expect(value).not.toMatch(/[A-Z]/); // no leftover camelCase directive names
    });

    it('allows fonts and styles from this origin only -- fonts are self-hosted (#302)', () => {
        const value = buildCspHeaderValue(CSP_DIRECTIVES);
        expect(value).toContain('style-src \'self\';');
        expect(value).toContain('font-src \'self\' data:');
        expect(value).not.toMatch(/googleapis|gstatic/);
    });

    it('joins directives with "; "', () => {
        const value = buildCspHeaderValue({ defaultSrc: ["'self'"], objectSrc: ["'none'"] });
        expect(value).toBe("default-src 'self'; object-src 'none'");
    });
});

describe('toKebabDirectives', () => {
    it('reshapes CSP_DIRECTIVES to kebab-case keys for svelte.config.js\'s kit.csp.directives', () => {
        const result = toKebabDirectives(CSP_DIRECTIVES);
        expect(result['default-src']).toEqual(["'self'"]);
        expect(result['frame-ancestors']).toEqual(["'self'"]);
        expect(Object.keys(result).some(key => /[A-Z]/.test(key))).toBe(false);
    });

    it('preserves the directive value arrays unchanged (same reference)', () => {
        const result = toKebabDirectives(CSP_DIRECTIVES);
        expect(result['style-src']).toBe(CSP_DIRECTIVES.styleSrc);
    });
});

describe('applySecurityHeaders', () => {
    it('sets the CSP header and every static header on the given Headers object', () => {
        const headers = new Headers();
        applySecurityHeaders(headers);

        expect(headers.get('Content-Security-Policy')).toBe(buildCspHeaderValue());
        for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
            expect(headers.get(name)).toBe(value);
        }
    });

    it('overwrites any pre-existing values rather than duplicating them', () => {
        const headers = new Headers({ 'X-Frame-Options': 'DENY' });
        applySecurityHeaders(headers);
        expect(headers.get('X-Frame-Options')).toBe(STATIC_SECURITY_HEADERS['X-Frame-Options']);
    });
});

describe('applyStaticSecurityHeaders', () => {
    it('sets every static header but never touches Content-Security-Policy', () => {
        const headers = new Headers();
        applyStaticSecurityHeaders(headers);

        expect(headers.get('Content-Security-Policy')).toBeNull();
        for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
            expect(headers.get(name)).toBe(value);
        }
    });

    it('leaves a pre-existing Content-Security-Policy header untouched -- this is what protects the header SvelteKit\'s own kit.csp already set on a resolve() response', () => {
        const headers = new Headers({ 'Content-Security-Policy': "default-src 'self' 'nonce-abc123'" });
        applyStaticSecurityHeaders(headers);
        expect(headers.get('Content-Security-Policy')).toBe("default-src 'self' 'nonce-abc123'");
    });
});

describe('Cross-Origin-Opener-Policy on untrustworthy origins', () => {
    it('is left out when the origin is not trustworthy, and every other header still set', () => {
        const headers = new Headers();
        applyStaticSecurityHeaders(headers, { trustworthyOrigin: false });
        expect(headers.get('Cross-Origin-Opener-Policy')).toBeNull();
        expect(headers.get('X-Frame-Options')).toBe(STATIC_SECURITY_HEADERS['X-Frame-Options']);
        expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('classifies https, a TLS proxy and loopback as trustworthy, and a LAN IP over http as not', () => {
        const none = new Headers();
        expect(isTrustworthyOrigin(new URL('https://example.com/'), none)).toBe(true);
        expect(isTrustworthyOrigin(new URL('http://example.com/'), new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true);
        expect(isTrustworthyOrigin(new URL('http://localhost:5173/'), none)).toBe(true);
        expect(isTrustworthyOrigin(new URL('http://127.0.0.1:5173/'), none)).toBe(true);
        expect(isTrustworthyOrigin(new URL('http://10.0.0.5:5173/'), none)).toBe(false);
        expect(isTrustworthyOrigin(new URL('http://example.com/'), new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
    });

    it('judges by the Host header, not the ORIGIN-derived url (adapter-node defaults ORIGIN to localhost)', () => {
        const originUrl = new URL('http://localhost:5173/');
        expect(isTrustworthyOrigin(originUrl, new Headers({ host: '10.0.0.5:5173' }))).toBe(false);
        expect(isTrustworthyOrigin(originUrl, new Headers({ host: 'localhost:5173' }))).toBe(true);
        expect(isTrustworthyOrigin(originUrl, new Headers({ host: '[::1]:5173' }))).toBe(true);
        expect(isTrustworthyOrigin(new URL('https://example.com/'), new Headers({ host: '10.0.0.5' }))).toBe(true);
    });
});

describe('pageCspDirectives: SvelteKit route announcer style', () => {
    it('production allows exactly the inline style @sveltejs/kit generates, by hash', async () => {
        const { readFileSync } = await import('node:fs');
        const { createHash } = await import('node:crypto');
        const { pageCspDirectives, SVELTEKIT_ANNOUNCER_STYLE_HASH } = await import('../contentSecurityPolicy.js');
        const source = readFileSync('node_modules/@sveltejs/kit/src/core/sync/write_root.js', 'utf8');
        const style = source.match(/id="svelte-announcer"[^>]*style="([^"]+)"/)?.[1];
        expect(style, 'announcer markup not found in @sveltejs/kit -- re-check the CSP hash').toBeTruthy();
        const hash = `'sha256-${createHash('sha256').update(style).digest('base64')}'`;
        expect(hash).toBe(SVELTEKIT_ANNOUNCER_STYLE_HASH);
        expect(pageCspDirectives({ production: true }).styleSrc).toEqual(["'self'", "'unsafe-hashes'", hash]);
    });

    it('dev gets no hash -- it would switch off the unsafe-inline the dev server needs', async () => {
        const { pageCspDirectives } = await import('../contentSecurityPolicy.js');
        expect(pageCspDirectives({ production: false }).styleSrc).toEqual(["'self'"]);
    });

    it('leaves the API policy (CSP_DIRECTIVES) untouched', async () => {
        const { pageCspDirectives } = await import('../contentSecurityPolicy.js');
        pageCspDirectives({ production: true });
        expect(CSP_DIRECTIVES.styleSrc).toEqual(["'self'"]);
    });
});

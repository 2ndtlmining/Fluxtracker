import { describe, it, expect } from 'vitest';
import {
    CSP_DIRECTIVES,
    buildCspHeaderValue,
    toKebabDirectives,
    applySecurityHeaders,
    applyStaticSecurityHeaders,
    STATIC_SECURITY_HEADERS
} from '../contentSecurityPolicy.js';

describe('buildCspHeaderValue', () => {
    it('renders camelCase directives as kebab-case header syntax', () => {
        const value = buildCspHeaderValue(CSP_DIRECTIVES);
        expect(value).toContain("default-src 'self'");
        expect(value).toContain("frame-ancestors 'self'");
        expect(value).not.toMatch(/[A-Z]/); // no leftover camelCase directive names
    });

    it('includes the Google Fonts exception app.css needs', () => {
        const value = buildCspHeaderValue(CSP_DIRECTIVES);
        expect(value).toContain('style-src \'self\' https://fonts.googleapis.com');
        expect(value).toContain('font-src \'self\' https://fonts.gstatic.com data:');
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

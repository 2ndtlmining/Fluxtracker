import { describe, it, expect } from 'vitest';
import { CSP_DIRECTIVES, buildCspHeaderValue, applySecurityHeaders, STATIC_SECURITY_HEADERS } from '../contentSecurityPolicy.js';

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

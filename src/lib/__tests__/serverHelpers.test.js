import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCache, calculateChange } from '../serverHelpers.js';

/**
 * withDbFallback() is covered by dbFailureAttribution.test.js (#219) and
 * withDbFallbackDedup.test.js (#221). This file covers the two helpers beside it that had
 * nothing: the stale-while-revalidate cache they all share, and calculateChange.
 */

afterEach(() => {
    vi.useRealTimers();
});

describe('createCache', () => {
    it('serves an entry back while it is inside the TTL', () => {
        const cache = createCache(1000);
        cache.set('header', { nodes: 13000 });

        expect(cache.get('header')).toEqual({ nodes: 13000 });
    });

    it('has nothing for a key that was never set', () => {
        const cache = createCache(1000);

        expect(cache.get('header')).toBeNull();
        expect(cache.getStale('header')).toBeNull();
    });

    it('stops serving an expired entry from get()', () => {
        vi.useFakeTimers();
        const cache = createCache(1000);
        cache.set('header', { nodes: 13000 });

        vi.advanceTimersByTime(1001);

        expect(cache.get('header')).toBeNull();
    });

    it('still serves an expired entry from getStale(), which is the point of it', () => {
        // This is what turns a database outage into stale numbers with a _stale marker
        // instead of an empty dashboard.
        vi.useFakeTimers();
        const cache = createCache(1000);
        cache.set('header', { nodes: 13000 });

        vi.advanceTimersByTime(60 * 60 * 1000);

        expect(cache.get('header')).toBeNull();
        expect(cache.getStale('header')).toEqual({ nodes: 13000 });
    });

    it('treats the TTL boundary as expired, not fresh', () => {
        vi.useFakeTimers();
        const cache = createCache(1000);
        cache.set('header', { nodes: 13000 });

        vi.advanceTimersByTime(1000);

        expect(cache.get('header')).toBeNull();
    });

    it('restarts the clock when a key is written again', () => {
        vi.useFakeTimers();
        const cache = createCache(1000);
        cache.set('header', { nodes: 1 });

        vi.advanceTimersByTime(900);
        cache.set('header', { nodes: 2 });
        vi.advanceTimersByTime(900);

        expect(cache.get('header')).toEqual({ nodes: 2 });
    });

    it('keeps keys independent of each other', () => {
        const cache = createCache(1000);
        cache.set('header', { nodes: 1 });
        cache.set('snapshots:30', { days: 30 });

        expect(cache.get('header')).toEqual({ nodes: 1 });
        expect(cache.get('snapshots:30')).toEqual({ days: 30 });
    });

    it('gives each cache instance its own store', () => {
        const a = createCache(1000);
        const b = createCache(1000);
        a.set('header', { nodes: 1 });

        expect(b.get('header')).toBeNull();
    });
});

describe('calculateChange', () => {
    it('reports a rise as a positive percentage trending up', () => {
        expect(calculateChange(150, 100)).toEqual({ change: 50, trend: 'up' });
    });

    it('reports a fall as a negative percentage trending down', () => {
        expect(calculateChange(75, 100)).toEqual({ change: -25, trend: 'down' });
    });

    it('reports no movement as neutral', () => {
        expect(calculateChange(100, 100)).toEqual({ change: 0, trend: 'neutral' });
    });

    it('rounds to two decimal places', () => {
        // 1 in 3 is 33.333...%, which would otherwise render with 14 decimals.
        expect(calculateChange(4, 3).change).toBe(33.33);
        expect(calculateChange(2, 3).change).toBe(-33.33);
    });

    it('calls growth from zero "neutral", which renders as a flat arrow', () => {
        // Pinned deliberately rather than left as an accident: percentage change from 0 is
        // undefined, so a metric going 0 -> 500 shows no movement at all. If that is ever
        // meant to read as "new" or "up", this is the test that has to change with it.
        expect(calculateChange(500, 0)).toEqual({ change: 0, trend: 'neutral' });
    });

    it('treats a missing past value the same as zero', () => {
        expect(calculateChange(500, null)).toEqual({ change: 0, trend: 'neutral' });
        expect(calculateChange(500, undefined)).toEqual({ change: 0, trend: 'neutral' });
    });

    it('reports a drop to zero as a full -100%', () => {
        expect(calculateChange(0, 250)).toEqual({ change: -100, trend: 'down' });
    });
});

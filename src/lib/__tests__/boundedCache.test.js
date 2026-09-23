import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCache, parseRangeQuery } from '../serverHelpers.js';

describe('createCache is bounded (issue #291)', () => {
  it('evicts the least-recently-used entry past maxEntries', () => {
    const cache = createCache(60_000, { maxEntries: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');        // a is now the most recent
    cache.set('d', 4);     // evicts b, the least recent

    expect(cache.size).toBe(3);
    expect(cache.getStale('b')).toBeNull();
    expect(cache.getStale('a')).toBe(1);
    expect(cache.getStale('d')).toBe(4);
  });

  it('evicts by total size as well as by count', () => {
    const cache = createCache(60_000, { maxEntries: 100, maxBytes: 1000 });
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, 'x'.repeat(300)); // ~302 bytes each as JSON
    expect(cache.bytes).toBeLessThanOrEqual(1000);
    expect(cache.size).toBe(3);
    expect(cache.getStale('k9')).not.toBeNull();
  });

  it('never caches an entry bigger than the whole budget', () => {
    const cache = createCache(60_000, { maxBytes: 100 });
    cache.set('huge', 'x'.repeat(500));
    expect(cache.getStale('huge')).toBeNull();
    expect(cache.bytes).toBe(0);
  });

  it('a flood of distinct keys cannot grow it without bound', () => {
    const cache = createCache(60_000, { maxEntries: 100 });
    for (let i = 0; i < 10_000; i++) cache.set(`limit=${i}`, { big: 'x'.repeat(100) });
    expect(cache.size).toBe(100);
  });

  describe('freshness', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('still serves a stale copy for the 503 fallback after the TTL', () => {
      const cache = createCache(1000);
      cache.set('k', 'v');
      vi.advanceTimersByTime(1500);
      expect(cache.get('k')).toBeNull();
      expect(cache.getStale('k')).toBe('v');
    });
  });
});

describe('parseRangeQuery (issue #291)', () => {
  it('equivalent limits share one key', () => {
    const keys = ['30', '030', '30.0', ' 30'].map(limit => parseRangeQuery({ limit }).key);
    expect(new Set(keys).size).toBe(1);
  });

  it('clamps the limit', () => {
    expect(parseRangeQuery({ limit: '999999999' }).limit).toBe(10000);
    expect(parseRangeQuery({ limit: '-5' }).limit).toBe(1);
    expect(parseRangeQuery({}).limit).toBe(30);
  });

  it('uses the date range when both ends are given', () => {
    expect(parseRangeQuery({ start_date: '2026-09-01', end_date: '2026-09-22', limit: '7' }))
      .toMatchObject({ start: '2026-09-01', end: '2026-09-22', key: '2026-09-01:2026-09-22' });
  });

  it('rejects malformed dates instead of passing them to the database', () => {
    expect(parseRangeQuery({ start_date: "2026-09-01'; drop", end_date: '2026-09-22' }).error).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #293 — appSpecsCache is the one owner of globalappsspecifications, and concurrent
 * cold callers share a single download. At startup four services found it cold at once and
 * each fetched the ~2.3 MB payload.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));

import { resilientFetch } from '../resilientFetch.js';

const SPECS = { status: 'success', data: [{ name: 'app1', hash: 'h1', compose: [] }] };

async function load() {
  vi.resetModules();
  return import('../appSpecsCache.js');
}

beforeEach(() => {
  resilientFetch.mockReset();
  resilientFetch.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(SPECS), 10)));
});

describe('ensureGlobalSpecsCache', () => {
  it('concurrent cold callers share one download', async () => {
    const cache = await load();
    await Promise.all([cache.ensureGlobalSpecsCache(), cache.ensureGlobalSpecsCache(), cache.ensureGlobalSpecsCache()]);

    expect(resilientFetch).toHaveBeenCalledTimes(1);
    expect(cache.getAllAppSpecs().map(s => s.name)).toEqual(['app1']);
  });

  it('a fresh cache is not refetched; maxAgeMs can ask for fresher data', async () => {
    const cache = await load();
    await cache.ensureGlobalSpecsCache();
    await cache.ensureGlobalSpecsCache();
    expect(resilientFetch).toHaveBeenCalledTimes(1);

    await new Promise(r => setTimeout(r, 5));
    await cache.ensureGlobalSpecsCache({ maxAgeMs: 1 });
    expect(resilientFetch).toHaveBeenCalledTimes(2);
  });
});

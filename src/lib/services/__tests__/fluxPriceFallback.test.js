import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Live FLUX price fallback (issue #183).
 *
 * Every source can miss in the same 5-minute pass -- CoinGecko rate-limits by IP and
 * CryptoCompare returns 401 without a key -- and fetchFluxPrice() used to return null then.
 * Everything synced in that pass was stored with amount_usd = NULL, and because
 * flux_price_history excludes the current day, nothing could repair those rows until the
 * next day. FLUX does not move far in an hour: a recent price is a better answer than none.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../../db/database.js', () => ({ updateCurrentMetrics: vi.fn() }));

import { resilientFetch } from '../resilientFetch.js';
import { updateCurrentMetrics } from '../../db/database.js';

const NOW = Date.parse('2026-08-21T12:00:00Z');
const HOUR = 3600_000;

/** Fresh module instance -- the price cache lives in module scope. */
async function loadService() {
    vi.resetModules();
    return await import('../fluxNetworkData.js');
}

const coingeckoOk = price => ({ zelcash: { usd: price } });

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    updateCurrentMetrics.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('fetchFluxPrice fallback', () => {
    it('returns the live price and remembers it', async () => {
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.05));
        const { fetchFluxPrice, getLastGoodPrice } = await loadService();

        await expect(fetchFluxPrice()).resolves.toBe(0.05);
        expect(getLastGoodPrice()).toMatchObject({ price: 0.05, ageMs: 0 });
    });

    it('falls back to the last known price when every source fails', async () => {
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.05));
        const { fetchFluxPrice } = await loadService();
        await fetchFluxPrice();

        vi.setSystemTime(NOW + 20 * 60_000); // 20 minutes later
        resilientFetch.mockRejectedValue(new Error('429 rate limited'));

        await expect(fetchFluxPrice()).resolves.toBe(0.05);
    });

    it('refuses a cached price older than six hours -- that is no longer an approximation', async () => {
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.05));
        const { fetchFluxPrice } = await loadService();
        await fetchFluxPrice();

        vi.setSystemTime(NOW + 6 * HOUR + 1000);
        resilientFetch.mockRejectedValue(new Error('429 rate limited'));

        await expect(fetchFluxPrice()).resolves.toBeNull();
    });

    it('returns null when the process has never had a successful fetch', async () => {
        resilientFetch.mockRejectedValue(new Error('429 rate limited'));
        const { fetchFluxPrice } = await loadService();

        await expect(fetchFluxPrice()).resolves.toBeNull();
    });

    it('a later success refreshes the cache, so the fallback window restarts', async () => {
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.05));
        const { fetchFluxPrice, getLastGoodPrice } = await loadService();
        await fetchFluxPrice();

        vi.setSystemTime(NOW + 5 * HOUR);
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.06));
        await expect(fetchFluxPrice()).resolves.toBe(0.06);

        // 5h after the SECOND fetch -- still inside the window, because the clock restarted.
        vi.setSystemTime(NOW + 10 * HOUR);
        resilientFetch.mockRejectedValue(new Error('429 rate limited'));
        await expect(fetchFluxPrice()).resolves.toBe(0.06);
        expect(getLastGoodPrice().price).toBe(0.06);
    });

    it('remembers a price fetched from a fallback source, not just CoinGecko', async () => {
        // CoinGecko fails, the explorer answers -- that price must be cached too.
        resilientFetch
            .mockRejectedValueOnce(new Error('429 rate limited'))
            .mockResolvedValueOnce({ rate: '0.042' });
        const { fetchFluxPrice, getLastGoodPrice } = await loadService();

        await expect(fetchFluxPrice()).resolves.toBeCloseTo(0.042);
        expect(getLastGoodPrice().price).toBeCloseTo(0.042);
    });

    it('does not re-write current_metrics when serving a cached price', async () => {
        resilientFetch.mockResolvedValueOnce(coingeckoOk(0.05));
        const { fetchFluxPrice } = await loadService();
        await fetchFluxPrice();
        updateCurrentMetrics.mockClear();

        resilientFetch.mockRejectedValue(new Error('429 rate limited'));
        await fetchFluxPrice();

        expect(updateCurrentMetrics).not.toHaveBeenCalled();
    });
});

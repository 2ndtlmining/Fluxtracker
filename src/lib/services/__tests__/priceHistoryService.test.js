import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the historical price service.
 *
 * Regression context: CryptoCompare/CoinDesk started returning HTTP 401 "API key required",
 * which silently froze flux_price_history. The old syncPriceHistory() was forward-only
 * (skip everything <= MAX(date), return early when MAX(date) === today), so once a hole
 * existed in the middle of the table it could never heal, and every transaction after the
 * hole was stored with amount_usd = NULL.
 */

// ---- Mock setup (must be before importing the service) ----

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

vi.mock('../../db/database.js', () => ({
    insertPriceHistoryBatch: vi.fn(),
    getLatestPriceDate: vi.fn(),
    getOldestPriceDate: vi.fn(),
    getPricesForDateRange: vi.fn(),
    getTransactionsWithNullUsd: vi.fn(),
    getOldestTransactionDate: vi.fn(),
    updateTransactionUsdBatch: vi.fn(),
    getPriceHistoryCount: vi.fn(),
}));

import axios from 'axios';
import {
    insertPriceHistoryBatch,
    getLatestPriceDate,
    getOldestPriceDate,
    getPricesForDateRange,
    getTransactionsWithNullUsd,
    getOldestTransactionDate,
    updateTransactionUsdBatch,
    getPriceHistoryCount,
} from '../../db/database.js';

// ---- Helpers ----

const MS_PER_DAY = 86400000;
const NOW = Date.parse('2026-08-21T12:00:00Z');

function dateStr(ms) {
    return new Date(ms).toISOString().split('T')[0];
}

function daysAgo(n) {
    return dateStr(NOW - n * MS_PER_DAY);
}

/** Binance kline: [openTime, open, high, low, close, ...] */
function kline(date, close) {
    return [Date.parse(`${date}T00:00:00Z`), '0.04', '0.05', '0.03', String(close), '1000'];
}

function priceRows(dates) {
    return dates.map(d => ({ date: d, price_usd: 0.04 }));
}

/** Fresh module instance — the service keeps a cooldown timer in module scope. */
async function loadService() {
    vi.resetModules();
    return await import('../priceHistoryService.js');
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    insertPriceHistoryBatch.mockResolvedValue(true);
    updateTransactionUsdBatch.mockResolvedValue(true);
    getPriceHistoryCount.mockResolvedValue(0);
    getLatestPriceDate.mockResolvedValue(null);
    getOldestPriceDate.mockResolvedValue(null);
    getPricesForDateRange.mockResolvedValue([]);
    getOldestTransactionDate.mockResolvedValue(null);
    getTransactionsWithNullUsd.mockResolvedValue([]);
    vi.stubEnv('CRYPTOCOMPARE_API_KEY', '');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

// ============================================

describe('fetchHistoricalPrices', () => {
    it('maps Binance klines to { date, price_usd } using the candle close', async () => {
        const { fetchHistoricalPrices } = await loadService();

        axios.get.mockResolvedValueOnce({
            data: [kline('2026-08-18', 0.041), kline('2026-08-19', 0.042), kline('2026-08-20', 0.043)]
        });

        const result = await fetchHistoricalPrices('2026-08-18', '2026-08-20');

        expect(result.source).toBe('binance');
        expect(result.prices).toEqual([
            { date: '2026-08-18', price_usd: 0.041, source: 'binance' },
            { date: '2026-08-19', price_usd: 0.042, source: 'binance' },
            { date: '2026-08-20', price_usd: 0.043, source: 'binance' },
        ]);
    });

    it("clips today's in-progress candle out of the requested range", async () => {
        const { fetchHistoricalPrices } = await loadService();

        // Binance returns today's partial candle; the caller only asks up to yesterday
        axios.get.mockResolvedValueOnce({
            data: [kline('2026-08-19', 0.042), kline('2026-08-20', 0.043), kline('2026-08-21', 0.099)]
        });

        const result = await fetchHistoricalPrices('2026-08-19', '2026-08-20');

        expect(result.prices.map(p => p.date)).toEqual(['2026-08-19', '2026-08-20']);
    });

    it('falls back to CoinGecko when Binance fails, and skips CryptoCompare without an API key', async () => {
        const { fetchHistoricalPrices } = await loadService();

        axios.get
            .mockRejectedValueOnce(Object.assign(new Error('Server Error'), { response: { status: 503 } }))
            .mockResolvedValueOnce({
                data: {
                    prices: [
                        [Date.parse('2026-08-19T00:00:00Z'), 0.042],
                        [Date.parse('2026-08-20T00:00:00Z'), 0.043],
                    ]
                }
            });

        const result = await fetchHistoricalPrices('2026-08-19', '2026-08-20');

        expect(result.source).toBe('coingecko');
        expect(result.prices).toHaveLength(2);
        // Binance + CoinGecko only — CryptoCompare must not be called without a key
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('reports an error when every source fails', async () => {
        const { fetchHistoricalPrices } = await loadService();

        axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

        const result = await fetchHistoricalPrices('2026-08-19', '2026-08-20');

        expect(result.prices).toEqual([]);
        expect(result.source).toBeNull();
        expect(result.error).toContain('401');
    });

    it('uses CryptoCompare as a last resort when CRYPTOCOMPARE_API_KEY is set', async () => {
        vi.stubEnv('CRYPTOCOMPARE_API_KEY', 'secret-key');
        const { fetchHistoricalPrices } = await loadService();

        axios.get
            .mockRejectedValueOnce(new Error('binance down'))
            .mockRejectedValueOnce(new Error('coingecko down'))
            .mockResolvedValueOnce({
                data: { Data: { Data: [{ time: Date.parse('2026-08-20T00:00:00Z') / 1000, close: 0.043 }] } }
            });

        const result = await fetchHistoricalPrices('2026-08-20', '2026-08-20');

        expect(result.source).toBe('cryptocompare');
        expect(axios.get).toHaveBeenLastCalledWith(
            expect.stringContaining('cryptocompare'),
            expect.objectContaining({ headers: { Authorization: 'Apikey secret-key' } })
        );
    });
});

// ============================================

describe('syncPriceHistory', () => {
    it('fills a hole in the middle of the table even when MAX(date) is today', async () => {
        // This is the exact broken state: prices exist for the oldest days and for today,
        // but the middle is missing. The old forward-only sync returned "already up to date".
        const { syncPriceHistory } = await loadService();

        getOldestTransactionDate.mockResolvedValue(daysAgo(4)); // 2026-08-17
        getOldestPriceDate.mockResolvedValue(daysAgo(4));
        getLatestPriceDate.mockResolvedValue(daysAgo(0)); // today
        // Required range is 2026-08-17 .. 2026-08-20 (yesterday); 18 and 19 are missing
        getPricesForDateRange.mockResolvedValue(priceRows(['2026-08-17', '2026-08-20']));

        axios.get.mockResolvedValueOnce({
            data: [kline('2026-08-18', 0.042), kline('2026-08-19', 0.0425), kline('2026-08-20', 0.043)]
        });

        const result = await syncPriceHistory();

        expect(result.gapsBefore).toBe(2);
        expect(result.gapsAfter).toBe(0);
        expect(result.added).toBe(2);
        // Only the missing days are written — the day we already have is not re-inserted
        expect(insertPriceHistoryBatch).toHaveBeenCalledWith([
            { date: '2026-08-18', price_usd: 0.042, source: 'binance' },
            { date: '2026-08-19', price_usd: 0.0425, source: 'binance' },
        ]);
    });

    it('excludes today from the required range', async () => {
        const { syncPriceHistory } = await loadService();

        getOldestTransactionDate.mockResolvedValue('2026-08-20');
        getPricesForDateRange.mockResolvedValue(priceRows(['2026-08-20']));

        const result = await syncPriceHistory();

        expect(result.gapsBefore).toBe(0);
        expect(result.added).toBe(0);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('is a cheap no-op when there are no gaps', async () => {
        const { syncPriceHistory } = await loadService();

        getOldestTransactionDate.mockResolvedValue('2026-08-18');
        getPricesForDateRange.mockResolvedValue(priceRows(['2026-08-18', '2026-08-19', '2026-08-20']));

        const result = await syncPriceHistory();

        expect(result).toMatchObject({ added: 0, gapsBefore: 0, gapsAfter: 0 });
        expect(axios.get).not.toHaveBeenCalled();
        expect(insertPriceHistoryBatch).not.toHaveBeenCalled();
    });

    it('backs off after a total source failure instead of retrying every cycle', async () => {
        const { syncPriceHistory } = await loadService();

        getOldestTransactionDate.mockResolvedValue('2026-08-18');
        getPricesForDateRange.mockResolvedValue([]);
        axios.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));

        const first = await syncPriceHistory();
        expect(first.added).toBe(0);
        expect(first.error).toContain('401');

        const callsAfterFirst = axios.get.mock.calls.length;

        const second = await syncPriceHistory();
        expect(second.cooldown).toBe(true);
        expect(axios.get.mock.calls.length).toBe(callsAfterFirst); // no new network calls

        // force bypasses the cooldown (used by the admin backfill endpoint)
        await syncPriceHistory({ force: true });
        expect(axios.get.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
});

// ============================================

describe('backfillNullUsdAmounts', () => {
    it('pages past a batch where no date has a price', async () => {
        const { backfillNullUsdAmounts } = await loadService();

        // Price history covers only 2026-08-19 — the newest transactions (2026-08-20) are uncovered
        getOldestTransactionDate.mockResolvedValue('2026-08-19');
        getOldestPriceDate.mockResolvedValue('2026-08-19');
        getLatestPriceDate.mockResolvedValue('2026-08-19');
        getPricesForDateRange.mockResolvedValue(priceRows(['2026-08-19', '2026-08-20']));

        const unpriceable = Array.from({ length: 1000 }, (_, i) => ({
            txid: `new-${i}`, amount: 10, date: '2026-08-18', timestamp: 0
        }));
        const priceable = [{ txid: 'old-1', amount: 10, date: '2026-08-19', timestamp: 0 }];

        // Page 1 (offset 0): all unpriced. Page 2 (offset 1000): priceable.
        getTransactionsWithNullUsd
            .mockResolvedValueOnce(unpriceable)
            .mockResolvedValueOnce(priceable)
            .mockResolvedValue([]);

        const result = await backfillNullUsdAmounts();

        // The old implementation broke out of the loop here and returned updated: 0
        expect(result.updated).toBe(1);
        expect(result.skipped).toBe(1000);
        expect(result.missingPriceDates).toEqual(['2026-08-18']);
        expect(getTransactionsWithNullUsd).toHaveBeenNthCalledWith(1, 1000, 0);
        expect(getTransactionsWithNullUsd).toHaveBeenNthCalledWith(2, 1000, 1000);
        expect(updateTransactionUsdBatch).toHaveBeenCalledWith([{ txid: 'old-1', amount_usd: 0.4 }]);
    });

    it('does not advance the offset past rows it successfully priced', async () => {
        const { backfillNullUsdAmounts } = await loadService();

        getOldestTransactionDate.mockResolvedValue('2026-08-19');
        getOldestPriceDate.mockResolvedValue('2026-08-19');
        getLatestPriceDate.mockResolvedValue('2026-08-19');
        getPricesForDateRange.mockResolvedValue(priceRows(['2026-08-19', '2026-08-20']));

        const fullPage = Array.from({ length: 1000 }, (_, i) => ({
            txid: `tx-${i}`, amount: 10, date: '2026-08-19', timestamp: 0
        }));

        getTransactionsWithNullUsd
            .mockResolvedValueOnce(fullPage)
            .mockResolvedValueOnce([{ txid: 'tx-last', amount: 10, date: '2026-08-19', timestamp: 0 }])
            .mockResolvedValue([]);

        const result = await backfillNullUsdAmounts();

        expect(result.updated).toBe(1001);
        // Priced rows leave the NULL set, so the window must stay at offset 0
        expect(getTransactionsWithNullUsd).toHaveBeenNthCalledWith(2, 1000, 0);
    });

    it('reports price coverage so an empty result explains itself', async () => {
        const { backfillNullUsdAmounts } = await loadService();

        getOldestTransactionDate.mockResolvedValue('2024-05-13');
        getOldestPriceDate.mockResolvedValue('2021-10-01');
        getLatestPriceDate.mockResolvedValue('2024-06-25');
        getPricesForDateRange.mockResolvedValue(priceRows(['2021-10-01', '2024-06-25']));
        axios.get.mockRejectedValue(new Error('offline'));
        getTransactionsWithNullUsd.mockResolvedValue([]);

        const result = await backfillNullUsdAmounts();

        expect(result.coverage).toEqual({
            oldestPriceDate: '2021-10-01',
            newestPriceDate: '2024-06-25',
            priceDays: 2
        });
    });
});

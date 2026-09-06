import { API_ENDPOINTS, REVENUE_SYNC } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import {
    insertPriceHistoryBatch,
    getLatestPriceDate,
    getOldestPriceDate,
    getPricesForDateRange,
    getTransactionsWithNullUsd,
    getOldestTransactionDate,
    updateTransactionUsdBatch,
    getPriceHistoryCount
} from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('priceHistoryService');

const MS_PER_DAY = 86400000;

// How far back to seed price history when there are no transactions and no prices yet
const DEFAULT_SEED_DAYS = 1000;

// When a sync leaves gaps unfilled (source down, or the gap predates every source's data),
// wait this long before hammering the APIs again. The sync runs every 5 minutes.
const FAILED_SYNC_COOLDOWN_MS = 60 * 60 * 1000;

// Last sync outcome — surfaced via getPriceHistoryStatus() so a dead price source can't
// rot silently the way the CryptoCompare 401 did.
let lastSync = { at: null, added: 0, source: null, error: null, gapsRemaining: null };
let cooldownUntil = 0;

// ============================================
// DATE HELPERS
// ============================================

function toDateStr(ms) {
    return new Date(ms).toISOString().split('T')[0];
}

function dateToMs(dateStr) {
    return Date.parse(`${dateStr}T00:00:00Z`);
}

function addDays(dateStr, n) {
    return toDateStr(dateToMs(dateStr) + n * MS_PER_DAY);
}

function enumerateDates(startDate, endDate) {
    const out = [];
    for (let ms = dateToMs(startDate); ms <= dateToMs(endDate); ms += MS_PER_DAY) {
        out.push(toDateStr(ms));
    }
    return out;
}

// ============================================
// HISTORICAL PRICE SOURCES
// ============================================

/**
 * Binance daily klines. No API key. 1000 candles per call, paged forward with startTime.
 * Candle shape: [openTime(ms), open, high, low, close, ...]
 */
async function fetchFromBinance(fromDate, toDate) {
    const prices = [];
    let startTime = dateToMs(fromDate);
    const endMs = dateToMs(toDate);

    // 1000 candles per page; 12 pages covers ~33 years, the loop normally exits far sooner
    for (let page = 0; page < 12; page++) {
        const url = `${API_ENDPOINTS.PRICE_HISTORY_BINANCE}&startTime=${startTime}`;
        // No retries here: the source chain below (CoinGecko, CryptoCompare) is the retry.
        const candles = await resilientFetch(url, { timeout: 30000, breakerKey: 'binance-klines' });

        if (!Array.isArray(candles) || candles.length === 0) break;

        for (const candle of candles) {
            const close = parseFloat(candle[4]);
            if (!close) continue;
            prices.push({ date: toDateStr(candle[0]), price_usd: close, source: 'binance' });
        }

        const lastOpen = candles[candles.length - 1][0];
        if (candles.length < 1000 || lastOpen >= endMs) break;
        startTime = lastOpen + MS_PER_DAY;
    }

    return prices;
}

/**
 * CoinGecko market chart. No API key, but only ~365 days of daily granularity.
 * Shape: { prices: [[msTimestamp, price], ...] }
 */
async function fetchFromCoinGecko() {
    const body = await resilientFetch(API_ENDPOINTS.PRICE_HISTORY_COINGECKO, {
        timeout: 30000,
        breakerKey: 'coingecko-market-chart'
    });
    const points = body?.prices;
    if (!Array.isArray(points)) return [];

    // Multiple intraday points can share a date near the range edges — last one wins
    const byDate = new Map();
    for (const [ms, price] of points) {
        if (!price) continue;
        byDate.set(toDateStr(ms), price);
    }

    return [...byDate].map(([date, price_usd]) => ({ date, price_usd, source: 'coingecko' }));
}

/**
 * CryptoCompare/CoinDesk. Requires CRYPTOCOMPARE_API_KEY — the endpoint returns HTTP 401
 * without one, which is what silently froze price history in the first place.
 */
async function fetchFromCryptoCompare() {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
    if (!apiKey) return null; // signals "not configured", not "failed"

    const body = await resilientFetch(API_ENDPOINTS.PRICE_HISTORY_CRYPTOCOMPARE, {
        timeout: 30000,
        breakerKey: 'cryptocompare-histoday',
        axiosConfig: { headers: { Authorization: `Apikey ${apiKey}` } }
    });

    if (body?.Response === 'Error') {
        throw new Error(body.Message || 'CryptoCompare error');
    }

    const points = body?.Data?.Data;
    if (!Array.isArray(points)) return [];

    return points
        .filter(p => p.close)
        .map(p => ({ date: toDateStr(p.time * 1000), price_usd: p.close, source: 'cryptocompare' }));
}

/**
 * Try each historical source in order until one returns data.
 * Returns { prices, source, error } — prices is clipped to [fromDate, toDate].
 */
export async function fetchHistoricalPrices(fromDate, toDate) {
    const sources = [
        ['binance', () => fetchFromBinance(fromDate, toDate)],
        ['coingecko', () => fetchFromCoinGecko()],
        ['cryptocompare', () => fetchFromCryptoCompare()]
    ];

    const errors = [];

    for (const [name, fetchFn] of sources) {
        try {
            const prices = await fetchFn();

            // null means the source is not configured (no API key) — skip quietly
            if (prices === null) continue;

            const clipped = prices.filter(p => p.date >= fromDate && p.date <= toDate);
            if (clipped.length > 0) {
                log.info('Fetched %d daily prices from %s (%s to %s)', clipped.length, name, fromDate, toDate);
                return { prices: clipped, source: name, error: null };
            }
            errors.push(`${name}: no data in range`);
        } catch (error) {
            const detail = error.response?.status ? `HTTP ${error.response.status}` : error.message;
            log.warn('Historical price source %s failed: %s', name, detail);
            errors.push(`${name}: ${detail}`);
        }
    }

    return { prices: [], source: null, error: errors.join('; ') };
}

// ============================================
// PRICE HISTORY SYNC
// ============================================

/**
 * Fill every missing day in flux_price_history between the oldest transaction and yesterday.
 *
 * Gap-aware on purpose: the previous implementation only extended forward from MAX(date) and
 * returned early when MAX(date) === today, so a hole in the middle of the table could never heal.
 * Today is deliberately excluded — the live-price path in revenueService handles it, and a
 * partial candle would freeze a wrong close price for the day.
 */
export async function syncPriceHistory(options = {}) {
    const { force = false } = options;

    if (!force && Date.now() < cooldownUntil) {
        return { added: 0, gapsBefore: null, gapsAfter: null, cooldown: true };
    }

    const requiredEnd = addDays(toDateStr(Date.now()), -1); // yesterday

    const [oldestTx, oldestPrice] = await Promise.all([
        getOldestTransactionDate(),
        getOldestPriceDate()
    ]);

    // We only need prices as far back as our oldest transaction. Fall back to existing price
    // coverage, then to a fixed window on a completely empty database.
    const requiredStart = oldestTx || oldestPrice || addDays(requiredEnd, -(DEFAULT_SEED_DAYS - 1));

    if (requiredStart > requiredEnd) {
        return { added: 0, gapsBefore: 0, gapsAfter: 0 };
    }

    const existingRows = await getPricesForDateRange(requiredStart, requiredEnd);
    const existing = new Set(existingRows.map(r => String(r.date).slice(0, 10)));
    const missing = enumerateDates(requiredStart, requiredEnd).filter(d => !existing.has(d));

    if (missing.length === 0) {
        lastSync = { ...lastSync, at: Date.now(), gapsRemaining: 0, error: null };
        return { added: 0, gapsBefore: 0, gapsAfter: 0, total: await getPriceHistoryCount() };
    }

    log.info('Price history has %d missing day(s) between %s and %s', missing.length, requiredStart, requiredEnd);

    const missingSet = new Set(missing);
    const { prices, source, error } = await fetchHistoricalPrices(missing[0], requiredEnd);
    const toInsert = prices.filter(p => missingSet.has(p.date));

    if (toInsert.length > 0) {
        const ok = await insertPriceHistoryBatch(toInsert);
        if (!ok) {
            lastSync = { at: Date.now(), added: 0, source, error: 'database write failed', gapsRemaining: missing.length };
            cooldownUntil = Date.now() + FAILED_SYNC_COOLDOWN_MS;
            return { added: 0, gapsBefore: missing.length, gapsAfter: missing.length, error: 'database write failed' };
        }
    }

    const gapsAfter = missing.length - toInsert.length;

    if (toInsert.length === 0) {
        // Every source failed, or the gap predates all available data. Back off so a 5-minute
        // scheduler doesn't hammer the APIs, but make the reason loud.
        log.error('Price history sync filled 0 of %d missing day(s): %s', missing.length, error || 'no source had data');
        cooldownUntil = Date.now() + FAILED_SYNC_COOLDOWN_MS;
    } else {
        log.info('Price history synced: %d day(s) added from %s (%d still missing)', toInsert.length, source, gapsAfter);
        // Partial fill: retry sooner is fine, but avoid a tight loop on the permanently-unfillable tail
        cooldownUntil = gapsAfter > 0 ? Date.now() + FAILED_SYNC_COOLDOWN_MS : 0;
    }

    lastSync = {
        at: Date.now(),
        added: toInsert.length,
        source,
        error: toInsert.length === 0 ? (error || 'no source had data') : null,
        gapsRemaining: gapsAfter
    };

    return {
        added: toInsert.length,
        gapsBefore: missing.length,
        gapsAfter,
        source,
        error: toInsert.length === 0 ? (error || 'no source had data') : null,
        total: await getPriceHistoryCount()
    };
}

/**
 * Coverage report for /api/health and /api/admin/price-history-status.
 * Unhealthy when the newest stored price is more than 2 days old — that is the signal that
 * would have caught the CryptoCompare outage immediately.
 */
export async function getPriceHistoryStatus() {
    const [oldest, newest, days] = await Promise.all([
        getOldestPriceDate(),
        getLatestPriceDate(),
        getPriceHistoryCount()
    ]);

    const staleAfter = addDays(toDateStr(Date.now()), -2);
    const healthy = Boolean(newest) && String(newest).slice(0, 10) >= staleAfter;

    return {
        days,
        oldest: oldest ? String(oldest).slice(0, 10) : null,
        newest: newest ? String(newest).slice(0, 10) : null,
        healthy,
        lastSync
    };
}

// ============================================
// PRICE MAP BUILDER
// ============================================

/**
 * Build a Map<dateString, priceUSD> for O(1) lookup during transaction processing.
 * Loads prices from the DB for the given range.
 */
export async function buildPriceMap(startDate, endDate) {
    const rows = await getPricesForDateRange(startDate, endDate);
    const map = new Map();
    for (const row of rows) {
        map.set(String(row.date).slice(0, 10), row.price_usd);
    }
    log.info('Built price map: %d days (%s to %s)', map.size, startDate, endDate);
    return map;
}

/**
 * Build a price map covering all available price history.
 * Used when the date range of transactions isn't known upfront.
 */
export async function buildFullPriceMap() {
    const oldest = await getOldestPriceDate();
    const today = new Date().toISOString().split('T')[0];
    if (!oldest) return new Map();
    return await buildPriceMap(oldest, today);
}

// ============================================
// BACKFILL NULL USD AMOUNTS
// ============================================

/**
 * Find all transactions with amount_usd IS NULL, look up the historical price
 * for their date, and batch-update the USD amounts.
 *
 * Pages with an offset that advances only past rows we could NOT price. Rows we do price
 * leave the NULL set, so they don't shift the window. The previous version restarted at
 * offset 0 every pass and gave up as soon as one batch produced no updates, which meant a
 * single uncovered date at the top of the table hid every older transaction.
 */
export async function backfillNullUsdAmounts() {
    log.info('Starting USD backfill for NULL amount_usd transactions...');

    // Ensure price history is current — force past the failure cooldown, this is admin-triggered
    const priceSync = await syncPriceHistory({ force: true });

    const priceMap = await buildFullPriceMap();
    const coverage = {
        oldestPriceDate: await getOldestPriceDate(),
        newestPriceDate: await getLatestPriceDate(),
        priceDays: priceMap.size
    };

    if (priceMap.size === 0) {
        log.warn('No price history available - cannot backfill');
        return { updated: 0, skipped: 0, missingPriceDates: [], coverage, priceSync };
    }

    let updated = 0;
    let skipped = 0;
    let offset = 0;
    const missingPriceDates = new Set();
    const batchSize = REVENUE_SYNC.PRICE_HISTORY_BATCH_SIZE;

    // Hard iteration cap — a safety net, not the normal exit path
    for (let pass = 0; pass < 1000; pass++) {
        const txs = await getTransactionsWithNullUsd(batchSize, offset);
        if (txs.length === 0) break;

        const updates = [];
        for (const tx of txs) {
            const date = String(tx.date).slice(0, 10);
            const price = priceMap.get(date);
            if (price) {
                updates.push({ txid: tx.txid, amount_usd: tx.amount * price });
            } else {
                missingPriceDates.add(date);
                skipped++;
            }
        }

        if (updates.length > 0) {
            const ok = await updateTransactionUsdBatch(updates);
            if (!ok) {
                log.warn('Database error during backfill');
                break;
            }
            updated += updates.length;
        }

        // Priced rows dropped out of the NULL set; only the unpriced ones still occupy the window
        offset += txs.length - updates.length;

        if (txs.length < batchSize) break;
    }

    const missingDates = [...missingPriceDates].sort();
    log.info('USD backfill complete: %d updated, %d skipped (%d dates without price data)', updated, skipped, missingDates.length);

    return { updated, skipped, missingPriceDates: missingDates, coverage, priceSync };
}

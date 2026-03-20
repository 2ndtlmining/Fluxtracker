import axios from 'axios';
import { API_ENDPOINTS, REVENUE_SYNC } from '../config.js';
import {
    insertPriceHistoryBatch,
    getLatestPriceDate,
    getOldestPriceDate,
    getPricesForDateRange,
    getTransactionsWithNullUsd,
    updateTransactionUsdBatch,
    getPriceHistoryCount
} from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('priceHistoryService');

// ============================================
// PRICE HISTORY SYNC
// ============================================

/**
 * Sync historical FLUX/USD daily prices from CryptoCompare.
 * Idempotent — fetches only missing days since the last stored date.
 * On first run, fetches up to 2000 days of history (CryptoCompare limit per call).
 */
export async function syncPriceHistory() {
    const latestDate = await getLatestPriceDate();
    const today = new Date().toISOString().split('T')[0];

    if (latestDate === today) {
        log.info('Price history already up to date');
        return { added: 0, total: await getPriceHistoryCount() };
    }

    log.info('Syncing price history (latest stored: %s)...', latestDate || 'none');

    try {
        // CryptoCompare histoday returns up to 2000 daily candles ending at today
        const url = API_ENDPOINTS.PRICE_HISTORY_CRYPTOCOMPARE;
        const response = await axios.get(url, { timeout: 30000 });

        if (!response.data || response.data.Response === 'Error') {
            log.error('CryptoCompare error: %s', response.data?.Message || 'unknown');
            return { added: 0, error: response.data?.Message };
        }

        const dataPoints = response.data.Data?.Data;
        if (!dataPoints || dataPoints.length === 0) {
            log.warn('No price data returned from CryptoCompare');
            return { added: 0, error: 'no data' };
        }

        // Convert to our format, filtering only days we don't have yet
        const prices = [];
        for (const point of dataPoints) {
            // Skip entries with no price (close === 0 means no trading data)
            if (!point.close || point.close === 0) continue;

            const date = new Date(point.time * 1000).toISOString().split('T')[0];

            // If we have data and this date is not newer than what we have, skip
            // (INSERT OR REPLACE handles duplicates, but skipping saves time)
            if (latestDate && date <= latestDate) continue;

            prices.push({
                date,
                price_usd: point.close,
                source: 'cryptocompare'
            });
        }

        if (prices.length === 0) {
            log.info('No new price data to insert');
            return { added: 0, total: await getPriceHistoryCount() };
        }

        const ok = await insertPriceHistoryBatch(prices);
        if (!ok) {
            return { added: 0, error: 'database not available' };
        }

        const total = await getPriceHistoryCount();
        log.info('Price history synced: %d new days added (%d total)', prices.length, total);
        return { added: prices.length, total };

    } catch (error) {
        log.error({ err: error }, 'Price history sync failed');

        // Try CoinGecko as fallback for just the last few days
        if (!latestDate) {
            log.info('Skipping CoinGecko fallback on first sync (too many days)');
        }

        return { added: 0, error: error.message };
    }
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
        map.set(row.date, row.price_usd);
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
 */
export async function backfillNullUsdAmounts() {
    log.info('Starting USD backfill for NULL amount_usd transactions...');

    // Ensure price history is current
    await syncPriceHistory();

    const priceMap = await buildFullPriceMap();
    if (priceMap.size === 0) {
        log.warn('No price history available - cannot backfill');
        return { updated: 0, skipped: 0, missingPriceDates: [] };
    }

    let updated = 0;
    let skipped = 0;
    const missingPriceDates = new Set();
    const batchSize = REVENUE_SYNC.PRICE_HISTORY_BATCH_SIZE;

    // Process in batches to avoid loading all NULL transactions at once
    while (true) {
        const txs = await getTransactionsWithNullUsd(batchSize);
        if (txs.length === 0) break;

        const updates = [];
        for (const tx of txs) {
            const price = priceMap.get(tx.date);
            if (price) {
                updates.push({
                    txid: tx.txid,
                    amount_usd: tx.amount * price
                });
            } else {
                missingPriceDates.add(tx.date);
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

        // If we got fewer than BATCH_SIZE, we've processed everything
        // Also break if nothing was updated (all remaining are missing prices)
        if (txs.length < batchSize || updates.length === 0) break;
    }

    const missingDates = [...missingPriceDates].sort();
    log.info('USD backfill complete: %d updated, %d skipped (%d dates without price data)', updated, skipped, missingDates.length);

    return { updated, skipped, missingPriceDates: missingDates };
}

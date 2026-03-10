import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';
import {
    insertPriceHistoryBatch,
    getLatestPriceDate,
    getOldestPriceDate,
    getPricesForDateRange,
    getTransactionsWithNullUsd,
    updateTransactionUsdBatch,
    getPriceHistoryCount
} from '../db/database.js';

// ============================================
// PRICE HISTORY SYNC
// ============================================

/**
 * Sync historical FLUX/USD daily prices from CryptoCompare.
 * Idempotent — fetches only missing days since the last stored date.
 * On first run, fetches up to 2000 days of history (CryptoCompare limit per call).
 */
export async function syncPriceHistory() {
    const latestDate = getLatestPriceDate();
    const today = new Date().toISOString().split('T')[0];

    if (latestDate === today) {
        console.log('Price history already up to date');
        return { added: 0, total: getPriceHistoryCount() };
    }

    console.log(`Syncing price history (latest stored: ${latestDate || 'none'})...`);

    try {
        // CryptoCompare histoday returns up to 2000 daily candles ending at today
        const url = API_ENDPOINTS.PRICE_HISTORY_CRYPTOCOMPARE;
        const response = await axios.get(url, { timeout: 30000 });

        if (!response.data || response.data.Response === 'Error') {
            console.error('CryptoCompare error:', response.data?.Message || 'unknown');
            return { added: 0, error: response.data?.Message };
        }

        const dataPoints = response.data.Data?.Data;
        if (!dataPoints || dataPoints.length === 0) {
            console.warn('No price data returned from CryptoCompare');
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
            console.log('No new price data to insert');
            return { added: 0, total: getPriceHistoryCount() };
        }

        const ok = insertPriceHistoryBatch(prices);
        if (!ok) {
            return { added: 0, error: 'write lock not held' };
        }

        const total = getPriceHistoryCount();
        console.log(`Price history synced: ${prices.length} new days added (${total} total)`);
        return { added: prices.length, total };

    } catch (error) {
        console.error('Price history sync failed:', error.message);

        // Try CoinGecko as fallback for just the last few days
        if (!latestDate) {
            console.log('Skipping CoinGecko fallback on first sync (too many days)');
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
export function buildPriceMap(startDate, endDate) {
    const rows = getPricesForDateRange(startDate, endDate);
    const map = new Map();
    for (const row of rows) {
        map.set(row.date, row.price_usd);
    }
    console.log(`Built price map: ${map.size} days (${startDate} to ${endDate})`);
    return map;
}

/**
 * Build a price map covering all available price history.
 * Used when the date range of transactions isn't known upfront.
 */
export function buildFullPriceMap() {
    const oldest = getOldestPriceDate();
    const today = new Date().toISOString().split('T')[0];
    if (!oldest) return new Map();
    return buildPriceMap(oldest, today);
}

// ============================================
// BACKFILL NULL USD AMOUNTS
// ============================================

/**
 * Find all transactions with amount_usd IS NULL, look up the historical price
 * for their date, and batch-update the USD amounts.
 */
export async function backfillNullUsdAmounts() {
    console.log('Starting USD backfill for NULL amount_usd transactions...');

    // Ensure price history is current
    await syncPriceHistory();

    const priceMap = buildFullPriceMap();
    if (priceMap.size === 0) {
        console.warn('No price history available - cannot backfill');
        return { updated: 0, skipped: 0, missingPriceDates: [] };
    }

    let updated = 0;
    let skipped = 0;
    const missingPriceDates = new Set();
    const BATCH_SIZE = 1000;

    // Process in batches to avoid loading all NULL transactions at once
    while (true) {
        const txs = getTransactionsWithNullUsd(BATCH_SIZE);
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
            const ok = updateTransactionUsdBatch(updates);
            if (!ok) {
                console.warn('Write lock lost during backfill');
                break;
            }
            updated += updates.length;
        }

        // If we got fewer than BATCH_SIZE, we've processed everything
        // Also break if nothing was updated (all remaining are missing prices)
        if (txs.length < BATCH_SIZE || updates.length === 0) break;
    }

    const missingDates = [...missingPriceDates].sort();
    console.log(`USD backfill complete: ${updated} updated, ${skipped} skipped (${missingDates.length} dates without price data)`);

    return { updated, skipped, missingPriceDates: missingDates };
}

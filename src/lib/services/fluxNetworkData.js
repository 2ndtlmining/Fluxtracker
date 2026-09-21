import { API_ENDPOINTS } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';
import { updateCurrentMetrics } from '../db/database.js';

const log = createLogger('fluxNetworkData');

// ============================================
// PRICE FETCHING
// ============================================

/**
 * Last price we actually fetched, and when (issue #183).
 *
 * Every source can miss in the same pass -- CoinGecko rate-limits by IP and CryptoCompare
 * returns 401 without a key -- and returning null then means every transaction synced in
 * that pass is stored with amount_usd = NULL. FLUX does not move far in an hour, so a
 * recent price is a far better answer than no answer at all.
 *
 * Held in memory rather than read back from current_metrics.flux_price_usd on purpose:
 * current_metrics.last_update is bumped by ANY metrics write (nodes, apps, resources), so
 * it says nothing about how old the PRICE is. A stale price wearing a fresh timestamp is
 * exactly the failure this is meant to prevent. The cost is that a process which has never
 * had a successful fetch has no fallback -- and that case is covered instead by the
 * same-day repair pass, which re-prices those rows as soon as any later pass succeeds.
 */
const PRICE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h
let lastGoodPrice = null; // { price: number, at: number }

/** The cached price and its age in ms, or null if nothing has been fetched yet. */
export function getLastGoodPrice() {
    if (!lastGoodPrice) return null;
    return { price: lastGoodPrice.price, at: lastGoodPrice.at, ageMs: Date.now() - lastGoodPrice.at };
}

/** Test seam -- clears the in-memory price cache. */
export function resetLastGoodPrice() {
    lastGoodPrice = null;
}

function rememberPrice(price) {
    lastGoodPrice = { price, at: Date.now() };
    return price;
}

/**
 * Store the price, but never let a failed store discard a good fetch (issue #220).
 *
 * updateCurrentMetrics() throws now, which is what the services that follow it with
 * updateSyncStatus(..., 'completed') need. Here the write is a side effect: the header and
 * the USD pricing of every transaction in this pass use the RETURNED value. Letting the
 * throw escape would send a successful CoinGecko fetch down the fallback chain and end in
 * a null price for the whole pass -- a database outage silently becoming a pricing outage.
 */
async function persistPrice(price) {
    try {
        await updateCurrentMetrics({ flux_price_usd: price });
    } catch (e) {
        log.warn({ err: e }, 'Price fetched but could not be stored -- using it anyway');
    }
}

/**
 * Fetch FLUX price in USD.
 * Tries three sources in order: CoinGecko → Flux Explorer → CryptoCompare
 */
export async function fetchFluxPrice() {
    log.info('Fetching FLUX price');

    // 1. CoinGecko
    try {
        const data = await resilientFetch(API_ENDPOINTS.PRICE_COINGECKO, { timeout: 10000, breakerKey: 'coingecko-price' });
        if (data?.zelcash?.usd) {
            const price = data.zelcash.usd;
            log.info({ price }, 'FLUX price fetched from CoinGecko: $%s', price);
            await persistPrice(price);
            return rememberPrice(price);
        }
    } catch (e) {
        log.warn({ err: e }, 'CoinGecko failed');
    }

    // 2. Flux Explorer  (returns { status:200, currency:"USD", rate:X })
    try {
        const data = await resilientFetch(API_ENDPOINTS.PRICE_EXPLORER, { timeout: 10000, breakerKey: 'flux-explorer-rate' });
        if (data?.rate) {
            const price = parseFloat(data.rate);
            if (price > 0) {
                log.info({ price }, 'FLUX price fetched from Explorer: $%s', price);
                await persistPrice(price);
                return rememberPrice(price);
            }
        }
    } catch (e) {
        log.warn({ err: e }, 'Flux Explorer price failed');
    }

    // 3. CryptoCompare  (returns { USD: X })
    try {
        const data = await resilientFetch(API_ENDPOINTS.PRICE_CRYPTOCOMPARE, { timeout: 10000, breakerKey: 'cryptocompare-price' });
        if (data?.USD) {
            const price = parseFloat(data.USD);
            if (price > 0) {
                log.info({ price }, 'FLUX price fetched from CryptoCompare: $%s', price);
                await persistPrice(price);
                return rememberPrice(price);
            }
        }
    } catch (e) {
        log.warn({ err: e }, 'CryptoCompare failed');
    }

    // Fall back to the most recent price this process actually fetched, if it is recent
    // enough to still be a fair approximation. Better a 20-minute-old price than a NULL that
    // understates the day's USD revenue until tomorrow's backfill.
    const cached = getLastGoodPrice();
    if (cached && cached.ageMs <= PRICE_FALLBACK_MAX_AGE_MS) {
        const ageMin = Math.round(cached.ageMs / 60000);
        log.warn({ price: cached.price, ageMin }, 'All price sources failed -- using last known price ($%s, %d min old)', cached.price, ageMin);
        return cached.price;
    }

    log.warn('All price sources failed and no recent cached price -- USD values will be null');
    return null;
}

// ============================================
// BLOCKCHAIN DATA FETCHING
// ============================================

/**
 * Fetch current block height
 */
export async function fetchCurrentBlockHeight() {
    try {
        const body = await resilientFetch(`${API_ENDPOINTS.DAEMON}/getblockcount`, {
            timeout: 10000,
            breakerKey: 'flux-explorer-blockheight',
            validate: d => d?.status === 'success'
        });

        return body.data;

    } catch (error) {
        log.error({ err: error }, 'Error fetching block height');
        throw error;
    }
}

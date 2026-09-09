import { API_ENDPOINTS } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';
import { updateCurrentMetrics } from '../db/database.js';

const log = createLogger('fluxNetworkData');

// ============================================
// PRICE FETCHING
// ============================================

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
            await updateCurrentMetrics({ flux_price_usd: price });
            return price;
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
                await updateCurrentMetrics({ flux_price_usd: price });
                return price;
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
                await updateCurrentMetrics({ flux_price_usd: price });
                return price;
            }
        }
    } catch (e) {
        log.warn({ err: e }, 'CryptoCompare failed');
    }

    log.warn('All price sources failed -- USD values will be null');
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

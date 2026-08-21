// flux-performance-dashboard/src/lib/services/cryptoService.js

import { CRYPTO_REPOS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getRunningApps, countByCategory, countConfiguredRepos } from './runningAppsProvider.js';
import { createLogger } from '../logger.js';

const log = createLogger('cryptoService');

/**
 * Fetch crypto node statistics.
 *
 * `crypto_nodes_total` uses categorizeImage() — the same rule the crypto category card
 * uses — so both surfaces report the same number. CRYPTO_REPOS drives the featured
 * per-node breakdown columns only.
 */
export async function fetchCryptoStats() {
    try {
        log.info('Fetching crypto node statistics...');

        const runningApps = await getRunningApps();

        const cryptoCounts = countConfiguredRepos(runningApps, CRYPTO_REPOS);
        const total = countByCategory(runningApps, 'crypto');

        const cryptoData = { ...cryptoCounts, crypto_nodes_total: total };

        await updateCurrentMetrics(cryptoData);
        await updateSyncStatus('crypto', 'completed');

        log.info({ cryptoData }, 'Crypto stats updated: %d instances', total);

        return cryptoData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching crypto stats');
        await updateSyncStatus('crypto', 'failed', error.message);
        throw error;
    }
}

/**
 * Format crypto stats for display
 */
export function formatCryptoStats(cryptoData) {
    return {
        total: cryptoData.crypto_nodes_total,
        nodes: CRYPTO_REPOS.map(crypto => ({
            name: crypto.name,
            count: cryptoData[crypto.dbKey] || 0,
            repo: crypto.imageMatch
        }))
    };
}

/**
 * Get breakdown by crypto category
 */
export function getCryptoBreakdown(cryptoData) {
    const total = cryptoData.crypto_nodes_total || 0;
    
    // Find specific repos dynamically
    const timpiCollector = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_timpi_collector');
    const timpiGeocore = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_timpi_geocore');
    const ravencoin = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_ravencoin');
    const kadena = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_kadena');
    const kaspa = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_kaspa');
    const alephium = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_alephium');
    const presearch = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_presearch');
    const streamr = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_streamr');
    const bittensor = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_bittensor');
    
    const breakdown = {
        timpi: {
            count: (cryptoData[timpiCollector?.dbKey] || 0) + (cryptoData[timpiGeocore?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[timpiCollector?.dbKey] || 0) + (cryptoData[timpiGeocore?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        },
        mining: {
            count: (cryptoData[ravencoin?.dbKey] || 0) + (cryptoData[kadena?.dbKey] || 0) + (cryptoData[kaspa?.dbKey] || 0) + (cryptoData[alephium?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[ravencoin?.dbKey] || 0) + (cryptoData[kadena?.dbKey] || 0) + (cryptoData[kaspa?.dbKey] || 0) + (cryptoData[alephium?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        },
        other: {
            count: (cryptoData[presearch?.dbKey] || 0) + (cryptoData[streamr?.dbKey] || 0) + (cryptoData[bittensor?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[presearch?.dbKey] || 0) + (cryptoData[streamr?.dbKey] || 0) + (cryptoData[bittensor?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        }
    };
    
    return breakdown;
}
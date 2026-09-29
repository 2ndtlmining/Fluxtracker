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
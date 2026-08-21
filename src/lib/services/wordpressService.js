import { API_ENDPOINTS, WORDPRESS_CONFIG } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getRunningApps, countByCategory } from './runningAppsProvider.js';
import { createLogger } from '../logger.js';

const log = createLogger('wordpressService');

/**
 * Fetch WordPress statistics.
 *
 * Counts via categorizeImage() so the number matches the WordPress category card.
 */
export async function fetchWordPressStats() {
    try {
        log.info('Fetching WordPress statistics...');

        const runningApps = await getRunningApps();
        const count = countByCategory(runningApps, 'wordpress');

        const wordpressData = { wordpress_count: count };

        await updateCurrentMetrics(wordpressData);
        await updateSyncStatus('wordpress', 'completed');

        log.info({ wordpressData }, 'WordPress stats updated: %d instances', count);

        return wordpressData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching WordPress stats');
        await updateSyncStatus('wordpress', 'failed', error.message);
        throw error;
    }
}

/**
 * Format WordPress stats for display
 */
export function formatWordPressStats(wordpressData) {
    return {
        count: wordpressData.wordpress_count,
        label: 'WordPress Instances'
    };
}

/**
 * Get WordPress configuration
 * Useful for debugging or displaying config info
 */
export function getWordPressConfig() {
    return {
        name: WORDPRESS_CONFIG.name,
        dbKey: WORDPRESS_CONFIG.dbKey,
        imageMatch: WORDPRESS_CONFIG.imageMatch,
        apiEndpoint: API_ENDPOINTS.WORDPRESS
    };
}

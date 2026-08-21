// flux-performance-dashboard/src/lib/services/gamingService.js

import { GAMING_REPOS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getRunningApps, countByCategory, countConfiguredRepos } from './runningAppsProvider.js';
import { createLogger } from '../logger.js';

const log = createLogger('gamingService');

/**
 * Fetch gaming app statistics.
 *
 * `gaming_apps_total` is the count of every image categorizeImage() calls gaming — the same
 * rule the gaming category card uses — so the two surfaces can no longer disagree. GAMING_REPOS
 * only drives the featured per-game breakdown columns.
 */
export async function fetchGamingStats() {
    try {
        log.info('Fetching gaming statistics...');

        const runningApps = await getRunningApps();

        const gameCounts = countConfiguredRepos(runningApps, GAMING_REPOS);
        const total = countByCategory(runningApps, 'gaming');

        const gamingData = { ...gameCounts, gaming_apps_total: total };

        await updateCurrentMetrics(gamingData);
        await updateSyncStatus('gaming', 'completed');

        log.info({ gamingData }, 'Gaming stats updated: %d instances', total);

        return gamingData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching gaming stats');
        await updateSyncStatus('gaming', 'failed', error.message);
        throw error;
    }
}

/**
 * Format gaming stats for display
 */
export function formatGamingStats(gamingData) {
    return {
        total: gamingData.gaming_apps_total,
        games: GAMING_REPOS.map(game => ({
            name: game.name,
            count: gamingData[game.dbKey] || 0,
            repo: game.imageMatch
        }))
    };
}

// flux-performance-dashboard/src/lib/services/gamingService.js

import { GAMING_REPOS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getRunningApps, countByCategory, countConfiguredRepos, countGames, countGamingInstances } from './runningAppsProvider.js';
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

        // Image-based total (issue #106's rule). Kept as-is because daily_snapshots has
        // years of history counted this way -- switching the snapshotted column would put a
        // step in the Historical Performance trend that reads as growth rather than as a
        // change of method.
        const imageTotal = countByCategory(runningApps, 'gaming');

        // App-name-aware total (issue #162/#163): the real number of running game instances,
        // including the ~35% whose specs are encrypted and carry no image. Recorded in its
        // own column so the two methods can be compared like for like over time, and so the
        // Gaming card has a same-method history to draw its comparison arrows from.
        const liveTotal = countGamingInstances(runningApps);

        const gamingData = {
            ...gameCounts,
            gaming_apps_total: imageTotal,
            gaming_instances_total: liveTotal
        };

        if (liveTotal !== imageTotal) {
            log.info(
                { imageTotal, liveTotal, hidden: liveTotal - imageTotal },
                'Gaming: %d instances visible by image, %d by name+image (%d only identifiable by name)',
                imageTotal,
                liveTotal,
                liveTotal - imageTotal
            );
        }

        await updateCurrentMetrics(gamingData);
        await updateSyncStatus('gaming', 'completed');

        log.info({ gamingData }, 'Gaming stats updated: %d instances', liveTotal);

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

/**
 * Live per-game breakdown for the Gaming card (issue #163).
 *
 * Read straight from the shared running-apps payload rather than from stored metrics: the
 * game set is open-ended (a new dedicated site appears without a schema change), so it does
 * not fit the fixed per-game columns GAMING_REPOS drives.
 *
 * @param {number} limit how many games to return; 0 for all
 */
export async function getLiveGameBreakdown(limit = 0) {
    const runningApps = await getRunningApps();
    const games = [...countGames(runningApps)].map(([name, instances]) => ({ name, instances }));

    return {
        total: countGamingInstances(runningApps),
        gameCount: games.length,
        games: limit > 0 ? games.slice(0, limit) : games,
        fetchedAt: runningApps.fetchedAt
    };
}

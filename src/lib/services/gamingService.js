// flux-performance-dashboard/src/lib/services/gamingService.js

import { GAMING_REPOS, TRACKED_GAMES, GAME_COLUMN_BY_NAME } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getRunningApps, countByCategory, countGames, countGamingInstances, READ_PATH_TTL_MS } from './runningAppsProvider.js';
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

        // Per-game columns take the app-name-aware breakdown (issue #231), the same
        // countGames() output behind the Gaming card and game_snapshots -- so the stored
        // history, the card and the chart finally report one number per game.
        //
        // They used to come from countConfiguredRepos(..., GAMING_REPOS), which counts by
        // Docker image only. Enterprise-encrypted specs carry no image, so that stored 3
        // for Valheim while 108 were running, and had nowhere at all to put Dragonwilds.
        //
        // A tracked game missing from a SUCCESSFUL breakdown really did run nothing, so it
        // is written as 0, not null: this provider throws rather than returning an empty
        // payload when globalappsspecifications is unavailable, so "absent" here cannot
        // mean "not collected".
        const breakdown = countGames(runningApps);
        const gameCounts = Object.fromEntries(TRACKED_GAMES.map(g => [g.dbKey, 0]));
        for (const [name, instances] of breakdown) {
            const column = GAME_COLUMN_BY_NAME.get(name);
            // A game with no column yet is not invented as a key -- it is already recorded
            // in game_snapshots, which is open-ended by design.
            if (column) gameCounts[column] = instances;
        }

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
        // TRACKED_GAMES, so the games with no matchable image are not silently omitted
        // from a list built out of the very columns they now populate (issue #231).
        games: TRACKED_GAMES.map(game => ({
            name: game.name,
            count: gamingData[game.dbKey] || 0,
            repo: GAMING_REPOS.find(r => r.dbKey === game.dbKey)?.imageMatch ?? null
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
    // Viewer read path and the snapshot (issue #296): accept the cycle's copy rather than
    // paying the upstream fetch whenever it is more than a minute old.
    const runningApps = await getRunningApps({ ttlMs: READ_PATH_TTL_MS });
    const games = [...countGames(runningApps)].map(([name, instances]) => ({ name, instances }));

    return {
        total: countGamingInstances(runningApps),
        gameCount: games.length,
        games: limit > 0 ? games.slice(0, limit) : games,
        fetchedAt: runningApps.fetchedAt
    };
}

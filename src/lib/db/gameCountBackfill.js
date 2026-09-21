// Repair game counts that were written to daily_snapshots as a fabricated 0 (issue #229).
//
// snapshotManager and both adapters each enumerated the gaming columns literally, so games
// added to GAMING_REPOS later -- rust, terraria, ark, windrose -- were never written. Because
// schemaMigrator creates game columns as `INTEGER DEFAULT 0`, the unwritten column landed as
// 0 rather than NULL, so the NULL top-up could never repair it and every day recorded "no
// instances of that game ran" while current_metrics held the real count.
//
// The repair is EXACT rather than an estimate: repo_snapshots stores per-image daily counts
// produced by the same image-matching pass (`toRepoCounts(runningApps)`) that feeds the live
// game counter, so reconstructing a day's figure from it reproduces what should have been
// written that day. Verified against the real table: rust/terraria/ark have 615-622 daily
// rows going back to 2024-06-07.
//
// Exposed as POST /api/admin/backfill-game-counts.

import { getAllSnapshots, getRepoHistory, fillZeroSnapshotColumns } from './database.js';
import { GAMING_REPOS } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('gameCountBackfill');

/** A repo's imageMatch is either a single pattern or a list of them. */
function patternsFor(repo) {
    const m = repo.imageMatch;
    return Array.isArray(m) ? m : [m].filter(Boolean);
}

/**
 * Rebuild, per date, the instance count for each configured game from repo_snapshots.
 * Returns Map<snapshot_date, Map<dbKey, count>>.
 *
 * One getRepoHistory() call per image pattern rather than per date: the whole point is to
 * cover ~600 days, and a per-day query would be 600 round trips per game.
 */
async function reconstructCounts(days) {
    const byDate = new Map();

    for (const repo of GAMING_REPOS) {
        for (const pattern of patternsFor(repo)) {
            let history = [];
            try {
                history = await getRepoHistory(pattern, days);
            } catch (error) {
                log.warn({ err: error, pattern }, 'Could not read repo history for %s', pattern);
                continue;
            }

            for (const row of history || []) {
                const date = row.snapshot_date;
                const count = Number(row.instance_count) || 0;
                if (!date || count <= 0) continue;

                if (!byDate.has(date)) byDate.set(date, new Map());
                const perGame = byDate.get(date);
                // A game with several images (Rust has two) sums across them, the same way
                // the live counter does.
                perGame.set(repo.dbKey, (perGame.get(repo.dbKey) || 0) + count);
            }
        }
    }

    return byDate;
}

/**
 * Fill zeroed game columns across snapshot history.
 *
 * Only a stored 0 is ever replaced, and only with a positive reconstructed count -- see
 * fillZeroSnapshotColumns. So a day the game genuinely ran zero instances stays 0, and the
 * game columns that were always written correctly (palworld, valheim, ...) are never
 * restated even though they are recomputed here too.
 */
export async function backfillGameCounts() {
    const snapshots = await getAllSnapshots();
    const result = { total: snapshots.length, repaired: 0, columns: 0, skipped: 0, failed: 0 };

    if (snapshots.length === 0) {
        log.info('No snapshots to repair');
        return result;
    }

    // +7 for slack: repo_snapshots and daily_snapshots can differ at the edges.
    const counts = await reconstructCounts(snapshots.length + 7);

    for (const snapshot of snapshots) {
        const perGame = counts.get(snapshot.snapshot_date);
        if (!perGame || perGame.size === 0) {
            result.skipped++;
            continue;
        }

        try {
            const filled = await fillZeroSnapshotColumns(
                snapshot.snapshot_date,
                Object.fromEntries(perGame)
            );
            if (filled.length > 0) {
                result.repaired++;
                result.columns += filled.length;
            } else {
                result.skipped++;
            }
        } catch (error) {
            log.warn(
                { err: error, date: snapshot.snapshot_date },
                'Could not repair game counts for %s', snapshot.snapshot_date
            );
            result.failed++;
        }
    }

    log.info(
        result,
        'Game count repair: %d day(s) repaired (%d column values), %d unchanged, %d failed of %d',
        result.repaired, result.columns, result.skipped, result.failed, result.total
    );
    return result;
}

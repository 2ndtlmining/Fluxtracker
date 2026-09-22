import { TRACKED_GAMES, GAME_COLUMN_BY_NAME } from '../config.js';
import { getGameSnapshotHistory, getAllSnapshots, setSnapshotGameColumns } from './database.js';
import { createLogger } from '../logger.js';

const log = createLogger('gameColumnRepair');

/**
 * Bring the per-game `gaming_*` columns onto one definition (issue #231).
 *
 * The columns used to hold an image-only count and now hold the app-name-aware one that
 * the Gaming card and game_snapshots use. That leaves history in two halves:
 *
 *   - Days that game_snapshots covers are REWRITTEN from it. Not filled — rewritten: the
 *     stored values are counts of a different thing (gaming_valheim = 3 where 108 were
 *     running), so fillSnapshotNullColumns' "only ever fill a NULL" rule would leave every
 *     wrong value exactly where it is.
 *   - Days before game_snapshots existed are set to NULL. No app-name reading was ever
 *     taken for them and none can be reconstructed — migration 013 is explicit that
 *     repo_snapshots cannot serve this, because the games that most need tracking have
 *     encrypted specs with no image at all. NULL is what "no reading" means everywhere
 *     else here, and the KPI layer already treats it as missing rather than as a real
 *     zero. Leaving the old numbers would put a 27x step in the middle of one column that
 *     reads as growth rather than as a change of method.
 *
 * On a day game_snapshots DOES cover, a tracked game absent from it ran nothing, so it is
 * written as 0. createGameSnapshots writes one row per game that had instances and writes
 * no rows at all for a failed collection, so "the day has rows but not this game" is
 * unambiguous.
 *
 * Idempotent: running it twice produces the same rows.
 */
export async function repairGameColumns({ dryRun = false } = {}) {
    const columns = TRACKED_GAMES.map(g => g.dbKey);

    // Widest range the table can hold; the query is bounded by what exists, not by this.
    const gameRows = await getGameSnapshotHistory('2000-01-01', '2100-01-01');

    // An empty source must never be read as "no app-name data has ever existed", which
    // would wipe every day of history on a database that simply has not collected games
    // yet. Refuse instead.
    if (!gameRows || gameRows.length === 0) {
        log.warn('game_snapshots is empty — refusing to clear per-game columns');
        return { skipped: true, reason: 'game_snapshots is empty', repaired: 0, cleared: 0, dryRun };
    }

    /** date -> { column: instances } */
    const byDate = new Map();
    let firstGameSnapshotDate = null;

    for (const row of gameRows) {
        const date = row.snapshot_date;
        if (!firstGameSnapshotDate || date < firstGameSnapshotDate) firstGameSnapshotDate = date;

        const column = GAME_COLUMN_BY_NAME.get(row.game_name);
        // A game with no column is not an error: game_snapshots is open-ended by design
        // and only some of it earns a column. It stays recorded there.
        if (!column) continue;

        if (!byDate.has(date)) byDate.set(date, {});
        byDate.get(date)[column] = row.instance_count;
    }

    const snapshots = await getAllSnapshots();
    let repaired = 0;
    let cleared = 0;

    for (const snapshot of snapshots) {
        const date = snapshot.snapshot_date;

        if (date < firstGameSnapshotDate) {
            // Already cleared by an earlier run — skip so the count reports real work.
            if (columns.every(c => snapshot[c] == null)) continue;
            if (!dryRun) {
                await setSnapshotGameColumns(date, Object.fromEntries(columns.map(c => [c, null])));
            }
            cleared++;
            continue;
        }

        const breakdown = byDate.get(date);
        // A day at or after the cutover with no rows at all is a failed collection, not a
        // day nobody played. Leave it rather than writing a column full of fabricated 0s.
        if (!breakdown) continue;

        const values = Object.fromEntries(columns.map(c => [c, breakdown[c] ?? 0]));
        if (columns.every(c => snapshot[c] === values[c])) continue;

        if (!dryRun) {
            const written = await setSnapshotGameColumns(date, values);
            if (!written) continue;
        }
        repaired++;
    }

    log.info(
        { repaired, cleared, firstGameSnapshotDate, dryRun },
        'Per-game columns: %d day(s) rewritten from game_snapshots, %d day(s) cleared before %s%s',
        repaired, cleared, firstGameSnapshotDate, dryRun ? ' (dry run)' : ''
    );

    return { repaired, cleared, firstGameSnapshotDate, columns, dryRun };
}

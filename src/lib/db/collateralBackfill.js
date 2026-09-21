// Backfill locked collateral across existing snapshot history (issue #210).
//
// Unlike the unique_wallets backfill (#201), which imported figures from an outside source
// and left 37 days it had no data for as permanent gaps, this one is EXACT. Every snapshot
// back to day one already stores node_cumulus/nimbus/stratus, and the collateral rates have
// never changed, so the backfill is arithmetic on data the row already holds.
//
// Exposed as POST /api/admin/backfill-collateral.

import { getAllSnapshots, fillSnapshotNullColumns } from './database.js';
import { calculateLockedCollateral } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('collateralBackfill');

/**
 * Fill locked_collateral* on every snapshot that has tier counts but no collateral figure.
 *
 * Rows that already carry a collateral figure are left alone. That is deliberate and is the
 * whole reason the per-tier values are stored rather than derived at read time: if Flux ever
 * changes a collateral rate, a day already recorded must keep the rate that was in force
 * then, not be silently restated at the new one.
 *
 * Rows whose tier counts are missing are skipped rather than written as 0 -- a fabricated
 * zero would put a trough in the locked-supply trend that reads as a real collapse.
 *
 * One row failing never abandons the rest; the counts come back so a partial run is visible.
 */
export async function backfillLockedCollateral() {
    const snapshots = await getAllSnapshots();
    const result = { total: snapshots.length, filled: 0, skipped: 0, failed: 0 };

    if (snapshots.length === 0) {
        log.info('No snapshots to backfill');
        return result;
    }

    for (const snapshot of snapshots) {
        // A reading already taken is never restated -- see the note above.
        if (snapshot.locked_collateral != null) {
            result.skipped++;
            continue;
        }

        const collateral = calculateLockedCollateral({
            cumulus: snapshot.node_cumulus,
            nimbus: snapshot.node_nimbus,
            stratus: snapshot.node_stratus
        });

        // Returns nulls when any tier count is missing; that row cannot be backfilled.
        if (collateral.locked_collateral == null) {
            result.skipped++;
            continue;
        }

        // A total of zero means every tier count was zero, and on daily_snapshots the
        // node_* columns carry DEFAULT 0 -- so for a row predating node collection, 0
        // means "not collected", not "zero nodes ran". Writing 0 collateral from it would
        // put a fabricated trough at the start of the locked-supply trend. Measured
        // against a real 545-row history, 411 rows were exactly this shape.
        if (collateral.locked_collateral === 0) {
            result.skipped++;
            continue;
        }

        try {
            // NOTE: fillSnapshotNullColumns ignores values <= 0 -- its guard against
            // fabricated zeros. A tier with genuinely zero nodes would therefore keep a
            // NULL per-tier column while the total is written. Cannot arise on mainnet
            // (every tier count is in the thousands) and not worth weakening a guard the
            // other callers rely on.
            const written = await fillSnapshotNullColumns(snapshot.snapshot_date, collateral);
            // Counted from what was WRITTEN, not from the attempt: fillSnapshotNullColumns
            // declines some values silently, and counting attempts once reported "545 of
            // 545 filled" for a run that persisted 134 -- a claim the next run contradicted.
            if (written && written.length > 0) result.filled++;
            else result.skipped++;
        } catch (error) {
            log.warn(
                { err: error, date: snapshot.snapshot_date },
                'Could not backfill collateral for %s', snapshot.snapshot_date
            );
            result.failed++;
        }
    }

    log.info(
        result,
        'Collateral backfill: %d filled, %d skipped, %d failed of %d snapshots',
        result.filled, result.skipped, result.failed, result.total
    );
    return result;
}

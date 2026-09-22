import { getAllSnapshots, getDailyRevenueInRange, updateSnapshotRevenue } from './database.js';
import { createLogger } from '../logger.js';

const log = createLogger('snapshotRevenueRepair');

/**
 * Below this, a difference is float noise rather than a wrong figure.
 *
 * 0.01 was too tight. The first live run reported 357 days as "overstated" -- alarming until
 * you look at them: 1090.41 stored vs 1090.37 computed, 41522.81 vs 41522.75. Differences of
 * four to eight hundredths of a FLUX on totals in the tens of thousands, from summing float
 * amounts in a different order than when the row was written. Nothing was wrong with those
 * days, and the repair correctly left them alone -- it just called them something worrying.
 *
 * A whole FLUX is far below anything this repair exists to catch (its cases are 0 -> 12,515)
 * and far above summation noise.
 */
const EPSILON = 1;

/** How many corrected days to return for eyeballing a dry run. */
const SAMPLE_SIZE = 10;

/**
 * Bring `daily_snapshots.daily_revenue` onto the completed-day figure (issue #248).
 *
 * The live snapshotter used to record revenue for TODAY, minutes after midnight UTC, and
 * never revisit the row -- so it stored what had arrived in those first few minutes.
 * Measured across 836 rows on a live instance, the 315 written that way held 15,375 FLUX
 * between them against an actual 1,313,595. #256 fixed the forward path by finalising the
 * previous day with each snapshot; this repairs what was already written.
 *
 * Three rules, because this rewrites history:
 *
 * 1. **Today is never touched.** Its figure is legitimately partial until tomorrow's
 *    snapshot finalises it, so "correcting" it would just record a different partial.
 *
 * 2. **Values are only ever raised.** Every instance of this bug understates -- verified
 *    across the whole live table, where nothing was overstated. A stored figure that is
 *    HIGHER than the transactions is therefore missing sync data, not a wrong snapshot,
 *    and lowering it to match would destroy the only record of that day. Those rows are
 *    counted and reported, not changed.
 *
 * 3. **An empty transaction table aborts the run.** Otherwise a revenue table that is
 *    broken, or simply not synced yet, would read as "every day earned nothing" and zero
 *    the lot. Same posture as repairGameColumns() refusing on an empty game_snapshots.
 *
 * Idempotent: a second run reports every day as unchanged.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] report what would change without writing
 * @param {string} [options.from] first date to consider (YYYY-MM-DD), default: earliest snapshot
 * @param {string} [options.to] last date to consider, default: yesterday
 */
export async function repairSnapshotRevenue({ dryRun = false, from, to } = {}) {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = shiftUtcDate(today, -1);

    const snapshots = await getAllSnapshots();
    if (!snapshots || snapshots.length === 0) {
        return { skipped: true, reason: 'No snapshots to repair', checked: 0, changed: 0, dryRun };
    }

    const dates = snapshots.map(row => row.snapshot_date).sort();
    const rangeStart = from || dates[0];
    // Never past yesterday, whatever the caller asked for.
    const requestedEnd = to || yesterday;
    const rangeEnd = requestedEnd > yesterday ? yesterday : requestedEnd;

    if (rangeEnd < rangeStart) {
        return { skipped: true, reason: `Empty range (${rangeStart}..${rangeEnd})`, checked: 0, changed: 0, dryRun };
    }

    const truthRows = await getDailyRevenueInRange(rangeStart, rangeEnd);
    if (!truthRows || truthRows.length === 0) {
        log.warn('No revenue transactions in range — refusing to rewrite revenue as zero');
        return {
            skipped: true,
            reason: `No revenue transactions between ${rangeStart} and ${rangeEnd}`,
            checked: 0,
            changed: 0,
            dryRun
        };
    }

    const truthByDate = new Map(truthRows.map(row => [row.date, row.daily_revenue || 0]));

    let checked = 0;
    let changed = 0;
    let unchanged = 0;
    let overstated = 0;
    let recordedBefore = 0;
    let actualTotal = 0;
    const sample = [];

    for (const row of snapshots) {
        const date = row.snapshot_date;
        if (date < rangeStart || date > rangeEnd) continue;

        checked++;
        const stored = row.daily_revenue || 0;
        const actual = truthByDate.get(date) || 0;
        recordedBefore += stored;
        actualTotal += actual;

        if (actual > stored + EPSILON) {
            if (sample.length < SAMPLE_SIZE) sample.push({ date, from: stored, to: actual });
            if (!dryRun) await updateSnapshotRevenue(date, actual);
            changed++;
        } else if (stored > actual + EPSILON) {
            // Rule 2: reported, never lowered.
            overstated++;
        } else {
            unchanged++;
        }
    }

    log.info(
        { dryRun, checked, changed, unchanged, overstated, from: rangeStart, to: rangeEnd },
        'Snapshot revenue repair %s: %d of %d day(s) %s',
        dryRun ? 'dry run' : 'complete',
        changed,
        checked,
        dryRun ? 'would change' : 'corrected'
    );

    return {
        dryRun,
        from: rangeStart,
        to: rangeEnd,
        checked,
        changed,
        unchanged,
        overstated,
        recordedBefore,
        actualTotal,
        sample
    };
}

/** Shift a YYYY-MM-DD string by n days in UTC -- local time drifts across a DST change. */
function shiftUtcDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

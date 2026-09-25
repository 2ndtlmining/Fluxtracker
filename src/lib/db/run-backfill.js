// Revenue-only snapshot backfill, behind POST /api/admin/backfill.
//
// This file used to carry its own takeManualSnapshot(), a comparison helper and a CLI mode
// (issue #317). That snapshot zero-filled ~30 columns, used today's PARTIAL revenue (#248
// finalises the previous completed day instead) and missed every newer metric column --
// and a row written by it pre-empted that day's real snapshot, with zeros that
// fillSnapshotNullColumns() cannot repair. snapshotManager.takeManualSnapshot() is the one
// manual snapshot (POST /api/admin/snapshot).

import { getRevenueForDateRange, createDailySnapshot, getSnapshotByDate } from './database.js';

/**
 * Every UTC date from `fromDate` to `toDate` inclusive, as YYYY-MM-DD.
 *
 * UTC arithmetic on purpose (issue #218). The previous loop advanced a Date parsed as UTC
 * midnight with local-time setDate(), so on a host in a DST-observing zone a spring-forward
 * day was emitted twice and the last day of the range never reached at all.
 */
export function eachUtcDate(fromDate, toDate) {
    const dates = [];
    const end = Date.parse(`${toDate}T00:00:00Z`);
    for (let t = Date.parse(`${fromDate}T00:00:00Z`); t <= end; t += 86400000) {
        dates.push(new Date(t).toISOString().split('T')[0]);
    }
    return dates;
}

/**
 * Backfill one daily_snapshots row per day from transaction history.
 *
 * Writes the revenue and NOTHING else (issue #218). Every other column is left unset so
 * the adapter stores NULL, which is what the rest of the repo means by "no reading": the
 * KPI layer treats a 0 as a failed collection, the analytics comparison would render a
 * fabricated 0 as real history ("+6448 nodes, 0% change"), and fillSnapshotNullColumns()
 * repairs NULL columns only -- it skips anything already set, so a fabricated 0 can never
 * be healed. `sync_status: 'backfilled'` keeps these days distinguishable from a real
 * nightly collection.
 */
export async function backfillRevenueSnapshots(fromDate, toDate) {
    console.log(`
📊 Backfilling revenue snapshots from ${fromDate} to ${toDate}`);

    let created = 0;
    let skipped = 0;

    for (const dateStr of eachUtcDate(fromDate, toDate)) {
        // Check if snapshot already exists
        const existing = await getSnapshotByDate(dateStr);
        if (existing) {
            skipped++;
            continue;
        }

        const dailyRevenue = await getRevenueForDateRange(dateStr, dateStr);

        await createDailySnapshot({
            snapshot_date: dateStr,
            timestamp: Date.parse(`${dateStr}T00:00:00Z`),
            daily_revenue: dailyRevenue,
            sync_status: 'backfilled'
        });
        created++;
    }

    return { created, skipped };
}

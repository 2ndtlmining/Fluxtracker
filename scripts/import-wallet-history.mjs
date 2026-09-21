#!/usr/bin/env node
/**
 * One-off import of unique-wallet history (issue #201).
 *
 * Fluxtracker started counting unique wallets on 2026-09-21. Fluxutilmon
 * (https://github.com/2ndtlmining/Fluxutilmon) has been recording the same figure from the
 * same endpoint since 2024-06-17, so importing its snapshots gives the chart 2.25 years of
 * history on day one instead of a line that starts flat.
 *
 * The two sources agree where they overlap: Fluxutilmon read 824 wallets on 2026-09-20 and a
 * live API call on 2026-09-21 returned 830.
 *
 * WHAT IT WILL NOT DO
 *
 *   - Touch any column other than unique_wallets. Most of these 789 days already hold real
 *     revenue and node history; the write is a targeted UPDATE, never a snapshot upsert.
 *   - Invent readings. The export covers 789 of the 826 days in its span; the 37 it misses
 *     (almost all in one gap, 2025-05-09 -> 2025-06-14) stay NULL. Interpolating would draw a
 *     smooth line through five weeks nobody measured.
 *   - Import a zero. The 9 earliest files predate the field, and a 0 would be
 *     indistinguishable from a real reading once stored.
 *
 * Usage:
 *   node scripts/import-wallet-history.mjs --dry-run              # report only, writes nothing
 *   node scripts/import-wallet-history.mjs utildata_20_sept       # do it
 *
 * Re-runnable: each day is an UPDATE keyed on the date, so a second run is a no-op.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = 'utildata_20_sept';

/**
 * Read a folder of Fluxutilmon snapshots into one reading per day.
 *
 * 415 of the 789 days carry between 2 and 4 snapshots. The LAST of the day wins: a daily
 * snapshot represents end-of-day state, and that is also what Fluxtracker's own nightly job
 * records. It barely matters in practice -- the worst intra-day spread in the whole export is
 * 88 wallets on 2024-12-24, about 3% of that day's ~2,900 -- but it has to be decided once
 * rather than left to directory order.
 *
 * Exported for the tests; the CLI path below is the only other caller.
 */
export function readWalletHistory(dir) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

    /** @type {Map<string, number>} date -> wallet count */
    const readings = new Map();
    /** @type {Map<string, string>} date -> the timestamp that reading came from */
    const chosenStamp = new Map();
    const skipped = { unparseable: 0, noWalletField: 0, invalidCount: 0 };

    for (const file of files) {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch {
            skipped.unparseable++;
            continue;
        }

        // `Snapshot` is "YYYY-MM-DD_HH-MM-SS"; fall back to the filename if it is absent.
        const stamp = parsed.Snapshot || file.replace(/^utilization_|\.json$/g, '');
        const date = stamp.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            skipped.unparseable++;
            continue;
        }

        const count = parsed.unique_wallet_count;
        if (count == null) {
            skipped.noWalletField++;
            continue;
        }
        if (!Number.isInteger(count) || count <= 0) {
            skipped.invalidCount++;
            continue;
        }

        // Last stamp of the day wins.
        const previous = chosenStamp.get(date);
        if (previous === undefined || stamp > previous) {
            chosenStamp.set(date, stamp);
            readings.set(date, count);
        }
    }

    return { readings, skipped, filesSeen: files.length };
}

/** Days present in the span but absent from the export, so the gaps are stated, not implied. */
function findGaps(dates) {
    const gaps = [];
    for (let i = 1; i < dates.length; i++) {
        const previous = new Date(dates[i - 1]);
        const current = new Date(dates[i]);
        const missing = Math.round((current - previous) / 86400000) - 1;
        if (missing > 0) gaps.push({ after: dates[i - 1], before: dates[i], missing });
    }
    return gaps;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const dir = args.find(a => !a.startsWith('--')) || DEFAULT_DIR;

    if (!fs.existsSync(dir)) {
        console.error(`No such directory: ${dir}`);
        console.error(`Pass the export folder as an argument, or place it at ./${DEFAULT_DIR}`);
        process.exit(1);
    }

    console.log(`Reading ${dir}${dryRun ? '  (DRY RUN — nothing will be written)' : ''}\n`);

    const { readings, skipped, filesSeen } = readWalletHistory(dir);
    const dates = [...readings.keys()].sort();

    if (dates.length === 0) {
        console.error('No usable readings found — refusing to continue.');
        process.exit(1);
    }

    const first = dates[0];
    const last = dates[dates.length - 1];
    const spanDays = Math.round((new Date(last) - new Date(first)) / 86400000) + 1;
    const gaps = findGaps(dates);

    console.log(`  files read        ${filesSeen}`);
    console.log(`  usable readings   ${dates.length} days`);
    console.log(`  range             ${first} -> ${last}  (${spanDays} calendar days, ${(dates.length / spanDays * 100).toFixed(1)}% covered)`);
    console.log(`  first / last      ${readings.get(first)} -> ${readings.get(last)} wallets`);
    console.log(`  skipped           ${skipped.unparseable} unparseable, ${skipped.noWalletField} without the field, ${skipped.invalidCount} non-positive`);
    console.log(`  gaps              ${gaps.length} (${spanDays - dates.length} days), left as NULL — never interpolated`);
    for (const gap of gaps.slice(0, 5)) {
        console.log(`                    ${gap.after} -> ${gap.before}  (${gap.missing} day${gap.missing === 1 ? '' : 's'})`);
    }
    console.log();

    // Imported lazily and only when writing, so --dry-run needs no database at all.
    const { initDatabase, setSnapshotWalletCount, getSnapshotByDate } = await import('../src/lib/db/database.js');

    if (dryRun) {
        console.log('Dry run: checking which days already have a snapshot row...');
        let exists = 0;
        let alreadySet = 0;
        try {
            await initDatabase();
            for (const date of dates) {
                const row = await getSnapshotByDate(date);
                if (row) {
                    exists++;
                    if (row.unique_wallets != null) alreadySet++;
                }
            }
            console.log(`  ${exists} of ${dates.length} days already have a snapshot row (would be UPDATEs)`);
            console.log(`  ${dates.length - exists} days have none (would be created, sync_status='backfilled')`);
            console.log(`  ${alreadySet} already carry a unique_wallets value (would be overwritten with the same source)`);
        } catch (error) {
            console.log(`  Could not reach the database (${error.message}).`);
            console.log('  The file-side report above is still valid.');
        }
        console.log('\nNothing written. Re-run without --dry-run to import.');
        return;
    }

    await initDatabase();

    let updated = 0;
    let created = 0;
    const failures = [];

    for (const date of dates) {
        try {
            const outcome = await setSnapshotWalletCount(date, readings.get(date));
            if (outcome === 'created') created++; else updated++;
        } catch (error) {
            // One bad day must not abandon the other 788.
            failures.push({ date, error: error.message });
        }
        const done = updated + created + failures.length;
        if (done % 100 === 0) console.log(`  ${done}/${dates.length}...`);
    }

    console.log(`\nImported ${updated + created} of ${dates.length} days`);
    console.log(`  ${updated} existing snapshots updated`);
    console.log(`  ${created} rows created (sync_status='backfilled')`);

    if (failures.length > 0) {
        console.log(`  ${failures.length} failed:`);
        for (const failure of failures.slice(0, 10)) console.log(`    ${failure.date}: ${failure.error}`);
        process.exitCode = 1;
    }
}

// Only run the CLI when invoked directly, so importing this module in tests is side-effect free.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1]).replace(/\\/g, '/')}`;
if (invokedDirectly || process.argv[1]?.endsWith('import-wallet-history.mjs')) {
    main().catch(error => {
        console.error('Import failed:', error);
        process.exit(1);
    });
}

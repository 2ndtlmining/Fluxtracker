/**
 * Backfill amount_usd using CoinMarketCap historical FLUX price CSV.
 *
 * Usage:
 *   node scripts/apply-prices-from-csv.mjs <path-to-csv>
 *
 * Example:
 *   node scripts/apply-prices-from-csv.mjs "../../../Fluxnode_claude/Fluxnode/FLUX_All_graph_coinmarketcap.csv"
 *
 * The CSV is weekly data so each transaction date is matched to the
 * nearest available weekly price (max ~3-4 days off).
 *
 * Safe to re-run — only updates rows where amount_usd IS NULL.
 * DELETE THIS SCRIPT once the backfill is complete.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/flux-performance.db');

// ── CSV path from argument or sensible default ──────────────────────────────
const csvArg = process.argv[2];
if (!csvArg) {
    console.error('Usage: node scripts/apply-prices-from-csv.mjs <path-to-csv>');
    process.exit(1);
}
const CSV_PATH = path.resolve(csvArg);

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const prices = [];

    for (let i = 1; i < lines.length; i++) {          // skip header
        const line = lines[i].trim();
        if (!line) continue;

        // Format: "2024-05-13 10:00:00";0.1234;567890
        const parts = line.split(';');
        if (parts.length < 2) continue;

        // Strip surrounding quotes from timestamp, take date portion only
        const rawTs = parts[0].replace(/"/g, '').trim();
        const date = rawTs.substring(0, 10);           // YYYY-MM-DD
        const price = parseFloat(parts[1]);

        if (date && !isNaN(price) && price > 0) {
            prices.push({ date, price, ts: new Date(date).getTime() });
        }
    }

    return prices.sort((a, b) => a.ts - b.ts);        // ensure ascending order
}

function findNearestPrice(targetDate, sortedPrices) {
    const targetTs = new Date(targetDate).getTime();
    let best = sortedPrices[0];
    let bestDiff = Math.abs(targetTs - best.ts);

    for (const entry of sortedPrices) {
        const diff = Math.abs(targetTs - entry.ts);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = entry;
        }
        // Once entries are further away (ascending order), we can break early
        if (entry.ts > targetTs && diff > bestDiff) break;
    }

    const daysDiff = Math.round(bestDiff / (1000 * 60 * 60 * 24));
    return { price: best.price, nearestDate: best.date, daysDiff };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    // Validate inputs
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`CSV not found: ${CSV_PATH}`);
        process.exit(1);
    }
    if (!fs.existsSync(DB_PATH)) {
        console.error(`DB not found: ${DB_PATH}`);
        process.exit(1);
    }

    // Parse CSV
    console.log(`Reading CSV: ${CSV_PATH}`);
    const prices = parseCSV(CSV_PATH);
    console.log(`Loaded ${prices.length} weekly price entries`);
    console.log(`CSV range: ${prices[0].date} → ${prices[prices.length - 1].date}\n`);

    // Open DB
    const db = new Database(DB_PATH);

    // Get distinct dates with NULL amount_usd
    const dates = db.prepare(`
        SELECT DISTINCT date, COUNT(*) as tx_count
        FROM revenue_transactions
        WHERE amount_usd IS NULL
        GROUP BY date
        ORDER BY date ASC
    `).all();

    console.log(`Dates with NULL amount_usd: ${dates.length}`);

    if (dates.length === 0) {
        console.log('Nothing to update — all transactions already have USD values.');
        db.close();
        return;
    }

    // Preview: show first/last 3 matches and max day offset
    console.log('\nSample price matches:');
    const preview = dates.length <= 6 ? dates : [...dates.slice(0, 3), ...dates.slice(-3)];
    for (const { date } of preview) {
        const { price, nearestDate, daysDiff } = findNearestPrice(date, prices);
        console.log(`  ${date} → $${price.toFixed(4)} (from ${nearestDate}, ${daysDiff}d offset, ${dates.find(d => d.date === date).tx_count} txs)`);
    }
    if (dates.length > 6) console.log(`  ... and ${dates.length - 6} more dates`);

    const maxOffset = Math.max(...dates.map(({ date }) => findNearestPrice(date, prices).daysDiff));
    console.log(`\nMax price offset across all dates: ${maxOffset} day(s)`);

    // Apply updates in a single transaction
    console.log('\nApplying updates...');
    const stmt = db.prepare(`
        UPDATE revenue_transactions
        SET amount_usd = amount * ?
        WHERE date = ? AND amount_usd IS NULL
    `);

    let totalRows = 0;
    let datesUpdated = 0;

    const applyAll = db.transaction(() => {
        for (const { date, tx_count } of dates) {
            const { price, nearestDate, daysDiff } = findNearestPrice(date, prices);
            const result = stmt.run(price, date);
            if (result.changes > 0) {
                const offsetNote = daysDiff > 0 ? ` (price from ${nearestDate}, ${daysDiff}d offset)` : '';
                console.log(`  ${date}: $${price.toFixed(4)}${offsetNote} → ${result.changes} row(s) updated`);
                totalRows += result.changes;
                datesUpdated++;
            }
        }
    });

    applyAll();
    db.close();

    console.log(`\nDone. ${totalRows} rows updated across ${datesUpdated} dates.`);
    console.log('You can now delete this script and the CSV is no longer needed.');
}

main();

/**
 * One-time fix: null out amount_usd for historical transactions.
 *
 * Transactions older than 24 hours should not have a USD value because
 * the sync uses the current FLUX price, not the historical price.
 *
 * Run once:
 *   node fix_historical_usd.js
 *
 * Safe to re-run — idempotent.
 * Does NOT delete any transactions or affect snapshots/metrics.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'flux-performance.db');

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);

// Count how many historical transactions currently have a USD value
const before = db.prepare(`
    SELECT COUNT(*) as count
    FROM revenue_transactions
    WHERE amount_usd IS NOT NULL
    AND timestamp < (strftime('%s', 'now') - 86400)
`).get();

console.log(`Found ${before.count} historical transactions with incorrect USD values`);

if (before.count === 0) {
    console.log('Nothing to fix.');
    db.close();
    process.exit(0);
}

// Null out amount_usd for anything older than 24 hours
const result = db.prepare(`
    UPDATE revenue_transactions
    SET amount_usd = NULL
    WHERE timestamp < (strftime('%s', 'now') - 86400)
`).run();

console.log(`Fixed ${result.changes} transactions — amount_usd set to NULL for historical records`);

// Verify
const after = db.prepare(`
    SELECT COUNT(*) as count
    FROM revenue_transactions
    WHERE amount_usd IS NOT NULL
`).get();
console.log(`Transactions with USD value remaining (should be today's only): ${after.count}`);

db.close();
console.log('\nDone. Historical USD values are now NULL. Future syncs will correctly populate USD for recent transactions only.');

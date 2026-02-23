/**
 * One-time migration: add app_name column and clear revenue_transactions for resync.
 *
 * Run BEFORE deploying the new code:
 *   node migration_add_app_name.js
 *
 * Safe to run multiple times (idempotent column add).
 * NOTE: This CLEARS all revenue transactions and resets the sync block so the
 *       new sync will reimport everything with app_name populated.
 *       Snapshots and current_metrics are NOT touched.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'flux-performance.db');

console.log(`Opening database: ${dbPath}`);
const db = new Database(dbPath);

// Step 1: Add app_name column (idempotent check first)
try {
    const columns = db.pragma('table_info(revenue_transactions)');
    const hasAppName = columns.some(col => col.name === 'app_name');

    if (!hasAppName) {
        db.prepare('ALTER TABLE revenue_transactions ADD COLUMN app_name TEXT DEFAULT NULL').run();
        console.log('Added app_name column to revenue_transactions');
    } else {
        console.log('app_name column already exists - skipping ALTER TABLE');
    }
} catch (e) {
    console.error('Failed to add app_name column:', e.message);
    process.exit(1);
}

// Step 2: Clear revenue_transactions for full resync with app_name populated
const countBefore = db.prepare('SELECT COUNT(*) as c FROM revenue_transactions').get().c;
db.prepare('DELETE FROM revenue_transactions').run();
console.log(`Cleared ${countBefore} revenue transactions (will be reimported with app_name)`);

// Step 3: Reset revenue sync block so next sync starts from INITIAL_SYNC_LOOKBACK_BLOCKS
db.prepare("UPDATE sync_status SET last_sync_block = NULL WHERE sync_type = 'revenue'").run();
console.log("Reset revenue sync_status last_sync_block to NULL");

db.close();
console.log('\nMigration complete. Start the server to trigger a full resync.');

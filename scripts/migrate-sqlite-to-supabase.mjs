/**
 * SQLite → Supabase Data Migration Script
 *
 * Reads all data from the local SQLite DB and upserts it into Supabase.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-supabase.mjs
 *
 * Requires:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local or environment
 *   - SQLite DB file at data/flux-performance.db
 */

import 'dotenv/config';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const dbPath = path.join(process.cwd(), 'data', 'flux-performance.db');
if (!fs.existsSync(dbPath)) {
    console.error(`SQLite database not found at ${dbPath}`);
    process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
console.log(`📂 Opened SQLite DB: ${dbPath}`);

const CHUNK_SIZE = 500;

async function migrateTable(tableName, conflictColumn, transform = null) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 Migrating: ${tableName}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
    console.log(`   Rows in SQLite: ${rows.length}`);

    if (rows.length === 0) {
        console.log('   Skipping (no data)');
        return;
    }

    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const data = transform ? chunk.map(transform) : chunk;

        // Remove SQLite auto-increment id columns (Supabase uses BIGSERIAL)
        const cleanData = data.map(row => {
            const { id, ...rest } = row;
            return rest;
        });

        const { error } = await supabase
            .from(tableName)
            .upsert(cleanData, {
                onConflict: conflictColumn,
                ignoreDuplicates: true
            });

        if (error) {
            console.error(`   Chunk error (offset ${i}):`, error.message);
            errors++;
        } else {
            inserted += chunk.length;
        }

        // Progress logging for large tables
        if (rows.length > CHUNK_SIZE && (i + CHUNK_SIZE) % 5000 === 0) {
            console.log(`   Progress: ${Math.min(i + CHUNK_SIZE, rows.length)}/${rows.length}`);
        }
    }

    console.log(`   ✅ Migrated: ${inserted} rows (${errors} chunk errors)`);
}

async function migrateSyncStatus() {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 Migrating: sync_status`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const rows = db.prepare('SELECT * FROM sync_status').all();
    console.log(`   Rows in SQLite: ${rows.length}`);

    for (const row of rows) {
        const { id, ...data } = row;
        const { error } = await supabase
            .from('sync_status')
            .upsert(data, { onConflict: 'sync_type' });

        if (error) {
            console.error(`   Error for ${row.sync_type}:`, error.message);
        }
    }
    console.log('   ✅ Sync status migrated');
}

async function migrateCurrentMetrics() {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 Migrating: current_metrics`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const row = db.prepare('SELECT * FROM current_metrics WHERE id = 1').get();
    if (!row) {
        console.log('   No current_metrics row found');
        return;
    }

    const { error } = await supabase
        .from('current_metrics')
        .upsert(row, { onConflict: 'id' });

    if (error) {
        console.error('   Error:', error.message);
    } else {
        console.log('   ✅ Current metrics migrated');
    }
}

async function main() {
    console.log('\n🚀 SQLite → Supabase Migration');
    console.log(`   Source: ${dbPath}`);
    console.log(`   Target: ${SUPABASE_URL}`);
    console.log(`   Chunk size: ${CHUNK_SIZE}`);

    const startTime = Date.now();

    // 1. sync_status (7 rows)
    await migrateSyncStatus();

    // 2. current_metrics (1 row)
    await migrateCurrentMetrics();

    // 3. flux_price_history (~2000 rows)
    await migrateTable('flux_price_history', 'date');

    // 4. daily_snapshots (~365-730 rows)
    await migrateTable('daily_snapshots', 'snapshot_date');

    // 5. failed_txids (small table)
    await migrateTable('failed_txids', 'txid');

    // 6. revenue_transactions (100k+ rows — chunked)
    await migrateTable('revenue_transactions', 'txid');

    // 7. repo_snapshots (thousands of rows — chunked)
    await migrateTable('repo_snapshots', 'snapshot_date,image_name');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🎉 Migration complete in ${elapsed}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Verify row counts
    console.log('📊 Verification:');
    const tables = ['sync_status', 'current_metrics', 'flux_price_history', 'daily_snapshots', 'failed_txids', 'revenue_transactions', 'repo_snapshots'];
    for (const table of tables) {
        const sqliteCount = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count;
        const { count: supabaseCount } = await supabase.from(table).select('*', { count: 'exact', head: true });
        const match = sqliteCount === supabaseCount ? '✅' : '⚠️';
        console.log(`   ${match} ${table}: SQLite=${sqliteCount}, Supabase=${supabaseCount}`);
    }

    db.close();
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

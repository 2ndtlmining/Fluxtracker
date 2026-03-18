// SQLite adapter — drop-in replacement for supabaseAdapter.js
// Uses better-sqlite3 for all DB operations.
// All functions are async for interface compatibility with the Supabase adapter.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { categorizeImage } from '../../config.js';

// ============================================
// DATABASE CONNECTION
// ============================================

const DB_PATH = process.env.DB_PATH || 'data/fluxtracker.sqlite3';

// Ensure directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
    }
    return db;
}

// ============================================
// SCHEMA CREATION
// ============================================

function createSchema() {
    const d = getDb();

    d.exec(`
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL UNIQUE,
            timestamp INTEGER NOT NULL,
            daily_revenue REAL NOT NULL DEFAULT 0,
            flux_price_usd REAL,
            total_cpu_cores INTEGER DEFAULT 0,
            used_cpu_cores INTEGER DEFAULT 0,
            cpu_utilization_percent REAL DEFAULT 0,
            total_ram_gb REAL DEFAULT 0,
            used_ram_gb REAL DEFAULT 0,
            ram_utilization_percent REAL DEFAULT 0,
            total_storage_gb REAL DEFAULT 0,
            used_storage_gb REAL DEFAULT 0,
            storage_utilization_percent REAL DEFAULT 0,
            total_apps INTEGER DEFAULT 0,
            watchtower_count INTEGER DEFAULT 0,
            gitapps_count INTEGER DEFAULT 0,
            dockerapps_count INTEGER DEFAULT 0,
            gitapps_percent REAL DEFAULT 0,
            dockerapps_percent REAL DEFAULT 0,
            gaming_apps_total INTEGER DEFAULT 0,
            gaming_palworld INTEGER DEFAULT 0,
            gaming_enshrouded INTEGER DEFAULT 0,
            gaming_minecraft INTEGER DEFAULT 0,
            gaming_valheim INTEGER DEFAULT 0,
            gaming_satisfactory INTEGER DEFAULT 0,
            crypto_presearch INTEGER DEFAULT 0,
            crypto_streamr INTEGER DEFAULT 0,
            crypto_ravencoin INTEGER DEFAULT 0,
            crypto_kadena INTEGER DEFAULT 0,
            crypto_alephium INTEGER DEFAULT 0,
            crypto_bittensor INTEGER DEFAULT 0,
            crypto_timpi_collector INTEGER DEFAULT 0,
            crypto_timpi_geocore INTEGER DEFAULT 0,
            crypto_kaspa INTEGER DEFAULT 0,
            crypto_nodes_total INTEGER DEFAULT 0,
            wordpress_count INTEGER DEFAULT 0,
            node_cumulus INTEGER DEFAULT 0,
            node_nimbus INTEGER DEFAULT 0,
            node_stratus INTEGER DEFAULT 0,
            node_total INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'completed',
            created_at INTEGER NOT NULL
        )
    `);

    d.exec(`CREATE INDEX IF NOT EXISTS idx_snapshot_date ON daily_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_ds_timestamp ON daily_snapshots(timestamp)`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS revenue_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            from_address TEXT DEFAULT 'Unknown',
            amount REAL NOT NULL,
            amount_usd REAL,
            block_height INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            date TEXT NOT NULL,
            app_name TEXT DEFAULT NULL,
            app_type TEXT DEFAULT NULL
        )
    `);

    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_address ON revenue_transactions(address)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_from_address ON revenue_transactions(from_address)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_block_height ON revenue_transactions(block_height)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_date ON revenue_transactions(date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_timestamp ON revenue_transactions(timestamp)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_usd_null ON revenue_transactions(txid) WHERE amount_usd IS NULL`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS failed_txids (
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            failure_reason TEXT NOT NULL DEFAULT 'fetch_failed',
            attempt_count INTEGER NOT NULL DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_attempt INTEGER NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0
        )
    `);

    d.exec(`CREATE INDEX IF NOT EXISTS idx_failed_txids_resolved ON failed_txids(resolved)`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS current_metrics (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_update INTEGER NOT NULL,
            current_revenue REAL DEFAULT 0,
            flux_price_usd REAL,
            total_cpu_cores INTEGER DEFAULT 0,
            used_cpu_cores INTEGER DEFAULT 0,
            cpu_utilization_percent REAL DEFAULT 0,
            total_ram_gb REAL DEFAULT 0,
            used_ram_gb REAL DEFAULT 0,
            ram_utilization_percent REAL DEFAULT 0,
            total_storage_gb REAL DEFAULT 0,
            used_storage_gb REAL DEFAULT 0,
            storage_utilization_percent REAL DEFAULT 0,
            total_apps INTEGER DEFAULT 0,
            watchtower_count INTEGER DEFAULT 0,
            gitapps_count INTEGER DEFAULT 0,
            dockerapps_count INTEGER DEFAULT 0,
            gitapps_percent REAL DEFAULT 0,
            dockerapps_percent REAL DEFAULT 0,
            gaming_apps_total INTEGER DEFAULT 0,
            gaming_palworld INTEGER DEFAULT 0,
            gaming_enshrouded INTEGER DEFAULT 0,
            gaming_minecraft INTEGER DEFAULT 0,
            gaming_valheim INTEGER DEFAULT 0,
            gaming_satisfactory INTEGER DEFAULT 0,
            crypto_presearch INTEGER DEFAULT 0,
            crypto_streamr INTEGER DEFAULT 0,
            crypto_ravencoin INTEGER DEFAULT 0,
            crypto_kadena INTEGER DEFAULT 0,
            crypto_alephium INTEGER DEFAULT 0,
            crypto_bittensor INTEGER DEFAULT 0,
            crypto_timpi_collector INTEGER DEFAULT 0,
            crypto_timpi_geocore INTEGER DEFAULT 0,
            crypto_kaspa INTEGER DEFAULT 0,
            crypto_nodes_total INTEGER DEFAULT 0,
            wordpress_count INTEGER DEFAULT 0,
            node_cumulus INTEGER DEFAULT 0,
            node_nimbus INTEGER DEFAULT 0,
            node_stratus INTEGER DEFAULT 0,
            node_total INTEGER DEFAULT 0
        )
    `);

    // Seed singleton row
    d.exec(`INSERT OR IGNORE INTO current_metrics (id, last_update) VALUES (1, 0)`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS flux_price_history (
            date TEXT NOT NULL PRIMARY KEY,
            price_usd REAL NOT NULL,
            source TEXT DEFAULT 'cryptocompare',
            created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
        )
    `);

    d.exec(`
        CREATE TABLE IF NOT EXISTS sync_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT NOT NULL UNIQUE,
            last_sync INTEGER NOT NULL,
            last_sync_block INTEGER,
            next_sync INTEGER,
            status TEXT DEFAULT 'pending',
            error_message TEXT
        )
    `);

    d.exec(`CREATE INDEX IF NOT EXISTS idx_sync_type ON sync_status(sync_type)`);

    // Seed sync status rows
    const seedSync = d.prepare(`INSERT OR IGNORE INTO sync_status (sync_type, last_sync, status) VALUES (?, 0, 'pending')`);
    const seedAll = d.transaction(() => {
        for (const t of ['revenue', 'cloud', 'gaming', 'wordpress', 'nodes', 'crypto', 'daily_snapshot']) {
            seedSync.run(t);
        }
    });
    seedAll();

    d.exec(`
        CREATE TABLE IF NOT EXISTS repo_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            image_name TEXT NOT NULL,
            instance_count INTEGER NOT NULL DEFAULT 0,
            category TEXT DEFAULT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, image_name)
        )
    `);

    d.exec(`CREATE INDEX IF NOT EXISTS idx_repo_snapshot_date ON repo_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_repo_image_name ON repo_snapshots(image_name)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_repo_composite ON repo_snapshots(image_name, snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_repo_category ON repo_snapshots(category)`);
}

// ============================================
// INITIALIZATION
// ============================================

let _dbReady = false;

export function isDbReady() {
    return _dbReady;
}

export async function probeDb() {
    try {
        const d = getDb();
        d.prepare('SELECT id FROM current_metrics WHERE id = 1').get();
        _dbReady = true;
        return true;
    } catch {
        _dbReady = false;
        return false;
    }
}

export async function initDatabase() {
    try {
        createSchema();

        // Run schema migration (adds dynamic columns if needed)
        try {
            console.log('\n🔄 Checking for schema updates...');
            const config = await import('../../config.js');
            const { migrateSchema } = await import('../schemaMigrator.js');
            const migrationResult = await migrateSchema(config, getDb());
            if (migrationResult.success) {
                if (migrationResult.columnsAdded.length > 0) {
                    console.log('✅ Schema updated with new columns');
                } else {
                    console.log('✓ Schema is up to date');
                }
            } else {
                console.warn('⚠️  Schema migration had issues:', migrationResult.errors);
            }
        } catch (migrationError) {
            console.warn('⚠️  Schema migration error:', migrationError.message);
        }

        // Backfill repo categories for existing rows
        try {
            const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM repo_snapshots WHERE category IS NULL').get();
            if (row.cnt > 0) {
                console.log(`🔄 Backfilling categories for ${row.cnt} uncategorized images...`);
                setTimeout(async () => {
                    try { await backfillRepoCategories(); } catch(e) { console.warn('Backfill error:', e.message); }
                }, 100);
            }
        } catch (e) {
            console.warn('Category backfill check skipped:', e.message);
        }

        _dbReady = true;
        console.log(`✅ Database initialized successfully (SQLite: ${DB_PATH})`);
    } catch (error) {
        _dbReady = false;
        console.error('❌ Database initialization error:', error);
        throw error;
    }
}

export async function ensureInitialized() {
    const MAX_ATTEMPTS = 10;
    let delay = 2000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await initDatabase();
            return true;
        } catch (error) {
            console.warn(`⚠️  DB init attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
            if (attempt < MAX_ATTEMPTS) {
                console.log(`   Retrying in ${Math.round(delay / 1000)}s...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 60_000);
            }
        }
    }

    console.error('❌ Database initialization failed after all retry attempts');
    return false;
}

// ============================================
// CURRENT METRICS OPERATIONS
// ============================================

export async function getCurrentMetrics() {
    try {
        return getDb().prepare('SELECT * FROM current_metrics WHERE id = 1').get() || null;
    } catch (error) {
        console.error('getCurrentMetrics error:', error.message);
        return null;
    }
}

export async function updateCurrentMetrics(metrics) {
    const current = await getCurrentMetrics();
    if (!current) return;

    const merged = { last_update: Date.now() };
    const metricKeys = [
        'current_revenue', 'flux_price_usd',
        'total_cpu_cores', 'used_cpu_cores', 'cpu_utilization_percent',
        'total_ram_gb', 'used_ram_gb', 'ram_utilization_percent',
        'total_storage_gb', 'used_storage_gb', 'storage_utilization_percent',
        'total_apps', 'watchtower_count',
        'gitapps_count', 'dockerapps_count', 'gitapps_percent', 'dockerapps_percent',
        'gaming_apps_total', 'gaming_palworld', 'gaming_enshrouded', 'gaming_minecraft',
        'gaming_valheim', 'gaming_satisfactory',
        'crypto_presearch', 'crypto_streamr', 'crypto_ravencoin', 'crypto_kadena',
        'crypto_alephium', 'crypto_bittensor', 'crypto_timpi_collector', 'crypto_timpi_geocore',
        'crypto_kaspa', 'crypto_nodes_total',
        'wordpress_count',
        'node_cumulus', 'node_nimbus', 'node_stratus', 'node_total'
    ];

    for (const key of metricKeys) {
        merged[key] = metrics[key] ?? current[key] ?? null;
    }

    const setClauses = Object.keys(merged).map(k => `${k} = @${k}`).join(', ');
    try {
        getDb().prepare(`UPDATE current_metrics SET ${setClauses} WHERE id = 1`).run(merged);
        console.log('✅ Current metrics updated');
    } catch (error) {
        console.error('updateCurrentMetrics error:', error.message);
    }
}

// ============================================
// DAILY SNAPSHOTS OPERATIONS
// ============================================

export async function createDailySnapshot(snapshot) {
    const row = {
        snapshot_date: snapshot.snapshot_date,
        timestamp: snapshot.timestamp,
        daily_revenue: snapshot.daily_revenue,
        flux_price_usd: snapshot.flux_price_usd ?? null,
        total_cpu_cores: snapshot.total_cpu_cores ?? null,
        used_cpu_cores: snapshot.used_cpu_cores ?? null,
        cpu_utilization_percent: snapshot.cpu_utilization_percent ?? null,
        total_ram_gb: snapshot.total_ram_gb ?? null,
        used_ram_gb: snapshot.used_ram_gb ?? null,
        ram_utilization_percent: snapshot.ram_utilization_percent ?? null,
        total_storage_gb: snapshot.total_storage_gb ?? null,
        used_storage_gb: snapshot.used_storage_gb ?? null,
        storage_utilization_percent: snapshot.storage_utilization_percent ?? null,
        total_apps: snapshot.total_apps ?? null,
        watchtower_count: snapshot.watchtower_count ?? null,
        gitapps_count: snapshot.gitapps_count ?? null,
        dockerapps_count: snapshot.dockerapps_count ?? null,
        gitapps_percent: snapshot.gitapps_percent ?? null,
        dockerapps_percent: snapshot.dockerapps_percent ?? null,
        gaming_apps_total: snapshot.gaming_apps_total ?? null,
        gaming_palworld: snapshot.gaming_palworld ?? null,
        gaming_enshrouded: snapshot.gaming_enshrouded ?? null,
        gaming_minecraft: snapshot.gaming_minecraft ?? null,
        gaming_valheim: snapshot.gaming_valheim ?? null,
        gaming_satisfactory: snapshot.gaming_satisfactory ?? null,
        crypto_presearch: snapshot.crypto_presearch ?? null,
        crypto_streamr: snapshot.crypto_streamr ?? null,
        crypto_ravencoin: snapshot.crypto_ravencoin ?? null,
        crypto_kadena: snapshot.crypto_kadena ?? null,
        crypto_alephium: snapshot.crypto_alephium ?? null,
        crypto_bittensor: snapshot.crypto_bittensor ?? null,
        crypto_timpi_collector: snapshot.crypto_timpi_collector ?? null,
        crypto_timpi_geocore: snapshot.crypto_timpi_geocore ?? null,
        crypto_kaspa: snapshot.crypto_kaspa ?? null,
        crypto_nodes_total: snapshot.crypto_nodes_total ?? null,
        wordpress_count: snapshot.wordpress_count ?? null,
        node_cumulus: snapshot.node_cumulus ?? null,
        node_nimbus: snapshot.node_nimbus ?? null,
        node_stratus: snapshot.node_stratus ?? null,
        node_total: snapshot.node_total ?? null,
        sync_status: snapshot.sync_status || 'completed',
        created_at: Date.now()
    };

    const keys = Object.keys(row);
    const placeholders = keys.map(k => `@${k}`).join(', ');
    const updateClauses = keys.filter(k => k !== 'snapshot_date').map(k => `${k} = @${k}`).join(', ');

    try {
        getDb().prepare(`
            INSERT INTO daily_snapshots (${keys.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT(snapshot_date) DO UPDATE SET ${updateClauses}
        `).run(row);
        console.log(`✅ Snapshot created for ${snapshot.snapshot_date}`);
    } catch (error) {
        console.error('createDailySnapshot error:', error.message);
    }
}

export async function getSnapshotByDate(date) {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots WHERE snapshot_date = ?').get(date) || null;
    } catch (error) {
        console.error('getSnapshotByDate error:', error.message);
        return null;
    }
}

export async function getLastNSnapshots(n = 30) {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT ?').all(n);
    } catch (error) {
        console.error('getLastNSnapshots error:', error.message);
        return [];
    }
}

export async function getSnapshotsInRange(startDate, endDate) {
    try {
        return getDb().prepare(
            'SELECT * FROM daily_snapshots WHERE snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date ASC'
        ).all(startDate, endDate);
    } catch (error) {
        console.error('getSnapshotsInRange error:', error.message);
        return [];
    }
}

export async function getAllSnapshots() {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC').all();
    } catch (error) {
        console.error('getAllSnapshots error:', error.message);
        return [];
    }
}

export async function deleteOldSnapshots(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    try {
        const result = getDb().prepare('DELETE FROM daily_snapshots WHERE snapshot_date < ?').run(cutoffDateStr);
        console.log(`🗑️  Deleted ${result.changes} old snapshots (older than ${cutoffDateStr})`);
        return result.changes;
    } catch (error) {
        console.error('deleteOldSnapshots error:', error.message);
        return 0;
    }
}

// ============================================
// REVENUE TRANSACTIONS OPERATIONS
// ============================================

export async function insertTransaction(tx) {
    try {
        getDb().prepare(`
            INSERT OR IGNORE INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name, app_type)
            VALUES (@txid, @address, @from_address, @amount, @amount_usd, @block_height, @timestamp, @date, @app_name, @app_type)
        `).run({
            txid: tx.txid,
            address: tx.address,
            from_address: tx.from_address || 'Unknown',
            amount: tx.amount,
            amount_usd: tx.amount_usd || null,
            block_height: tx.block_height,
            timestamp: tx.timestamp,
            date: tx.date,
            app_name: tx.app_name || null,
            app_type: tx.app_type || null
        });
    } catch (error) {
        console.error('insertTransaction error:', error.message);
    }
}

export async function insertTransactionsBatch(transactions) {
    if (!transactions || transactions.length === 0) return true;

    const stmt = getDb().prepare(`
        INSERT OR IGNORE INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name, app_type)
        VALUES (@txid, @address, @from_address, @amount, @amount_usd, @block_height, @timestamp, @date, @app_name, @app_type)
    `);

    try {
        const insertAll = getDb().transaction((txs) => {
            for (const tx of txs) {
                stmt.run({
                    txid: tx.txid,
                    address: tx.address,
                    from_address: tx.from_address || 'Unknown',
                    amount: tx.amount,
                    amount_usd: tx.amount_usd || null,
                    block_height: tx.block_height,
                    timestamp: tx.timestamp,
                    date: tx.date,
                    app_name: tx.app_name || null,
                    app_type: tx.app_type || null
                });
            }
        });

        insertAll(transactions);
        console.log(`✅ Inserted ${transactions.length} transactions`);
        return true;
    } catch (error) {
        console.error('insertTransactionsBatch error:', error.message);
        return false;
    }
}

export async function getUndeterminedAppNames() {
    try {
        const rows = getDb().prepare(
            `SELECT DISTINCT app_name FROM revenue_transactions WHERE app_name IS NOT NULL AND app_name != '' AND app_type IS NULL`
        ).all();
        return rows.map(r => r.app_name);
    } catch (error) {
        console.error('getUndeterminedAppNames error:', error.message);
        return [];
    }
}

export async function updateAppTypeForAppName(appName, appType) {
    try {
        getDb().prepare(
            'UPDATE revenue_transactions SET app_type = ? WHERE app_name = ? AND app_type IS NULL'
        ).run(appType, appName);
    } catch (error) {
        console.error('updateAppTypeForAppName error:', error.message);
    }
}

export async function getTxidsWithoutAppName(limit = 500, recentDays = null) {
    try {
        let sql = 'SELECT txid FROM revenue_transactions WHERE app_name IS NULL';
        const params = [];

        if (recentDays) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - Math.floor(recentDays));
            sql += ' AND date >= ?';
            params.push(cutoff.toISOString().split('T')[0]);
        }

        sql += ' ORDER BY block_height DESC LIMIT ?';
        params.push(limit);

        return getDb().prepare(sql).all(...params).map(r => r.txid);
    } catch (error) {
        console.error('getTxidsWithoutAppName error:', error.message);
        return [];
    }
}

export async function countTxidsWithoutAppName(recentDays = null) {
    try {
        let sql = 'SELECT COUNT(*) AS cnt FROM revenue_transactions WHERE app_name IS NULL';
        const params = [];

        if (recentDays) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - Math.floor(recentDays));
            sql += ' AND date >= ?';
            params.push(cutoff.toISOString().split('T')[0]);
        }

        return getDb().prepare(sql).get(...params).cnt || 0;
    } catch (error) {
        console.error('countTxidsWithoutAppName error:', error.message);
        return 0;
    }
}

export async function updateAppNameForTxid(txid, appName, appType) {
    try {
        getDb().prepare(
            'UPDATE revenue_transactions SET app_name = ?, app_type = ? WHERE txid = ? AND app_name IS NULL'
        ).run(appName, appType, txid);
    } catch (error) {
        console.error('updateAppNameForTxid error:', error.message);
    }
}

export async function getTransactionsByDate(date) {
    try {
        return getDb().prepare('SELECT * FROM revenue_transactions WHERE date = ? LIMIT 10000').all(date);
    } catch (error) {
        console.error('getTransactionsByDate error:', error.message);
        return [];
    }
}

export async function getTransactionsByBlockRange(startBlock, endBlock) {
    try {
        return getDb().prepare(
            'SELECT * FROM revenue_transactions WHERE block_height >= ? AND block_height <= ? ORDER BY block_height DESC LIMIT 10000'
        ).all(startBlock, endBlock);
    } catch (error) {
        console.error('getTransactionsByBlockRange error:', error.message);
        return [];
    }
}

export async function getRevenueForDateRange(startDate, endDate) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_transactions WHERE date >= ? AND date <= ?'
        ).get(startDate, endDate);
        return row.total;
    } catch (error) {
        console.error('getRevenueForDateRange error:', error.message);
        return 0;
    }
}

export async function getPaymentCountForDateRange(startDate, endDate) {
    try {
        const row = getDb().prepare(
            'SELECT COUNT(*) AS cnt FROM revenue_transactions WHERE date >= ? AND date <= ?'
        ).get(startDate, endDate);
        return row.cnt || 0;
    } catch (error) {
        console.error('getPaymentCountForDateRange error:', error.message);
        return 0;
    }
}

export async function getRevenueForBlockRange(startBlock, endBlock) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_transactions WHERE block_height >= ? AND block_height <= ?'
        ).get(startBlock, endBlock);
        return row.total;
    } catch (error) {
        console.error('getRevenueForBlockRange error:', error.message);
        return 0;
    }
}

export async function getLastSyncedBlock() {
    try {
        const row = getDb().prepare(
            'SELECT block_height FROM revenue_transactions ORDER BY block_height DESC LIMIT 1'
        ).get();
        return row?.block_height || null;
    } catch (error) {
        console.error('getLastSyncedBlock error:', error.message);
        return null;
    }
}

export async function getTxidCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM revenue_transactions').get();
        return row.cnt || 0;
    } catch (error) {
        console.error('getTxidCount error:', error.message);
        return 0;
    }
}

// RPC equivalent: get_transactions_paginated
export async function getTransactionsPaginated(page = 1, limit = 50, search = '', appName = null) {
    const offset = (page - 1) * limit;

    try {
        let whereClauses = [];
        const params = {};

        if (appName) {
            whereClauses.push('app_name = @appName');
            params.appName = appName;
        } else if (search) {
            const searchTerm = `%${search}%`;
            whereClauses.push(`(
                txid LIKE @search OR
                address LIKE @search OR
                from_address LIKE @search OR
                CAST(amount AS TEXT) LIKE @search OR
                CAST(date AS TEXT) LIKE @search OR
                app_name LIKE @search
            )`);
            params.search = searchTerm;
        }

        const whereStr = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

        const countRow = getDb().prepare(`SELECT COUNT(*) AS cnt FROM revenue_transactions ${whereStr}`).get(params);
        const total = countRow.cnt || 0;

        params.lim = limit;
        params.off = offset;
        const rows = getDb().prepare(`
            SELECT * FROM revenue_transactions ${whereStr}
            ORDER BY block_height DESC, timestamp DESC
            LIMIT @lim OFFSET @off
        `).all(params);

        return {
            transactions: rows,
            total: Number(total),
            page,
            limit,
            offset
        };
    } catch (error) {
        console.error('getTransactionsPaginated error:', error.message);
        return { transactions: [], total: 0, page, limit, offset };
    }
}

// RPC equivalent: get_app_analytics
export async function getAppAnalytics(page = 1, limit = 50, search = '') {
    const offset = (page - 1) * limit;

    try {
        let whereStr = "WHERE app_name IS NOT NULL AND app_name != ''";
        const params = {};

        if (search) {
            whereStr += ' AND app_name LIKE @search';
            params.search = `%${search}%`;
        }

        const countRow = getDb().prepare(`
            SELECT COUNT(DISTINCT app_name) AS cnt FROM revenue_transactions ${whereStr}
        `).get(params);
        const total = countRow.cnt || 0;

        params.lim = limit;
        params.off = offset;
        const rows = getDb().prepare(`
            SELECT
                app_name,
                COUNT(*) AS transaction_count,
                SUM(amount) AS total_revenue,
                AVG(amount) AS avg_payment,
                MIN(date) AS first_payment,
                MAX(date) AS last_payment
            FROM revenue_transactions
            ${whereStr}
            GROUP BY app_name
            ORDER BY SUM(amount) DESC
            LIMIT @lim OFFSET @off
        `).all(params);

        return {
            apps: rows,
            total: Number(total),
            page,
            limit,
            offset
        };
    } catch (error) {
        console.error('getAppAnalytics error:', error.message);
        return { apps: [], total: 0, page, limit, offset };
    }
}

// RPC equivalent: get_daily_revenue
export async function getDailyRevenueFromTransactions(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const startDate = cutoff.toISOString().split('T')[0];

    try {
        const rows = getDb().prepare(`
            SELECT date, SUM(amount) AS daily_revenue
            FROM revenue_transactions
            WHERE date >= ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate);

        console.log(`✅ Retrieved daily revenue for ${rows.length} days from transactions`);
        return rows;
    } catch (error) {
        console.error('getDailyRevenueFromTransactions error:', error.message);
        return [];
    }
}

// RPC equivalent: get_daily_revenue_in_range
export async function getDailyRevenueInRange(startDate, endDate) {
    try {
        const rows = getDb().prepare(`
            SELECT date, SUM(amount) AS daily_revenue
            FROM revenue_transactions
            WHERE date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate, endDate);

        console.log(`✅ Retrieved daily revenue for ${rows.length} days from transactions (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        console.error('getDailyRevenueInRange error:', error.message);
        return [];
    }
}

// RPC equivalent: get_daily_revenue_usd
export async function getDailyRevenueUSDFromTransactions(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const startDate = cutoff.toISOString().split('T')[0];

    try {
        const rows = getDb().prepare(`
            SELECT
                date,
                SUM(COALESCE(amount_usd, 0)) AS daily_revenue_usd,
                SUM(CASE WHEN amount_usd IS NOT NULL THEN 1 ELSE 0 END) AS usd_count,
                COUNT(*) AS total_count
            FROM revenue_transactions
            WHERE date >= ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate);

        console.log(`✅ Retrieved daily USD revenue for ${rows.length} days from transactions`);
        return rows;
    } catch (error) {
        console.error('getDailyRevenueUSDFromTransactions error:', error.message);
        return [];
    }
}

// RPC equivalent: get_daily_revenue_usd_in_range
export async function getDailyRevenueUSDInRange(startDate, endDate) {
    try {
        const rows = getDb().prepare(`
            SELECT
                date,
                SUM(COALESCE(amount_usd, 0)) AS daily_revenue_usd,
                SUM(CASE WHEN amount_usd IS NOT NULL THEN 1 ELSE 0 END) AS usd_count,
                COUNT(*) AS total_count
            FROM revenue_transactions
            WHERE date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate, endDate);

        console.log(`✅ Retrieved daily USD revenue for ${rows.length} days from transactions (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        console.error('getDailyRevenueUSDInRange error:', error.message);
        return [];
    }
}

export async function deleteOldTransactions(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    try {
        const result = getDb().prepare('DELETE FROM revenue_transactions WHERE date < ?').run(cutoffDateStr);
        console.log(`🗑️  Deleted ${result.changes} old transactions (older than ${cutoffDateStr})`);
        return result.changes;
    } catch (error) {
        console.error('deleteOldTransactions error:', error.message);
        return 0;
    }
}

export async function getTransactionsWithNullUsd(limit = 1000) {
    try {
        return getDb().prepare(
            'SELECT txid, amount, date, timestamp FROM revenue_transactions WHERE amount_usd IS NULL ORDER BY block_height DESC LIMIT ?'
        ).all(limit);
    } catch (error) {
        console.error('getTransactionsWithNullUsd error:', error.message);
        return [];
    }
}

export async function updateTransactionUsdBatch(updates) {
    if (!updates || updates.length === 0) return true;

    const stmt = getDb().prepare(
        'UPDATE revenue_transactions SET amount_usd = ? WHERE txid = ? AND amount_usd IS NULL'
    );

    try {
        const updateAll = getDb().transaction((items) => {
            for (const u of items) {
                stmt.run(u.amount_usd, u.txid);
            }
        });

        updateAll(updates);
        console.log(`Updated USD for ${updates.length} transactions`);
        return true;
    } catch (error) {
        console.error('updateTransactionUsdBatch error:', error.message);
        return false;
    }
}

// ============================================
// FAILED TXID TRACKING
// ============================================

export async function upsertFailedTxid(txid, address, reason = 'fetch_failed') {
    const now = Math.floor(Date.now() / 1000);

    try {
        const existing = getDb().prepare('SELECT txid, attempt_count FROM failed_txids WHERE txid = ?').get(txid);

        if (existing) {
            getDb().prepare(
                'UPDATE failed_txids SET attempt_count = ?, last_attempt = ?, failure_reason = ?, resolved = 0 WHERE txid = ?'
            ).run(existing.attempt_count + 1, now, reason, txid);
        } else {
            getDb().prepare(
                'INSERT INTO failed_txids (txid, address, failure_reason, attempt_count, first_seen, last_attempt, resolved) VALUES (?, ?, ?, 1, ?, ?, 0)'
            ).run(txid, address, reason, now, now);
        }
    } catch (error) {
        console.error('upsertFailedTxid error:', error.message);
    }
}

export async function getUnresolvedFailedTxids(limit = 200) {
    try {
        return getDb().prepare(
            'SELECT txid, address, failure_reason, attempt_count, first_seen, last_attempt FROM failed_txids WHERE resolved = 0 ORDER BY attempt_count ASC, last_attempt ASC LIMIT ?'
        ).all(limit);
    } catch (error) {
        console.error('getUnresolvedFailedTxids error:', error.message);
        return [];
    }
}

export async function resolveFailedTxid(txid) {
    try {
        getDb().prepare('UPDATE failed_txids SET resolved = 1 WHERE txid = ?').run(txid);
    } catch (error) {
        console.error('resolveFailedTxid error:', error.message);
    }
}

export async function getFailedTxidCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM failed_txids WHERE resolved = 0').get();
        return row.cnt || 0;
    } catch (error) {
        console.error('getFailedTxidCount error:', error.message);
        return 0;
    }
}

export async function clearAbandonedFailedTxids(maxAgeDays = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 86400);

    try {
        const result = getDb().prepare(
            'DELETE FROM failed_txids WHERE resolved = 1 AND last_attempt < ?'
        ).run(cutoff);
        return result.changes;
    } catch (error) {
        console.error('clearAbandonedFailedTxids error:', error.message);
        return 0;
    }
}

export async function isFailedTxid(txid) {
    try {
        return getDb().prepare('SELECT * FROM failed_txids WHERE txid = ? AND resolved = 0').get(txid) || null;
    } catch (error) {
        console.error('isFailedTxid error:', error.message);
        return null;
    }
}

// ============================================
// SYNC STATUS OPERATIONS
// ============================================

export async function getSyncStatus(syncType) {
    try {
        return getDb().prepare('SELECT * FROM sync_status WHERE sync_type = ?').get(syncType) || null;
    } catch (error) {
        console.error('getSyncStatus error:', error.message);
        return null;
    }
}

export async function updateSyncStatus(syncType, status, errorMessage = null, lastBlock = null) {
    try {
        getDb().prepare(
            'UPDATE sync_status SET last_sync = ?, last_sync_block = ?, status = ?, error_message = ? WHERE sync_type = ?'
        ).run(Date.now(), lastBlock, status, errorMessage, syncType);
    } catch (error) {
        console.error('updateSyncStatus error:', error.message);
    }
}

export async function resetRevenueSyncBlock() {
    try {
        getDb().prepare('UPDATE sync_status SET last_sync_block = NULL WHERE sync_type = ?').run('revenue');
    } catch (error) {
        console.error('resetRevenueSyncBlock error:', error.message);
    }
}

export async function clearRevenueData() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM revenue_transactions').get();
        const count = row.cnt || 0;

        getDb().prepare('DELETE FROM revenue_transactions').run();
        getDb().prepare(
            "UPDATE sync_status SET last_sync_block = NULL, last_sync = 0, status = 'pending' WHERE sync_type = ?"
        ).run('revenue');

        return count;
    } catch (error) {
        console.error('clearRevenueData error:', error.message);
        return 0;
    }
}

export async function setNextSync(syncType, nextSyncTime) {
    try {
        getDb().prepare('UPDATE sync_status SET next_sync = ? WHERE sync_type = ?').run(nextSyncTime, syncType);
    } catch (error) {
        console.error('setNextSync error:', error.message);
    }
}

// ============================================
// PRICE HISTORY OPERATIONS
// ============================================

export async function insertPriceHistoryBatch(prices) {
    if (!prices || prices.length === 0) return true;

    const stmt = getDb().prepare(`
        INSERT OR REPLACE INTO flux_price_history (date, price_usd, source)
        VALUES (@date, @price_usd, @source)
    `);

    try {
        const insertAll = getDb().transaction((items) => {
            for (const p of items) {
                stmt.run({
                    date: p.date,
                    price_usd: p.price_usd,
                    source: p.source || 'cryptocompare'
                });
            }
        });

        insertAll(prices);
        console.log(`Inserted/updated ${prices.length} price history rows`);
        return true;
    } catch (error) {
        console.error('insertPriceHistoryBatch error:', error.message);
        return false;
    }
}

export async function getPriceForDate(date) {
    try {
        const row = getDb().prepare('SELECT price_usd FROM flux_price_history WHERE date = ?').get(date);
        return row ? row.price_usd : null;
    } catch (error) {
        console.error('getPriceForDate error:', error.message);
        return null;
    }
}

export async function getPricesForDateRange(startDate, endDate) {
    try {
        return getDb().prepare(
            'SELECT date, price_usd FROM flux_price_history WHERE date >= ? AND date <= ? ORDER BY date ASC'
        ).all(startDate, endDate);
    } catch (error) {
        console.error('getPricesForDateRange error:', error.message);
        return [];
    }
}

export async function getLatestPriceDate() {
    try {
        const row = getDb().prepare('SELECT date FROM flux_price_history ORDER BY date DESC LIMIT 1').get();
        return row ? row.date : null;
    } catch (error) {
        console.error('getLatestPriceDate error:', error.message);
        return null;
    }
}

export async function getOldestPriceDate() {
    try {
        const row = getDb().prepare('SELECT date FROM flux_price_history ORDER BY date ASC LIMIT 1').get();
        return row ? row.date : null;
    } catch (error) {
        console.error('getOldestPriceDate error:', error.message);
        return null;
    }
}

export async function getPriceHistoryCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM flux_price_history').get();
        return row.cnt || 0;
    } catch (error) {
        console.error('getPriceHistoryCount error:', error.message);
        return 0;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export async function getDatabaseStats() {
    try {
        const d = getDb();
        const snapshots = d.prepare('SELECT COUNT(*) AS cnt FROM daily_snapshots').get().cnt;
        const transactions = d.prepare('SELECT COUNT(*) AS cnt FROM revenue_transactions').get().cnt;
        const priceHistory = d.prepare('SELECT COUNT(*) AS cnt FROM flux_price_history').get().cnt;
        const repoSnapshots = d.prepare('SELECT COUNT(*) AS cnt FROM repo_snapshots').get().cnt;
        const distinctRepos = d.prepare('SELECT COUNT(DISTINCT image_name) AS cnt FROM repo_snapshots').get().cnt;

        // Get file size
        let dbSizeKB = null;
        try {
            const stats = fs.statSync(DB_PATH);
            dbSizeKB = Math.round(stats.size / 1024);
        } catch {}

        return {
            snapshots,
            transactions,
            priceHistory,
            repoSnapshots,
            distinctRepos,
            dbSizeKB,
            dbPath: DB_PATH,
            isWriter: true,
            instanceId: 'sqlite'
        };
    } catch (error) {
        console.error('getDatabaseStats error:', error.message);
        return { snapshots: 0, transactions: 0, priceHistory: 0, repoSnapshots: 0, distinctRepos: 0, dbSizeKB: null, dbPath: DB_PATH, isWriter: true, instanceId: 'sqlite' };
    }
}

export async function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('✅ SQLite database closed');
    }
}

// ============================================
// REPO SNAPSHOTS
// ============================================

export async function createRepoSnapshots(snapshotDate, repoCounts) {
    const now = Math.floor(Date.now() / 1000);
    const entries = Object.entries(repoCounts);
    if (entries.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO repo_snapshots (snapshot_date, image_name, instance_count, category, created_at)
        VALUES (@snapshot_date, @image_name, @instance_count, @category, @created_at)
        ON CONFLICT(snapshot_date, image_name) DO UPDATE SET
            instance_count = @instance_count,
            category = @category
    `);

    try {
        const insertAll = getDb().transaction((items) => {
            for (const [imageName, count] of items) {
                stmt.run({
                    snapshot_date: snapshotDate,
                    image_name: imageName,
                    instance_count: count,
                    category: categorizeImage(imageName),
                    created_at: now
                });
            }
        });

        insertAll(entries);
        return entries.length;
    } catch (error) {
        console.error('createRepoSnapshots error:', error.message);
        return 0;
    }
}

export async function getRepoSnapshotCountByDate(date) {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM repo_snapshots WHERE snapshot_date = ?').get(date);
        return row.cnt || 0;
    } catch (error) {
        console.error('getRepoSnapshotCountByDate error:', error.message);
        return 0;
    }
}

// RPC equivalent: get_repo_history_merged
export async function getRepoHistory(imageName, limit = 90) {
    try {
        if (!imageName.includes(':')) {
            // Merge all tags
            return getDb().prepare(`
                SELECT snapshot_date, SUM(instance_count) AS instance_count
                FROM repo_snapshots
                WHERE image_name LIKE ? OR image_name = ?
                GROUP BY snapshot_date
                ORDER BY snapshot_date DESC
                LIMIT ?
            `).all(imageName + ':%', imageName, limit);
        }

        return getDb().prepare(
            'SELECT snapshot_date, instance_count FROM repo_snapshots WHERE image_name = ? ORDER BY snapshot_date DESC LIMIT ?'
        ).all(imageName, limit);
    } catch (error) {
        console.error('getRepoHistory error:', error.message);
        return [];
    }
}

// RPC equivalent: get_distinct_repos
export async function getDistinctRepos() {
    try {
        const rows = getDb().prepare('SELECT DISTINCT image_name FROM repo_snapshots ORDER BY image_name').all();
        return rows.map(r => r.image_name);
    } catch (error) {
        console.error('getDistinctRepos error:', error.message);
        return [];
    }
}

export async function getLatestRepoSnapshot() {
    try {
        const dateRow = getDb().prepare('SELECT snapshot_date FROM repo_snapshots ORDER BY snapshot_date DESC LIMIT 1').get();
        if (!dateRow) return [];

        return getDb().prepare(
            'SELECT image_name, instance_count FROM repo_snapshots WHERE snapshot_date = ? ORDER BY instance_count DESC'
        ).all(dateRow.snapshot_date);
    } catch (error) {
        console.error('getLatestRepoSnapshot error:', error.message);
        return [];
    }
}

// ============================================
// CATEGORY-BASED REPO QUERIES
// ============================================

// RPC equivalent: get_top_repos_by_category
export async function getTopReposByCategory(category, limit = 3) {
    try {
        const dateRow = getDb().prepare(
            'SELECT MAX(snapshot_date) AS d FROM repo_snapshots WHERE category = ?'
        ).get(category);

        if (!dateRow || !dateRow.d) return { date: null, repos: [] };

        const repos = getDb().prepare(`
            SELECT
                CASE WHEN INSTR(image_name, ':') > 0
                     THEN SUBSTR(image_name, 1, INSTR(image_name, ':') - 1)
                     ELSE image_name
                END AS image_name,
                SUM(instance_count) AS instance_count
            FROM repo_snapshots
            WHERE category = ? AND snapshot_date = ?
            GROUP BY 1
            ORDER BY instance_count DESC
            LIMIT ?
        `).all(category, dateRow.d, limit);

        return { date: dateRow.d, repos };
    } catch (error) {
        console.error('getTopReposByCategory error:', error.message);
        return { date: null, repos: [] };
    }
}

export async function getCategoryTotal(category, date) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(instance_count), 0) AS total FROM repo_snapshots WHERE category = ? AND snapshot_date = ?'
        ).get(category, date);
        return row.total;
    } catch (error) {
        console.error('getCategoryTotal error:', error.message);
        return 0;
    }
}

// RPC equivalent: get_category_history
export async function getCategoryHistory(category, limit = 90) {
    try {
        return getDb().prepare(`
            SELECT snapshot_date, SUM(instance_count) AS total_count
            FROM repo_snapshots
            WHERE category = ?
            GROUP BY snapshot_date
            ORDER BY snapshot_date DESC
            LIMIT ?
        `).all(category, limit);
    } catch (error) {
        console.error('getCategoryHistory error:', error.message);
        return [];
    }
}

// RPC equivalent: get_repos_by_category
export async function getReposByCategory(category) {
    try {
        return getDb().prepare(`
            SELECT DISTINCT
                CASE WHEN INSTR(image_name, ':') > 0
                     THEN SUBSTR(image_name, 1, INSTR(image_name, ':') - 1)
                     ELSE image_name
                END AS image_name
            FROM repo_snapshots
            WHERE category = ?
            ORDER BY image_name
        `).all(category);
    } catch (error) {
        console.error('getReposByCategory error:', error.message);
        return [];
    }
}

export async function backfillRepoCategories() {
    try {
        const rows = getDb().prepare(
            'SELECT DISTINCT image_name FROM repo_snapshots WHERE category IS NULL'
        ).all();

        if (rows.length === 0) return 0;

        const stmt = getDb().prepare(
            'UPDATE repo_snapshots SET category = ? WHERE image_name = ? AND category IS NULL'
        );

        let updated = 0;
        const updateAll = getDb().transaction((images) => {
            for (const row of images) {
                const cat = categorizeImage(row.image_name);
                if (cat) {
                    stmt.run(cat, row.image_name);
                    updated++;
                }
            }
        });

        updateAll(rows);
        console.log(`Backfilled categories for ${updated} of ${rows.length} distinct images`);
        return rows.length;
    } catch (error) {
        console.error('backfillRepoCategories error:', error.message);
        return 0;
    }
}

export async function recategorizeAllRepos() {
    try {
        const d = getDb();

        // Reset all categories
        d.prepare('UPDATE repo_snapshots SET category = NULL').run();

        // Get all distinct images
        const rows = d.prepare('SELECT DISTINCT image_name FROM repo_snapshots').all();

        const stmt = d.prepare('UPDATE repo_snapshots SET category = ? WHERE image_name = ?');
        const counts = {};

        const updateAll = d.transaction((images) => {
            for (const row of images) {
                const cat = categorizeImage(row.image_name);
                if (cat) {
                    stmt.run(cat, row.image_name);
                    counts[cat] = (counts[cat] || 0) + 1;
                }
            }
        });

        updateAll(rows);
        console.log(`Re-categorized ${rows.length} images:`, counts);
        return { resetCount: rows.length, categorized: counts };
    } catch (error) {
        console.error('recategorizeAllRepos error:', error.message);
        return { resetCount: 0, categorized: {} };
    }
}

// ============================================
// BACKUP EXPORT / IMPORT
// ============================================

export async function exportAllPriceHistory() {
    try {
        return getDb().prepare('SELECT * FROM flux_price_history ORDER BY date ASC').all();
    } catch (error) {
        throw new Error(`Export flux_price_history failed: ${error.message}`);
    }
}

export async function upsertPriceHistory(rows) {
    if (!rows || rows.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT OR REPLACE INTO flux_price_history (date, price_usd, source, created_at)
        VALUES (@date, @price_usd, @source, @created_at)
    `);

    const insertAll = getDb().transaction((items) => {
        for (const row of items) {
            stmt.run({
                date: row.date,
                price_usd: row.price_usd,
                source: row.source || 'cryptocompare',
                created_at: row.created_at || Math.floor(Date.now() / 1000)
            });
        }
    });

    insertAll(rows);
    return rows.length;
}

export async function exportAllDailySnapshots() {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date ASC').all();
    } catch (error) {
        throw new Error(`Export daily_snapshots failed: ${error.message}`);
    }
}

export async function exportAllRepoSnapshots() {
    try {
        return getDb().prepare('SELECT * FROM repo_snapshots ORDER BY snapshot_date ASC').all();
    } catch (error) {
        throw new Error(`Export repo_snapshots failed: ${error.message}`);
    }
}

export async function upsertDailySnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    // Build upsert dynamically based on row keys
    const sampleKeys = Object.keys(rows[0]).filter(k => k !== 'id');
    const placeholders = sampleKeys.map(k => `@${k}`).join(', ');
    const updateClauses = sampleKeys.filter(k => k !== 'snapshot_date').map(k => `${k} = @${k}`).join(', ');

    const stmt = getDb().prepare(`
        INSERT INTO daily_snapshots (${sampleKeys.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT(snapshot_date) DO UPDATE SET ${updateClauses}
    `);

    const insertAll = getDb().transaction((items) => {
        for (const row of items) {
            const params = { ...row };
            delete params.id; // let SQLite auto-increment
            stmt.run(params);
        }
    });

    insertAll(rows);
    return rows.length;
}

export async function upsertRepoSnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO repo_snapshots (snapshot_date, image_name, instance_count, category, created_at)
        VALUES (@snapshot_date, @image_name, @instance_count, @category, @created_at)
        ON CONFLICT(snapshot_date, image_name) DO UPDATE SET
            instance_count = @instance_count,
            category = @category
    `);

    const insertAll = getDb().transaction((items) => {
        for (const row of items) {
            stmt.run({
                snapshot_date: row.snapshot_date,
                image_name: row.image_name,
                instance_count: row.instance_count,
                category: row.category || null,
                created_at: row.created_at || Math.floor(Date.now() / 1000)
            });
        }
    });

    insertAll(rows);
    return rows.length;
}

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { migrateSchema } from './schemaMigrator.js';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'flux-performance.db');

// Initialize database connection
let db;

export function initDatabase() {
    try {
        db = new Database(dbPath, { verbose: console.log });

        console.log('🔍 Checking database integrity...');
        const integrity = db.pragma('integrity_check');
        
        if (integrity[0].integrity_check === 'ok') {
            console.log('✅ Database integrity: OK');
        } else {
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('❌ DATABASE CORRUPTION DETECTED!');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Fix commands:');
            console.error(`  1. cp ${dbPath} ${dbPath}.backup`);
            console.error(`  2. rm ${dbPath}`);
            console.error('  3. Restart server');
            throw new Error('Database corrupted');
        }
        
        // Enable WAL mode for better performance
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 32768'); // 128MB cache
        
        createTables();
        initializeSyncStatus();
        
                try {
            console.log('\n🔄 Checking for schema updates...');
            
            // Import config dynamically to avoid circular dependencies
            import('../config.js').then(async (config) => {
                try {
                    const migrationResult = await migrateSchema(config);
                    
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
                    console.log('   Database will work, but new columns may need manual addition');
                }
            }).catch(err => {
                console.warn('⚠️  Could not load config for auto-migration:', err.message);
                console.log('   Database will work, but schema migration skipped');
            });
            
        } catch (error) {
            console.warn('⚠️  Auto-migration skipped:', error.message);
            console.log('   Database will work, but new columns may need manual addition');
        }


        console.log('✅ Database initialized successfully');
        return db;
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        throw error;
    }
}

function createTables() {
    // Table 1: Daily Snapshots
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date DATE NOT NULL UNIQUE,
            timestamp INTEGER NOT NULL,
            
            -- Revenue Metrics
            daily_revenue REAL NOT NULL DEFAULT 0,
            flux_price_usd REAL,
            
            -- Cloud Utilization - Totals
            total_cpu_cores INTEGER DEFAULT 0,
            used_cpu_cores INTEGER DEFAULT 0,
            cpu_utilization_percent REAL DEFAULT 0,
            
            total_ram_gb REAL DEFAULT 0,
            used_ram_gb REAL DEFAULT 0,
            ram_utilization_percent REAL DEFAULT 0,
            
            total_storage_gb REAL DEFAULT 0,
            used_storage_gb REAL DEFAULT 0,
            storage_utilization_percent REAL DEFAULT 0,
            
            -- App Counts
            total_apps INTEGER DEFAULT 0,
            watchtower_count INTEGER DEFAULT 0,
            
            -- Gaming
            gaming_apps_total INTEGER DEFAULT 0,
            gaming_palworld INTEGER DEFAULT 0,
            gaming_enshrouded INTEGER DEFAULT 0,
            gaming_minecraft INTEGER DEFAULT 0,
            
            -- Crypto Nodes
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
            
            -- WordPress
            wordpress_count INTEGER DEFAULT 0,
            
            -- Node Distribution
            node_cumulus INTEGER DEFAULT 0,
            node_nimbus INTEGER DEFAULT 0,
            node_stratus INTEGER DEFAULT 0,
            node_total INTEGER DEFAULT 0,
            
            -- Metadata
            sync_status TEXT DEFAULT 'completed',
            created_at INTEGER NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_snapshot_date ON daily_snapshots(snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON daily_snapshots(timestamp);
    `);

    // Table 2: Revenue Transactions
    db.exec(`
        CREATE TABLE IF NOT EXISTS revenue_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            from_address TEXT DEFAULT 'Unknown',
            amount REAL NOT NULL,
            block_height INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            date DATE NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_address ON revenue_transactions(address);
        CREATE INDEX IF NOT EXISTS idx_from_address ON revenue_transactions(from_address);
        CREATE INDEX IF NOT EXISTS idx_block_height ON revenue_transactions(block_height);
        CREATE INDEX IF NOT EXISTS idx_date ON revenue_transactions(date);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON revenue_transactions(timestamp);
    `);

    // Table 3: Current Metrics
    db.exec(`
        CREATE TABLE IF NOT EXISTS current_metrics (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_update INTEGER NOT NULL,
            
            -- Revenue
            current_revenue REAL DEFAULT 0,
            flux_price_usd REAL,
            
            -- Cloud Utilization
            total_cpu_cores INTEGER DEFAULT 0,
            used_cpu_cores INTEGER DEFAULT 0,
            cpu_utilization_percent REAL DEFAULT 0,
            
            total_ram_gb REAL DEFAULT 0,
            used_ram_gb REAL DEFAULT 0,
            ram_utilization_percent REAL DEFAULT 0,
            
            total_storage_gb REAL DEFAULT 0,
            used_storage_gb REAL DEFAULT 0,
            storage_utilization_percent REAL DEFAULT 0,
            
            -- App Counts
            total_apps INTEGER DEFAULT 0,
            watchtower_count INTEGER DEFAULT 0,
            
            -- Gaming
            gaming_apps_total INTEGER DEFAULT 0,
            gaming_palworld INTEGER DEFAULT 0,
            gaming_enshrouded INTEGER DEFAULT 0,
            gaming_minecraft INTEGER DEFAULT 0,
            
            -- Crypto Nodes
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
            
            -- WordPress
            wordpress_count INTEGER DEFAULT 0,
            
            -- Node Distribution
            node_cumulus INTEGER DEFAULT 0,
            node_nimbus INTEGER DEFAULT 0,
            node_stratus INTEGER DEFAULT 0,
            node_total INTEGER DEFAULT 0
        );
        
        -- Insert default row if not exists
        INSERT OR IGNORE INTO current_metrics (id, last_update) 
        VALUES (1, 0);
    `);

    // Table 4: Sync Status
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_status (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sync_type TEXT NOT NULL UNIQUE,
            last_sync INTEGER NOT NULL,
            last_sync_block INTEGER,
            next_sync INTEGER,
            status TEXT DEFAULT 'pending',
            error_message TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_sync_type ON sync_status(sync_type);
    `);

    console.log('✅ Database tables created');
}

function initializeSyncStatus() {
    const syncTypes = ['revenue', 'cloud', 'gaming', 'wordpress', 'nodes', 'crypto', 'daily_snapshot'];
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO sync_status (sync_type, last_sync, status)
        VALUES (?, 0, 'pending')
    `);

    syncTypes.forEach(type => stmt.run(type));
    console.log('✅ Sync status initialized');
}

// ============================================
// CURRENT METRICS OPERATIONS
// ============================================

export function getCurrentMetrics() {
    const stmt = db.prepare('SELECT * FROM current_metrics WHERE id = 1');
    console.log('Executing getCurrentMetrics query');
    return stmt.get();
}

export function updateCurrentMetrics(metrics) {
    // CRITICAL FIX: Get current metrics first, then merge with updates
    const current = getCurrentMetrics();
    
    // Merge with defaults to prevent NULL values
    const mergedMetrics = {
        current_revenue: metrics.current_revenue ?? current.current_revenue ?? null,
        flux_price_usd: metrics.flux_price_usd ?? current.flux_price_usd ?? null,
        total_cpu_cores: metrics.total_cpu_cores ?? current.total_cpu_cores ?? null,
        used_cpu_cores: metrics.used_cpu_cores ?? current.used_cpu_cores ?? null,
        cpu_utilization_percent: metrics.cpu_utilization_percent ?? current.cpu_utilization_percent ?? null,
        total_ram_gb: metrics.total_ram_gb ?? current.total_ram_gb ?? null,
        used_ram_gb: metrics.used_ram_gb ?? current.used_ram_gb ?? null,
        ram_utilization_percent: metrics.ram_utilization_percent ?? current.ram_utilization_percent ?? null,
        total_storage_gb: metrics.total_storage_gb ?? current.total_storage_gb ?? null,
        used_storage_gb: metrics.used_storage_gb ?? current.used_storage_gb ?? null,
        storage_utilization_percent: metrics.storage_utilization_percent ?? current.storage_utilization_percent ?? null,
        total_apps: metrics.total_apps ?? current.total_apps ?? null,
        watchtower_count: metrics.watchtower_count ?? current.watchtower_count ?? null,
        gaming_apps_total: metrics.gaming_apps_total ?? current.gaming_apps_total ?? null,
        gaming_palworld: metrics.gaming_palworld ?? current.gaming_palworld ?? null,
        gaming_enshrouded: metrics.gaming_enshrouded ?? current.gaming_enshrouded ?? null,
        gaming_minecraft: metrics.gaming_minecraft ?? current.gaming_minecraft ?? null,
        crypto_presearch: metrics.crypto_presearch ?? current.crypto_presearch ?? null,
        crypto_streamr: metrics.crypto_streamr ?? current.crypto_streamr ?? null,
        crypto_ravencoin: metrics.crypto_ravencoin ?? current.crypto_ravencoin ?? null,
        crypto_kadena: metrics.crypto_kadena ?? current.crypto_kadena ?? null,
        crypto_alephium: metrics.crypto_alephium ?? current.crypto_alephium ?? null,
        crypto_bittensor: metrics.crypto_bittensor ?? current.crypto_bittensor ?? null,
        crypto_timpi_collector: metrics.crypto_timpi_collector ?? current.crypto_timpi_collector ?? null,
        crypto_timpi_geocore: metrics.crypto_timpi_geocore ?? current.crypto_timpi_geocore ?? null,
        crypto_kaspa: metrics.crypto_kaspa ?? current.crypto_kaspa ?? null,
        crypto_nodes_total: metrics.crypto_nodes_total ?? current.crypto_nodes_total ?? null,
        wordpress_count: metrics.wordpress_count ?? current.wordpress_count ?? null,
        node_cumulus: metrics.node_cumulus ?? current.node_cumulus ?? null,
        node_nimbus: metrics.node_nimbus ?? current.node_nimbus ?? null,
        node_stratus: metrics.node_stratus ?? current.node_stratus ?? null,
        node_total: metrics.node_total ?? current.node_total ?? null
    };

    const stmt = db.prepare(`
        UPDATE current_metrics SET
            last_update = ?,
            current_revenue = ?,
            flux_price_usd = ?,
            total_cpu_cores = ?,
            used_cpu_cores = ?,
            cpu_utilization_percent = ?,
            total_ram_gb = ?,
            used_ram_gb = ?,
            ram_utilization_percent = ?,
            total_storage_gb = ?,
            used_storage_gb = ?,
            storage_utilization_percent = ?,
            total_apps = ?,
            watchtower_count = ?,
            gaming_apps_total = ?,
            gaming_palworld = ?,
            gaming_enshrouded = ?,
            gaming_minecraft = ?,
            crypto_presearch = ?,
            crypto_streamr = ?,
            crypto_ravencoin = ?,
            crypto_kadena = ?,
            crypto_alephium = ?,
            crypto_bittensor = ?,
            crypto_timpi_collector = ?,
            crypto_timpi_geocore = ?,
            crypto_kaspa = ?,
            crypto_nodes_total = ?,
            wordpress_count = ?,
            node_cumulus = ?,
            node_nimbus = ?,
            node_stratus = ?,
            node_total = ?
        WHERE id = 1
    `);

    stmt.run(
        Date.now(),
        mergedMetrics.current_revenue,
        mergedMetrics.flux_price_usd,
        mergedMetrics.total_cpu_cores,
        mergedMetrics.used_cpu_cores,
        mergedMetrics.cpu_utilization_percent,
        mergedMetrics.total_ram_gb,
        mergedMetrics.used_ram_gb,
        mergedMetrics.ram_utilization_percent,
        mergedMetrics.total_storage_gb,
        mergedMetrics.used_storage_gb,
        mergedMetrics.storage_utilization_percent,
        mergedMetrics.total_apps,
        mergedMetrics.watchtower_count,
        mergedMetrics.gaming_apps_total,
        mergedMetrics.gaming_palworld,
        mergedMetrics.gaming_enshrouded,
        mergedMetrics.gaming_minecraft,
        mergedMetrics.crypto_presearch,
        mergedMetrics.crypto_streamr,
        mergedMetrics.crypto_ravencoin,
        mergedMetrics.crypto_kadena,
        mergedMetrics.crypto_alephium,
        mergedMetrics.crypto_bittensor,
        mergedMetrics.crypto_timpi_collector,
        mergedMetrics.crypto_timpi_geocore,
        mergedMetrics.crypto_kaspa,
        mergedMetrics.crypto_nodes_total,
        mergedMetrics.wordpress_count,
        mergedMetrics.node_cumulus,
        mergedMetrics.node_nimbus,
        mergedMetrics.node_stratus,
        mergedMetrics.node_total
    );
    console.log('✅ Current metrics updated');
}

// ============================================
// DAILY SNAPSHOTS OPERATIONS
// ============================================

export function createDailySnapshot(snapshot) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO daily_snapshots (
            snapshot_date, timestamp,
            daily_revenue, flux_price_usd,
            total_cpu_cores, used_cpu_cores, cpu_utilization_percent,
            total_ram_gb, used_ram_gb, ram_utilization_percent,
            total_storage_gb, used_storage_gb, storage_utilization_percent,
            total_apps, watchtower_count,
            gaming_apps_total, gaming_palworld, gaming_enshrouded, gaming_minecraft,
            crypto_presearch, crypto_streamr, crypto_ravencoin, crypto_kadena,
            crypto_alephium, crypto_bittensor, crypto_timpi_collector, crypto_timpi_geocore,
            crypto_kaspa, crypto_nodes_total,
            wordpress_count,
            node_cumulus, node_nimbus, node_stratus, node_total,
            sync_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        snapshot.snapshot_date,
        snapshot.timestamp,
        snapshot.daily_revenue,
        snapshot.flux_price_usd,
        snapshot.total_cpu_cores,
        snapshot.used_cpu_cores,
        snapshot.cpu_utilization_percent,
        snapshot.total_ram_gb,
        snapshot.used_ram_gb,
        snapshot.ram_utilization_percent,
        snapshot.total_storage_gb,
        snapshot.used_storage_gb,
        snapshot.storage_utilization_percent,
        snapshot.total_apps,
        snapshot.watchtower_count,
        snapshot.gaming_apps_total,
        snapshot.gaming_palworld,
        snapshot.gaming_enshrouded,
        snapshot.gaming_minecraft,
        snapshot.crypto_presearch,
        snapshot.crypto_streamr,
        snapshot.crypto_ravencoin,
        snapshot.crypto_kadena,
        snapshot.crypto_alephium,
        snapshot.crypto_bittensor,
        snapshot.crypto_timpi_collector,
        snapshot.crypto_timpi_geocore,
        snapshot.crypto_kaspa,
        snapshot.crypto_nodes_total,
        snapshot.wordpress_count,
        snapshot.node_cumulus,
        snapshot.node_nimbus,
        snapshot.node_stratus,
        snapshot.node_total,
        snapshot.sync_status || 'completed',
        Date.now()
    );

    console.log(`✅ Snapshot created for ${snapshot.snapshot_date}`);
}

export function getSnapshotByDate(date) {
    const stmt = db.prepare('SELECT * FROM daily_snapshots WHERE snapshot_date = ?');
    return stmt.get(date);
}

export function getLastNSnapshots(n = 30) {
    const stmt = db.prepare(`
        SELECT * FROM daily_snapshots 
        ORDER BY snapshot_date DESC 
        LIMIT ?
    `);
    return stmt.all(n);
}

export function getSnapshotsInRange(startDate, endDate) {
    const stmt = db.prepare(`
        SELECT * FROM daily_snapshots 
        WHERE snapshot_date BETWEEN ? AND ?
        ORDER BY snapshot_date ASC
    `);
    return stmt.all(startDate, endDate);
}

export function getAllSnapshots() {
    const stmt = db.prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC');
    return stmt.all();
}

export function deleteOldSnapshots(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const stmt = db.prepare('DELETE FROM daily_snapshots WHERE snapshot_date < ?');
    const result = stmt.run(cutoffDateStr);
    
    console.log(`🗑️  Deleted ${result.changes} old snapshots (older than ${cutoffDateStr})`);
    return result.changes;
}

// ============================================
// REVENUE TRANSACTIONS OPERATIONS
// ============================================

export function insertTransaction(tx) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO revenue_transactions 
        (txid, address, from_address, amount, block_height, timestamp, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        tx.txid,
        tx.address,
        tx.from_address || 'Unknown',
        tx.amount,
        tx.block_height,
        tx.timestamp,
        tx.date
    );
}

export function insertTransactionsBatch(transactions) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO revenue_transactions 
        (txid, address, from_address, amount, block_height, timestamp, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((txs) => {
        for (const tx of txs) {
            stmt.run(
                tx.txid, 
                tx.address, 
                tx.from_address || 'Unknown', 
                tx.amount, 
                tx.block_height, 
                tx.timestamp, 
                tx.date
            );
        }
    });

    insertMany(transactions);
    console.log(`✅ Inserted ${transactions.length} transactions`);
}

export function getTransactionsByDate(date) {
    const stmt = db.prepare('SELECT * FROM revenue_transactions WHERE date = ?');
    return stmt.all(date);
}

export function getTransactionsByBlockRange(startBlock, endBlock) {
    const stmt = db.prepare(`
        SELECT * FROM revenue_transactions
        WHERE block_height BETWEEN ? AND ?
        ORDER BY block_height DESC
    `);
    return stmt.all(startBlock, endBlock);
}

export function getRevenueForDateRange(startDate, endDate) {
    const stmt = db.prepare(`
        SELECT SUM(amount) as total_revenue
        FROM revenue_transactions
        WHERE date BETWEEN ? AND ?
    `);
    const result = stmt.get(startDate, endDate);
    return result?.total_revenue || 0;
}

/**
 * Get count of payments (transactions) for a date range
 */
export function getPaymentCountForDateRange(startDate, endDate) {
    const stmt = db.prepare(`
        SELECT COUNT(*) as payment_count
        FROM revenue_transactions
        WHERE date BETWEEN ? AND ?
    `);
    const result = stmt.get(startDate, endDate);
    return result?.payment_count || 0;
}

export function getRevenueForBlockRange(startBlock, endBlock) {
    const stmt = db.prepare(`
        SELECT SUM(amount) as total_revenue
        FROM revenue_transactions
        WHERE block_height BETWEEN ? AND ?
    `);
    const result = stmt.get(startBlock, endBlock);
    return result?.total_revenue || 0;
}

export function getLastSyncedBlock() {
    const stmt = db.prepare(`
        SELECT MAX(block_height) as last_block
        FROM revenue_transactions
    `);
    const result = stmt.get();
    return result?.last_block || null;
}

/**
 * Get all transaction IDs from database (for filtering during sync)
 */
export function getAllTxids() {
    const stmt = db.prepare('SELECT txid FROM revenue_transactions');
    return stmt.all().map(row => row.txid);
}

/**
 * Get count of transactions in database
 */
export function getTxidCount() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions');
    const result = stmt.get();
    return result?.count || 0;
}

/**
 * Get paginated transactions with optional search
 */
export function getTransactionsPaginated(page = 1, limit = 50, search = '') {
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    let params = [];
    
    // Build search query if search term provided
    if (search && search.trim() !== '') {
        const searchTerm = `%${search.trim()}%`;
        whereClause = `WHERE 
            txid LIKE ? OR 
            address LIKE ? OR 
            from_address LIKE ? OR
            CAST(amount AS TEXT) LIKE ? OR
            date LIKE ?`;
        params = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];
    }
    
    // Get total count
    const countStmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM revenue_transactions 
        ${whereClause}
    `);
    const countResult = params.length > 0 ? countStmt.get(...params) : countStmt.get();
    const total = countResult?.count || 0;
    
    // Get paginated results
    const dataStmt = db.prepare(`
        SELECT * FROM revenue_transactions 
        ${whereClause}
        ORDER BY block_height DESC, timestamp DESC
        LIMIT ? OFFSET ?
    `);
    
    const queryParams = params.length > 0 ? [...params, limit, offset] : [limit, offset];
    const transactions = dataStmt.all(...queryParams);
    
    return {
        transactions,
        total,
        page,
        limit,
        offset
    };
}

/**
 * NEW: Get daily revenue aggregated from transactions for the last N days
 * This replaces snapshot-based revenue for chart display
 */
export function getDailyRevenueFromTransactions(days = 30) {
    const stmt = db.prepare(`
        SELECT 
            date,
            SUM(amount) as daily_revenue
        FROM revenue_transactions
        WHERE date >= date('now', '-' || ? || ' days')
        GROUP BY date
        ORDER BY date ASC
    `);
    
    const results = stmt.all(days);
    console.log(`✅ Retrieved daily revenue for ${results.length} days from transactions`);
    return results;
}

/**
 * NEW: Get daily revenue aggregated from transactions for a specific date range
 */
export function getDailyRevenueInRange(startDate, endDate) {
    const stmt = db.prepare(`
        SELECT 
            date,
            SUM(amount) as daily_revenue
        FROM revenue_transactions
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
    `);
    
    const results = stmt.all(startDate, endDate);
    console.log(`✅ Retrieved daily revenue for ${results.length} days from transactions (${startDate} to ${endDate})`);
    return results;
}

export function deleteOldTransactions(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const stmt = db.prepare('DELETE FROM revenue_transactions WHERE date < ?');
    const result = stmt.run(cutoffDateStr);
    
    console.log(`🗑️  Deleted ${result.changes} old transactions (older than ${cutoffDateStr})`);
    return result.changes;
}

// ============================================
// SYNC STATUS OPERATIONS
// ============================================

export function getSyncStatus(syncType) {
    const stmt = db.prepare('SELECT * FROM sync_status WHERE sync_type = ?');
    return stmt.get(syncType);
}

export function updateSyncStatus(syncType, status, errorMessage = null, lastBlock = null) {
    const stmt = db.prepare(`
        UPDATE sync_status SET
            last_sync = ?,
            last_sync_block = ?,
            status = ?,
            error_message = ?
        WHERE sync_type = ?
    `);

    stmt.run(Date.now(), lastBlock, status, errorMessage, syncType);
}

export function setNextSync(syncType, nextSyncTime) {
    const stmt = db.prepare('UPDATE sync_status SET next_sync = ? WHERE sync_type = ?');
    stmt.run(nextSyncTime, syncType);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getDatabaseStats() {
    const snapshots = db.prepare('SELECT COUNT(*) as count FROM daily_snapshots').get();
    const transactions = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions').get();
    const dbSize = fs.statSync(dbPath).size;

    return {
        snapshots: snapshots.count,
        transactions: transactions.count,
        dbSizeKB: Math.round(dbSize / 1024),
        dbPath
    };
}

export function closeDatabase() {
    if (db) {
        db.close();
        console.log('✅ Database connection closed');
    }
}

// Initialize database on module load
initDatabase();

export default db;
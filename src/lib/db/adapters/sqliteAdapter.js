// SQLite adapter — drop-in replacement for supabaseAdapter.js
// Uses better-sqlite3 for all DB operations.
// All functions are async for interface compatibility with the Supabase adapter.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { categorizeImage, METRIC_COLUMNS, TRACKED_GAMES, CRYPTO_REPOS } from '../../config.js';
import { createLogger } from '../../logger.js';
import { resolveDimension } from '../../decentralizationDimensions.js';

const log = createLogger('sqliteAdapter');

/**
 * A read that failed must THROW, never return 0/[]/null (issue #307). A swallowed error looked
 * like a successful empty read: dbCallTracker counted it as a DB success, withDbFallback cached
 * the zeros as fresh for its whole TTL (overwriting the good stale entry), and the circuit
 * breaker never tripped -- so an outage rendered as real zeros instead of a 503 with stale data.
 */
function readFailed(fn, error) {
    log.error(`${fn} error: ${error.message}`);
    return new Error(`${fn} failed: ${error.message}`);
}

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

export function getDb() {
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
            gaming_instances_total INTEGER,
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
            -- Issue #201. No DEFAULT: absent must read back NULL, never a 0 that would
            -- mean "no wallets ran nodes that day".
            unique_wallets INTEGER,
            -- Issue #209. No DEFAULT, same reasoning: a 0 would mean "nobody ran an app
            -- that day", not "no reading taken".
            unique_app_owners INTEGER,
            -- Issue #210. No DEFAULT: absent must read back NULL, never a 0 that
            -- would mean "no collateral was locked that day".
            locked_collateral_cumulus REAL,
            locked_collateral_nimbus REAL,
            locked_collateral_stratus REAL,
            locked_collateral REAL,
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
            app_type TEXT DEFAULT NULL,
            msg_type TEXT DEFAULT NULL,
            enterprise INTEGER DEFAULT NULL,
            expire_blocks INTEGER DEFAULT NULL,
            instances INTEGER DEFAULT NULL
        )
    `);
    // Message metadata (issue #262) on a database created before it: same "ALTER, swallow
    // duplicate-column" self-healing as node_ip_classification below.
    for (const [col, type] of [['msg_type', 'TEXT'], ['enterprise', 'INTEGER'], ['expire_blocks', 'INTEGER'], ['instances', 'INTEGER']]) {
        try {
            d.exec(`ALTER TABLE revenue_transactions ADD COLUMN ${col} ${type} DEFAULT NULL`);
        } catch (error) {
            if (!error.message?.includes('duplicate column name')) throw error;
        }
    }

    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_address ON revenue_transactions(address)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_from_address ON revenue_transactions(from_address)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_block_height ON revenue_transactions(block_height)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_date ON revenue_transactions(date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_timestamp ON revenue_transactions(timestamp)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_usd_null ON revenue_transactions(txid) WHERE amount_usd IS NULL`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_app_name ON revenue_transactions(app_name)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_rt_block_height_ts_id_desc ON revenue_transactions(block_height DESC, timestamp DESC, id DESC)`); // #294

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
            gaming_instances_total INTEGER,
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
            unique_wallets INTEGER,
            unique_app_owners INTEGER,
            locked_collateral_cumulus REAL,
            locked_collateral_nimbus REAL,
            locked_collateral_stratus REAL,
            locked_collateral REAL
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

    // Per-game daily counts (issue #163). repo_snapshots cannot serve this: it is keyed by
    // Docker image, and the games that most need tracking (FiveM, most Valheim) have
    // encrypted specs with no image at all. Keyed by canonical game name instead, which is
    // what both identification paths resolve to.
    d.exec(`
        CREATE TABLE IF NOT EXISTS game_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            game_name TEXT NOT NULL,
            instance_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, game_name)
        )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_game_snapshot_date ON game_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_game_snapshot_name ON game_snapshots(game_name, snapshot_date)`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS decentralization_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            org TEXT NOT NULL,
            node_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, org)
        )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_snapshot_date ON decentralization_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_org ON decentralization_snapshots(org)`);

    // Decentralization metric (issue #108): one row per node IP ever classified via the
    // free ipwho.is/ip-api.com chain, cached indefinitely (an IP's ASN/org rarely changes)
    // and re-checked only once classified_at goes stale -- see decentralizationService.js.
    d.exec(`
        CREATE TABLE IF NOT EXISTS node_ip_classification (
            ip TEXT PRIMARY KEY,
            asn INTEGER,
            org TEXT,
            is_datacenter INTEGER NOT NULL DEFAULT 0,
            classified_at INTEGER NOT NULL,
            country TEXT,
            country_code TEXT,
            continent TEXT,
            continent_code TEXT
        )
    `);
    // Self-healing for a DB created before issue #138 (CREATE TABLE IF NOT EXISTS above
    // doesn't add columns to an existing table) -- same "ALTER, swallow duplicate-column"
    // pattern schemaMigrator.js uses for daily_snapshots/current_metrics.
    for (const col of ['country', 'country_code', 'continent', 'continent_code']) {
        try {
            d.exec(`ALTER TABLE node_ip_classification ADD COLUMN ${col} TEXT`);
        } catch (error) {
            if (!error.message?.includes('duplicate column name')) throw error;
        }
    }

    // Per-country/continent decentralization breakdown, issue #138 -- same shape as
    // decentralization_snapshots (one row per (date, dimension-value)), just grouped by
    // country/continent instead of org.
    d.exec(`
        CREATE TABLE IF NOT EXISTS decentralization_country_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            country TEXT NOT NULL,
            country_code TEXT,
            node_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, country)
        )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_country_snapshot_date ON decentralization_country_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_country ON decentralization_country_snapshots(country)`);

    d.exec(`
        CREATE TABLE IF NOT EXISTS decentralization_continent_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            continent TEXT NOT NULL,
            continent_code TEXT,
            node_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(snapshot_date, continent)
        )
    `);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_continent_snapshot_date ON decentralization_continent_snapshots(snapshot_date)`);
    d.exec(`CREATE INDEX IF NOT EXISTS idx_decentralization_continent ON decentralization_continent_snapshots(continent)`);
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
            log.info('[SCHEMA] Checking for schema updates...');
            const config = await import('../../config.js');
            const { migrateSchema } = await import('../schemaMigrator.js');
            const migrationResult = await migrateSchema(config, getDb());
            if (migrationResult.success) {
                if (migrationResult.columnsAdded.length > 0) {
                    log.info('[SCHEMA] Schema updated with new columns');
                } else {
                    log.info('[SCHEMA] Schema is up to date');
                }
            } else {
                log.warn({ errors: migrationResult.errors }, '[SCHEMA] Schema migration had issues');
            }
        } catch (migrationError) {
            log.warn(`[SCHEMA] Schema migration error: ${migrationError.message}`);
        }

        // Backfill repo categories for existing rows
        try {
            const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM repo_snapshots WHERE category IS NULL').get();
            if (row.cnt > 0) {
                log.info(`[BACKFILL] Backfilling categories for ${row.cnt} uncategorized images...`);
                setTimeout(async () => {
                    try { await backfillRepoCategories(); } catch(e) { log.warn(`Backfill error: ${e.message}`); }
                }, 100);
            }
        } catch (e) {
            log.warn(`Category backfill check skipped: ${e.message}`);
        }

        _dbReady = true;
        log.info(`[DB] Database initialized successfully (SQLite: ${DB_PATH})`);
    } catch (error) {
        _dbReady = false;
        log.error({ err: error }, '[DB] Database initialization error');
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
            log.warn(`[DB] DB init attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
            if (attempt < MAX_ATTEMPTS) {
                log.info(`Retrying in ${Math.round(delay / 1000)}s...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 60_000);
            }
        }
    }

    log.error('[DB] Database initialization failed after all retry attempts');
    return false;
}

// ============================================
// CURRENT METRICS OPERATIONS
// ============================================

export async function getCurrentMetrics() {
    try {
        return getDb().prepare('SELECT * FROM current_metrics WHERE id = 1').get() || null;
    } catch (error) {
        throw readFailed('getCurrentMetrics', error);
    }
}

export async function updateCurrentMetrics(metrics) {
    const current = await getCurrentMetrics();
    if (!current) return;

    const merged = { last_update: Date.now() };

    // Only persist columns that actually exist — METRIC_COLUMNS grows with the repo config,
    // and schemaMigrator may not have run yet on a database from an older build.
    const existing = new Set(getDb().pragma('table_info(current_metrics)').map(c => c.name));
    const metricKeys = METRIC_COLUMNS.filter(k => existing.has(k));

    for (const key of metricKeys) {
        merged[key] = metrics[key] ?? current[key] ?? null;
    }

    const setClauses = Object.keys(merged).map(k => `${k} = @${k}`).join(', ');
    // Throws rather than logs-and-returns (issue #220): callers follow this with
    // updateSyncStatus(..., 'completed'), so swallowing the error records a sync that
    // wrote nothing.
    getDb().prepare(`UPDATE current_metrics SET ${setClauses} WHERE id = 1`).run(merged);
    log.info('Current metrics updated');
}

// ============================================
// DAILY SNAPSHOTS OPERATIONS
// ============================================

/**
 * Correct one day's recorded revenue, leaving the rest of its row untouched (issue #248).
 *
 * Deliberately narrow. createDailySnapshot() enumerates every column and nulls whatever the
 * caller omits, so reusing it to fix one field would wipe that day's nodes, apps and
 * utilization figures. And deliberately an UPDATE, not an upsert: filling a missing day is
 * backfillRevenueSnapshots()'s job, while this only corrects a day already recorded.
 *
 * @returns {Promise<boolean>} true if a row existed for that date and was updated
 */
export async function updateSnapshotRevenue(snapshotDate, dailyRevenue) {
    const result = getDb()
        .prepare('UPDATE daily_snapshots SET daily_revenue = ? WHERE snapshot_date = ?')
        .run(dailyRevenue, snapshotDate);

    return result.changes > 0;
}

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
        // Gaming and crypto columns are DERIVED FROM CONFIG here too (issue #229). The
        // snapshot builder, this adapter and its Supabase twin each enumerated them
        // literally, so a game added to GAMING_REPOS had to be remembered in THREE places
        // -- and was not. Deriving all three from the same config list is what makes the
        // documented "adding a repo to config is enough" actually true.
        gaming_apps_total: snapshot.gaming_apps_total ?? null,
        gaming_instances_total: snapshot.gaming_instances_total ?? null,
        ...Object.fromEntries(TRACKED_GAMES.map(g => [g.dbKey, snapshot[g.dbKey] ?? null])),
        ...Object.fromEntries(CRYPTO_REPOS.map(r => [r.dbKey, snapshot[r.dbKey] ?? null])),
        crypto_nodes_total: snapshot.crypto_nodes_total ?? null,
        wordpress_count: snapshot.wordpress_count ?? null,
        node_cumulus: snapshot.node_cumulus ?? null,
        node_nimbus: snapshot.node_nimbus ?? null,
        node_stratus: snapshot.node_stratus ?? null,
        node_total: snapshot.node_total ?? null,
        unique_wallets: snapshot.unique_wallets ?? null,
        unique_app_owners: snapshot.unique_app_owners ?? null,
        locked_collateral_cumulus: snapshot.locked_collateral_cumulus ?? null,
        locked_collateral_nimbus: snapshot.locked_collateral_nimbus ?? null,
        locked_collateral_stratus: snapshot.locked_collateral_stratus ?? null,
        locked_collateral: snapshot.locked_collateral ?? null,
        decentralization_datacenter_count: snapshot.decentralization_datacenter_count ?? null,
        decentralization_independent_count: snapshot.decentralization_independent_count ?? null,
        decentralization_datacenter_percent: snapshot.decentralization_datacenter_percent ?? null,
        apps_deployed_today: snapshot.apps_deployed_today ?? null,
        apps_expiring_today: snapshot.apps_expiring_today ?? null,
        sync_status: snapshot.sync_status || 'completed',
        created_at: Date.now()
    };

    const keys = Object.keys(row);
    const placeholders = keys.map(k => `@${k}`).join(', ');
    const updateClauses = keys.filter(k => k !== 'snapshot_date').map(k => `${k} = @${k}`).join(', ');

    // Throws rather than logs-and-returns (issue #220), matching every sibling snapshot
    // writer. takeSnapshot()'s own try/catch turns this into { success: false }, which is
    // what stops a lost day from resetting the failure counter and firing a backup.
    getDb().prepare(`
        INSERT INTO daily_snapshots (${keys.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT(snapshot_date) DO UPDATE SET ${updateClauses}
    `).run(row);
    log.info(`Snapshot created for ${snapshot.snapshot_date}`);
}

/**
 * Set unique_wallets on one day, touching nothing else (issue #201).
 *
 * The history import lands on 789 days that mostly already hold real revenue and node
 * figures, so this is a targeted UPDATE rather than a snapshot upsert -- createDailySnapshot()
 * would rewrite every column from whatever the caller happened to pass, and a missing field
 * there becomes a NULL that silently erases history.
 *
 * Returns 'updated' or 'created'. A day with no snapshot gets a row marked
 * sync_status='backfilled', the same marker backfillRevenueSnapshots() uses, so a reader can
 * tell it was never a real day of collection.
 */
export async function setSnapshotWalletCount(date, uniqueWallets) {
    if (!Number.isInteger(uniqueWallets) || uniqueWallets <= 0) {
        throw new Error(`Refusing to write unique_wallets=${uniqueWallets} for ${date}: must be a positive integer`);
    }

    const updated = getDb()
        .prepare('UPDATE daily_snapshots SET unique_wallets = ? WHERE snapshot_date = ?')
        .run(uniqueWallets, date);

    if (updated.changes > 0) return 'updated';

    getDb().prepare(`
        INSERT INTO daily_snapshots (snapshot_date, timestamp, daily_revenue, unique_wallets, sync_status, created_at)
        VALUES (?, ?, 0, ?, 'backfilled', ?)
        ON CONFLICT(snapshot_date) DO UPDATE SET unique_wallets = excluded.unique_wallets
    `).run(date, new Date(`${date}T00:00:00Z`).getTime(), uniqueWallets, Date.now());

    return 'created';
}

/**
 * Fill columns that are still NULL on an existing snapshot row. Returns the names filled.
 *
 * A metric that ships mid-day finds that day's row already written, and shouldTakeSnapshot()
 * refuses to rewrite a day that already exists -- correctly, because a re-snapshot restates
 * every column from whatever current_metrics holds at that moment. Without this the new
 * column stays NULL for that one day forever and has to be written by hand, which is exactly
 * what unique_wallets needed on the day it shipped (#201).
 *
 * Deliberately narrow:
 *   - only columns that are currently NULL; a value already recorded is never restated
 *   - only real readings; null/undefined and 0 are skipped, since 0 means "collection
 *     failed" in a snapshot column and would swap one kind of missing for another
 *   - only an existing row; a day with no snapshot is left to the snapshot job, because
 *     creating one here would race it and leave a half-empty day
 *
 * COALESCE does the NULL check inside the statement rather than read-then-write, so a
 * concurrent snapshot cannot land between the two.
 */
export async function fillSnapshotNullColumns(date, columns) {
    const existing = await getSnapshotByDate(date);
    if (!existing) return [];

    const filled = [];
    for (const [column, value] of Object.entries(columns || {})) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        if (!(column in existing)) continue;      // column not on this table
        if (existing[column] != null) continue;   // already has a reading

        try {
            const result = getDb()
                .prepare(`UPDATE daily_snapshots SET ${column} = COALESCE(${column}, ?) WHERE snapshot_date = ?`)
                .run(value, date);
            if (result.changes > 0) filled.push(column);
        } catch (error) {
            log.warn(`fillSnapshotNullColumns(${date}.${column}): ${error.message}`);
        }
    }

    if (filled.length > 0) log.info(`Filled NULL snapshot columns for ${date}: ${filled.join(', ')}`);
    return filled;
}

/**
 * Overwrite specific per-game columns on one day (issue #231).
 *
 * Deliberately not fillSnapshotNullColumns(): that only ever fills a NULL, which is right
 * for the nightly top-up and wrong for this. The per-game columns changed meaning from an
 * image-only count to an app-name one, so the repair has to replace stored non-zero
 * readings -- gaming_valheim held 3 where 108 were running -- and has to be able to write
 * NULL for days that predate game_snapshots and therefore have no app-name record at all.
 *
 * `null` means "no reading"; `0` means "this game genuinely ran nothing". Both are written
 * as given. Columns the table does not have are skipped rather than failing the call, so a
 * database that has not run schemaMigrator yet degrades instead of erroring.
 *
 * @param {string} date  snapshot_date, YYYY-MM-DD
 * @param {Record<string, number|null>} values  column -> value
 * @returns {Promise<boolean>} whether a row was written
 */
export async function setSnapshotGameColumns(date, values) {
    const existing = await getSnapshotByDate(date);
    if (!existing) return false;

    const writable = Object.entries(values || {}).filter(([column]) => column in existing);
    if (writable.length === 0) return false;

    const assignments = writable.map(([column]) => `${column} = @${column}`).join(', ');
    const params = Object.fromEntries(writable);
    params.snapshot_date = date;

    getDb()
        .prepare(`UPDATE daily_snapshots SET ${assignments} WHERE snapshot_date = @snapshot_date`)
        .run(params);

    return true;
}

export async function getSnapshotByDate(date) {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots WHERE snapshot_date = ?').get(date) || null;
    } catch (error) {
        log.error(`getSnapshotByDate error: ${error.message}`);
        return null;
    }
}

export async function getLastNSnapshots(n = 30) {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC LIMIT ?').all(n);
    } catch (error) {
        throw readFailed('getLastNSnapshots', error);
    }
}

/**
 * Read failures on these four throw rather than returning an empty result.
 *
 * They feed the KPI report, which decides whether a metric has full day coverage before
 * reporting it. A swallowed error returning 0 or [] is indistinguishable from a period that
 * genuinely earned nothing, so a failed query used to render as a real figure -- "Flux 0.00,
 * -12,400.00, -100.0%" -- and get posted to Discord as fact. Every caller either sits inside
 * a try/catch or is a write path where aborting beats persisting a false zero.
 */
export async function getSnapshotsInRange(startDate, endDate) {
    try {
        return getDb().prepare(
            'SELECT * FROM daily_snapshots WHERE snapshot_date >= ? AND snapshot_date <= ? ORDER BY snapshot_date ASC'
        ).all(startDate, endDate);
    } catch (error) {
        log.error(`getSnapshotsInRange error: ${error.message}`);
        throw new Error(`getSnapshotsInRange failed: ${error.message}`);
    }
}

export async function getAllSnapshots() {
    try {
        return getDb().prepare('SELECT * FROM daily_snapshots ORDER BY snapshot_date DESC').all();
    } catch (error) {
        throw readFailed('getAllSnapshots', error);
    }
}

export async function deleteOldSnapshots(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    try {
        const result = getDb().prepare('DELETE FROM daily_snapshots WHERE snapshot_date < ?').run(cutoffDateStr);
        log.info(`[CLEANUP] Deleted ${result.changes} old snapshots (older than ${cutoffDateStr})`);
        return result.changes;
    } catch (error) {
        log.error(`deleteOldSnapshots error: ${error.message}`);
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
        log.error(`insertTransaction error: ${error.message}`);
    }
}

/** Message-metadata back-fill (issue #262): only rows with no metadata yet. Returns rows updated. */
export async function updateTransactionMetadataBatch(updates) {
    if (!updates || updates.length === 0) return 0;
    const stmt = getDb().prepare(`
        UPDATE revenue_transactions
        SET msg_type = @msg_type, enterprise = @enterprise, expire_blocks = @expire_blocks, instances = @instances
        WHERE txid = @txid AND msg_type IS NULL
    `);
    try {
        let updated = 0;
        getDb().transaction(rows => {
            for (const u of rows) {
                updated += stmt.run({
                    txid: u.txid,
                    msg_type: u.msg_type ?? null,
                    enterprise: u.enterprise == null ? null : (u.enterprise ? 1 : 0),
                    expire_blocks: u.expire_blocks ?? null,
                    instances: u.instances ?? null
                }).changes;
            }
        })(updates);
        return updated;
    } catch (error) {
        log.error(`updateTransactionMetadataBatch error: ${error.message}`);
        throw new Error(`updateTransactionMetadataBatch failed: ${error.message}`);
    }
}

export async function insertTransactionsBatch(transactions) {
    if (!transactions || transactions.length === 0) return true;

    const stmt = getDb().prepare(`
        INSERT OR IGNORE INTO revenue_transactions (txid, address, from_address, amount, amount_usd, block_height, timestamp, date, app_name, app_type, msg_type, enterprise, expire_blocks, instances)
        VALUES (@txid, @address, @from_address, @amount, @amount_usd, @block_height, @timestamp, @date, @app_name, @app_type, @msg_type, @enterprise, @expire_blocks, @instances)
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
                    app_type: tx.app_type || null,
                    msg_type: tx.msg_type ?? null,
                    enterprise: tx.enterprise == null ? null : (tx.enterprise ? 1 : 0),
                    expire_blocks: tx.expire_blocks ?? null,
                    instances: tx.instances ?? null
                });
            }
        });

        insertAll(transactions);
        log.info(`Inserted ${transactions.length} transactions`);
        return true;
    } catch (error) {
        log.error(`insertTransactionsBatch error: ${error.message}`);
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
        log.error(`getUndeterminedAppNames error: ${error.message}`);
        return [];
    }
}

export async function updateAppTypeForAppName(appName, appType) {
    try {
        getDb().prepare(
            'UPDATE revenue_transactions SET app_type = ? WHERE app_name = ? AND app_type IS NULL'
        ).run(appType, appName);
    } catch (error) {
        log.error(`updateAppTypeForAppName error: ${error.message}`);
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
        throw readFailed('getTxidsWithoutAppName', error);
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
        throw readFailed('countTxidsWithoutAppName', error);
    }
}

export async function updateAppNameForTxid(txid, appName, appType) {
    try {
        getDb().prepare(
            'UPDATE revenue_transactions SET app_name = ?, app_type = ? WHERE txid = ? AND app_name IS NULL'
        ).run(appName, appType, txid);
    } catch (error) {
        log.error(`updateAppNameForTxid error: ${error.message}`);
    }
}

export async function getTransactionsByDate(date) {
    try {
        return getDb().prepare('SELECT * FROM revenue_transactions WHERE date = ? LIMIT 10000').all(date);
    } catch (error) {
        throw readFailed('getTransactionsByDate', error);
    }
}

export async function getTransactionsByBlockRange(startBlock, endBlock) {
    try {
        return getDb().prepare(
            'SELECT * FROM revenue_transactions WHERE block_height >= ? AND block_height <= ? ORDER BY block_height DESC LIMIT 10000'
        ).all(startBlock, endBlock);
    } catch (error) {
        throw readFailed('getTransactionsByBlockRange', error);
    }
}

export async function getRevenueForDateRange(startDate, endDate) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_transactions WHERE date >= ? AND date <= ?'
        ).get(startDate, endDate);
        return row.total;
    } catch (error) {
        log.error(`getRevenueForDateRange error: ${error.message}`);
        throw new Error(`getRevenueForDateRange failed: ${error.message}`);
    }
}

/**
 * Revenue in a range that originated from a specific set of sender addresses.
 * Used to split "self-funded" (Flux team) revenue out of the headline total.
 */
export async function getRevenueFromAddressesForDateRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return { revenue: 0, payments: 0 };

    try {
        const placeholders = addresses.map(() => '?').join(',');
        const row = getDb().prepare(`
            SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS payments
            FROM revenue_transactions
            WHERE date >= ? AND date <= ? AND from_address IN (${placeholders})
        `).get(startDate, endDate, ...addresses);

        return { revenue: row.revenue || 0, payments: row.payments || 0 };
    } catch (error) {
        log.error(`getRevenueFromAddressesForDateRange error: ${error.message}`);
        throw new Error(`getRevenueFromAddressesForDateRange failed: ${error.message}`);
    }
}

export async function getPaymentCountForDateRange(startDate, endDate) {
    try {
        const row = getDb().prepare(
            'SELECT COUNT(*) AS cnt FROM revenue_transactions WHERE date >= ? AND date <= ?'
        ).get(startDate, endDate);
        return row.cnt || 0;
    } catch (error) {
        throw readFailed('getPaymentCountForDateRange', error);
    }
}

export async function getRevenueForBlockRange(startBlock, endBlock) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(amount), 0) AS total FROM revenue_transactions WHERE block_height >= ? AND block_height <= ?'
        ).get(startBlock, endBlock);
        return row.total;
    } catch (error) {
        throw readFailed('getRevenueForBlockRange', error);
    }
}

export async function getLastSyncedBlock() {
    try {
        const row = getDb().prepare(
            'SELECT block_height FROM revenue_transactions ORDER BY block_height DESC LIMIT 1'
        ).get();
        return row?.block_height || null;
    } catch (error) {
        log.error(`getLastSyncedBlock error: ${error.message}`);
        return null;
    }
}

export async function getTxidCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM revenue_transactions').get();
        return row.cnt || 0;
    } catch (error) {
        throw readFailed('getTxidCount', error);
    }
}

// RPC equivalent: get_transactions_paginated
export async function getTransactionsPaginated(page = 1, limit = 50, search = '', appName = null, fromAddresses = null) {
    const offset = (page - 1) * limit;

    try {
        let whereClauses = [];
        const params = {};

        // Payer filter (issue #159). AND-ed with the search/app predicate below rather than
        // folded into its either/or, so "team-funded payments for app alpha" is expressible.
        // An empty array means "no filter" rather than "match nothing" -- the UI sends the
        // selected badge set, and no badges selected has to mean show everything.
        if (Array.isArray(fromAddresses) && fromAddresses.length > 0) {
            const placeholders = fromAddresses.map((_, i) => `@fromAddr${i}`);
            whereClauses.push(`from_address IN (${placeholders.join(', ')})`);
            fromAddresses.forEach((addr, i) => { params[`fromAddr${i}`] = addr; });
        }

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
            ORDER BY block_height DESC, timestamp DESC, id DESC -- total order: offset paging (#294)
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
        log.error(`getTransactionsPaginated error: ${error.message}`);
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
        throw readFailed('getAppAnalytics', error);
    }
}

// RPC equivalent: get_daily_revenue
export async function getDailyRevenueFromTransactions(days = 30) {
    // days - 1: the range is inclusive of both ends, so "last 30 days" is today plus the
    // 29 before it. Subtracting `days` returned 31 rows and made the daily chart disagree
    // with the period totals in /api/analytics/comparison.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const startDate = cutoff.toISOString().split('T')[0];

    try {
        const rows = getDb().prepare(`
            SELECT date, SUM(amount) AS daily_revenue
            FROM revenue_transactions
            WHERE date >= ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate);

        log.info(`Retrieved daily revenue for ${rows.length} days from transactions`);
        return rows;
    } catch (error) {
        throw readFailed('getDailyRevenueFromTransactions', error);
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

        log.info(`Retrieved daily revenue for ${rows.length} days from transactions (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        throw readFailed('getDailyRevenueInRange', error);
    }
}

// RPC equivalent: get_daily_revenue_usd
export async function getDailyRevenueUSDFromTransactions(days = 30) {
    // days - 1: the range is inclusive of both ends, so "last 30 days" is today plus the
    // 29 before it. Subtracting `days` returned 31 rows and made the daily chart disagree
    // with the period totals in /api/analytics/comparison.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
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

        log.info(`Retrieved daily USD revenue for ${rows.length} days from transactions`);
        return rows;
    } catch (error) {
        throw readFailed('getDailyRevenueUSDFromTransactions', error);
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

        log.info(`Retrieved daily USD revenue for ${rows.length} days from transactions (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        log.error(`getDailyRevenueUSDInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueUSDInRange failed: ${error.message}`);
    }
}

// Team Funded historical trend (issue #146). Same shape as getDailyRevenueInRange(), with
// an address-list filter -- mirrors getRevenueFromAddressesForDateRange()'s placeholder
// pattern, just grouped by day instead of summed over the whole range.
// RPC equivalent: get_daily_revenue_from_addresses_in_range
// Daily revenue mix (issue #262 part 2) -- the SQLite twin of migration 020.
export async function getDailyRevenueMixInRange(startDate, endDate) {
    try {
        return getDb().prepare(`
            SELECT date,
                   SUM(amount) AS total_flux,
                   COALESCE(SUM(CASE WHEN msg_type = 'register' THEN amount END), 0) AS new_flux,
                   COALESCE(SUM(CASE WHEN msg_type = 'register' THEN COALESCE(amount_usd, 0) END), 0) AS new_usd,
                   COALESCE(SUM(CASE WHEN msg_type = 'update' THEN amount END), 0) AS update_flux,
                   COALESCE(SUM(CASE WHEN msg_type = 'update' THEN COALESCE(amount_usd, 0) END), 0) AS update_usd,
                   COALESCE(SUM(CASE WHEN enterprise = 1 THEN amount END), 0) AS enterprise_flux,
                   COALESCE(SUM(CASE WHEN enterprise = 1 THEN COALESCE(amount_usd, 0) END), 0) AS enterprise_usd,
                   COALESCE(SUM(expire_blocks / 2880.0), 0) AS commitment_days_sum,
                   COUNT(expire_blocks) AS commitment_payments
            FROM revenue_transactions
            WHERE date BETWEEN ? AND ?
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate, endDate);
    } catch (error) {
        log.error(`getDailyRevenueMixInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueMixInRange failed: ${error.message}`);
    }
}

// Payer base (issue #267) -- see the Supabase adapter / migration 018 for the definitions.
// "New" = the wallet's first payment ever (over the whole table) falls in that month.
export async function getMonthlyPayerStats(startDate, endDate, excludeAddresses = []) {
    const exclude = excludeAddresses ?? [];
    const placeholders = exclude.map(() => '?').join(',');
    const notExcluded = exclude.length ? `AND from_address NOT IN (${placeholders})` : '';
    try {
        return getDb().prepare(`
            WITH firsts AS (
                SELECT from_address, MIN(date) AS first_date
                FROM revenue_transactions
                WHERE from_address IS NOT NULL AND from_address <> 'Unknown' ${notExcluded}
                GROUP BY from_address
            ), monthly AS (
                SELECT DISTINCT substr(date, 1, 7) || '-01' AS month, from_address
                FROM revenue_transactions
                WHERE date BETWEEN ? AND ?
                  AND from_address IS NOT NULL AND from_address <> 'Unknown' ${notExcluded}
            )
            SELECT mo.month AS month,
                   COUNT(*) AS payers,
                   SUM(CASE WHEN substr(f.first_date, 1, 7) || '-01' = mo.month THEN 1 ELSE 0 END) AS new_payers
            FROM monthly mo
            JOIN firsts f ON f.from_address = mo.from_address
            GROUP BY mo.month
            ORDER BY mo.month ASC
        `).all(...exclude, startDate, endDate, ...exclude);
    } catch (error) {
        log.error(`getMonthlyPayerStats error: ${error.message}`);
        throw new Error(`getMonthlyPayerStats failed: ${error.message}`);
    }
}

export async function getAppRevenueConcentration() {
    try {
        const row = getDb().prepare(`
            WITH per_app AS (
                SELECT app_name, SUM(amount) AS revenue
                FROM revenue_transactions
                WHERE app_name IS NOT NULL
                GROUP BY app_name
            ), ranked AS (
                SELECT revenue,
                       ROW_NUMBER() OVER (ORDER BY revenue DESC, app_name) AS rank,
                       SUM(revenue) OVER (ORDER BY revenue DESC, app_name ROWS UNBOUNDED PRECEDING) AS running,
                       SUM(revenue) OVER () AS total
                FROM per_app
            )
            SELECT COALESCE(MAX(total), 0) AS total_revenue,
                   COUNT(*) AS app_count,
                   COALESCE(SUM(CASE WHEN rank <= 10 THEN revenue END), 0) AS top10_revenue,
                   COALESCE(MIN(CASE WHEN running >= 0.8 * total THEN rank END), 0) AS apps_for_80pct
            FROM ranked
        `).get();
        return {
            total_revenue: Number(row?.total_revenue) || 0,
            app_count: Number(row?.app_count) || 0,
            top10_revenue: Number(row?.top10_revenue) || 0,
            apps_for_80pct: Number(row?.apps_for_80pct) || 0
        };
    } catch (error) {
        log.error(`getAppRevenueConcentration error: ${error.message}`);
        throw new Error(`getAppRevenueConcentration failed: ${error.message}`);
    }
}

export async function getDailyRevenueFromAddressesInRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return [];

    try {
        const placeholders = addresses.map(() => '?').join(',');
        const rows = getDb().prepare(`
            SELECT date, SUM(amount) AS daily_revenue
            FROM revenue_transactions
            WHERE date BETWEEN ? AND ? AND from_address IN (${placeholders})
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate, endDate, ...addresses);

        log.info(`Retrieved daily revenue from ${addresses.length} addresses for ${rows.length} days (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        log.error(`getDailyRevenueFromAddressesInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueFromAddressesInRange failed: ${error.message}`);
    }
}

// RPC equivalent: get_daily_revenue_usd_from_addresses_in_range
export async function getDailyRevenueUSDFromAddressesInRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return [];

    try {
        const placeholders = addresses.map(() => '?').join(',');
        const rows = getDb().prepare(`
            SELECT date, SUM(COALESCE(amount_usd, 0)) AS daily_revenue_usd
            FROM revenue_transactions
            WHERE date BETWEEN ? AND ? AND from_address IN (${placeholders})
            GROUP BY date
            ORDER BY date ASC
        `).all(startDate, endDate, ...addresses);

        log.info(`Retrieved daily USD revenue from ${addresses.length} addresses for ${rows.length} days (${startDate} to ${endDate})`);
        return rows;
    } catch (error) {
        log.error(`getDailyRevenueUSDFromAddressesInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueUSDFromAddressesInRange failed: ${error.message}`);
    }
}

export async function deleteOldTransactions(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    try {
        const result = getDb().prepare('DELETE FROM revenue_transactions WHERE date < ?').run(cutoffDateStr);
        log.info(`[CLEANUP] Deleted ${result.changes} old transactions (older than ${cutoffDateStr})`);
        return result.changes;
    } catch (error) {
        log.error(`deleteOldTransactions error: ${error.message}`);
        return 0;
    }
}

export async function getTransactionsWithNullUsd(limit = 1000, offset = 0) {
    try {
        return getDb().prepare(
            'SELECT txid, amount, date, timestamp FROM revenue_transactions WHERE amount_usd IS NULL ORDER BY block_height DESC LIMIT ? OFFSET ?'
        ).all(limit, offset);
    } catch (error) {
        throw readFailed('getTransactionsWithNullUsd', error);
    }
}

export async function getOldestTransactionDate() {
    try {
        const row = getDb().prepare(
            'SELECT date FROM revenue_transactions ORDER BY date ASC LIMIT 1'
        ).get();
        return row ? row.date : null;
    } catch (error) {
        log.error(`getOldestTransactionDate error: ${error.message}`);
        return null;
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
        log.info(`Updated USD for ${updates.length} transactions`);
        return true;
    } catch (error) {
        log.error(`updateTransactionUsdBatch error: ${error.message}`);
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
        log.error(`upsertFailedTxid error: ${error.message}`);
    }
}

export async function getUnresolvedFailedTxids(limit = 200) {
    try {
        return getDb().prepare(
            'SELECT txid, address, failure_reason, attempt_count, first_seen, last_attempt FROM failed_txids WHERE resolved = 0 ORDER BY attempt_count ASC, last_attempt ASC LIMIT ?'
        ).all(limit);
    } catch (error) {
        throw readFailed('getUnresolvedFailedTxids', error);
    }
}

export async function resolveFailedTxid(txid) {
    try {
        getDb().prepare('UPDATE failed_txids SET resolved = 1 WHERE txid = ?').run(txid);
    } catch (error) {
        log.error(`resolveFailedTxid error: ${error.message}`);
    }
}

export async function getFailedTxidCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM failed_txids WHERE resolved = 0').get();
        return row.cnt || 0;
    } catch (error) {
        throw readFailed('getFailedTxidCount', error);
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
        log.error(`clearAbandonedFailedTxids error: ${error.message}`);
        return 0;
    }
}

export async function isFailedTxid(txid) {
    try {
        return getDb().prepare('SELECT * FROM failed_txids WHERE txid = ? AND resolved = 0').get(txid) || null;
    } catch (error) {
        log.error(`isFailedTxid error: ${error.message}`);
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
        log.error(`getSyncStatus error: ${error.message}`);
        return null;
    }
}

export async function updateSyncStatus(syncType, status, errorMessage = null, lastBlock = null) {
    try {
        // Upsert, not UPDATE: rows for new sync types (e.g. the KPI scheduler's
        // kpi_daily/kpi_weekly receipts) do not exist until first written — a plain
        // UPDATE would match 0 rows and silently no-op, breaking dedupe forever.
        // ON CONFLICT DO UPDATE preserves columns not in the payload (next_sync).
        getDb().prepare(
            `INSERT INTO sync_status (sync_type, last_sync, last_sync_block, status, error_message)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(sync_type) DO UPDATE SET
                last_sync = excluded.last_sync,
                -- a null block keeps the stored cursor (issue #335); see the Supabase adapter
                last_sync_block = COALESCE(excluded.last_sync_block, sync_status.last_sync_block),
                status = excluded.status,
                error_message = excluded.error_message`
        ).run(syncType, Date.now(), lastBlock, status, errorMessage);
    } catch (error) {
        log.error(`updateSyncStatus error: ${error.message}`);
    }
}

export async function resetRevenueSyncBlock() {
    try {
        getDb().prepare('UPDATE sync_status SET last_sync_block = NULL WHERE sync_type = ?').run('revenue');
    } catch (error) {
        log.error(`resetRevenueSyncBlock error: ${error.message}`);
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
        log.error(`clearRevenueData error: ${error.message}`);
        return 0;
    }
}

export async function setNextSync(syncType, nextSyncTime) {
    try {
        getDb().prepare('UPDATE sync_status SET next_sync = ? WHERE sync_type = ?').run(nextSyncTime, syncType);
    } catch (error) {
        log.error(`setNextSync error: ${error.message}`);
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
        log.info(`Inserted/updated ${prices.length} price history rows`);
        return true;
    } catch (error) {
        log.error(`insertPriceHistoryBatch error: ${error.message}`);
        return false;
    }
}

export async function getPriceForDate(date) {
    try {
        const row = getDb().prepare('SELECT price_usd FROM flux_price_history WHERE date = ?').get(date);
        return row ? row.price_usd : null;
    } catch (error) {
        log.error(`getPriceForDate error: ${error.message}`);
        return null;
    }
}

export async function getPricesForDateRange(startDate, endDate) {
    try {
        return getDb().prepare(
            'SELECT date, price_usd FROM flux_price_history WHERE date >= ? AND date <= ? ORDER BY date ASC'
        ).all(startDate, endDate);
    } catch (error) {
        throw readFailed('getPricesForDateRange', error);
    }
}

export async function getLatestPriceDate() {
    try {
        const row = getDb().prepare('SELECT date FROM flux_price_history ORDER BY date DESC LIMIT 1').get();
        return row ? row.date : null;
    } catch (error) {
        log.error(`getLatestPriceDate error: ${error.message}`);
        return null;
    }
}

export async function getOldestPriceDate() {
    try {
        const row = getDb().prepare('SELECT date FROM flux_price_history ORDER BY date ASC LIMIT 1').get();
        return row ? row.date : null;
    } catch (error) {
        log.error(`getOldestPriceDate error: ${error.message}`);
        return null;
    }
}

export async function getPriceHistoryCount() {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM flux_price_history').get();
        return row.cnt || 0;
    } catch (error) {
        throw readFailed('getPriceHistoryCount', error);
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Row counts; `{ lean: true }` is just the two the header shows (issue #301). */
export async function getDatabaseStats({ lean = false } = {}) {
    try {
        const d = getDb();
        const snapshots = d.prepare('SELECT COUNT(*) AS cnt FROM daily_snapshots').get().cnt;
        const transactions = d.prepare('SELECT COUNT(*) AS cnt FROM revenue_transactions').get().cnt;
        if (lean) return { snapshots, transactions };
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
        log.error(`getDatabaseStats error: ${error.message}`);
        return { snapshots: 0, transactions: 0, priceHistory: 0, repoSnapshots: 0, distinctRepos: 0, dbSizeKB: null, dbPath: DB_PATH, isWriter: true, instanceId: 'sqlite' };
    }
}

export async function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        log.info('[DB] SQLite database closed');
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
        log.error(`createRepoSnapshots error: ${error.message}`);
        return 0;
    }
}

export async function getRepoSnapshotCountByDate(date) {
    try {
        const row = getDb().prepare('SELECT COUNT(*) AS cnt FROM repo_snapshots WHERE snapshot_date = ?').get(date);
        return row.cnt || 0;
    } catch (error) {
        throw readFailed('getRepoSnapshotCountByDate', error);
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
        throw readFailed('getRepoHistory', error);
    }
}

// RPC equivalent: get_distinct_repos
export async function getDistinctRepos() {
    try {
        const rows = getDb().prepare('SELECT DISTINCT image_name FROM repo_snapshots ORDER BY image_name').all();
        return rows.map(r => r.image_name);
    } catch (error) {
        throw readFailed('getDistinctRepos', error);
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
        throw readFailed('getLatestRepoSnapshot', error);
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

        // One row per FULL image name, tag included -- see the Supabase adapter (issue #305).
        const repos = getDb().prepare(`
            SELECT image_name, instance_count
            FROM repo_snapshots
            WHERE category = ? AND snapshot_date = ?
            ORDER BY instance_count DESC, image_name ASC
            LIMIT ?
        `).all(category, dateRow.d, limit);

        return { date: dateRow.d, repos };
    } catch (error) {
        throw readFailed('getTopReposByCategory', error);
    }
}

export async function getCategoryTotal(category, date) {
    try {
        const row = getDb().prepare(
            'SELECT COALESCE(SUM(instance_count), 0) AS total FROM repo_snapshots WHERE category = ? AND snapshot_date = ?'
        ).get(category, date);
        return row.total;
    } catch (error) {
        throw readFailed('getCategoryTotal', error);
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
        throw readFailed('getCategoryHistory', error);
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
        throw readFailed('getReposByCategory', error);
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
        log.info(`Backfilled categories for ${updated} of ${rows.length} distinct images`);
        return rows.length;
    } catch (error) {
        log.error(`backfillRepoCategories error: ${error.message}`);
        return 0;
    }
}

export async function recategorizeAllRepos() {
    try {
        const d = getDb();

        const rows = d.prepare('SELECT DISTINCT image_name FROM repo_snapshots').all();

        // Every image gets its category in one update, null included -- no global reset
        // first (issues #222/#304), and the whole pass is one transaction.
        const stmt = d.prepare('UPDATE repo_snapshots SET category = ? WHERE image_name = ?');
        const counts = {};

        const updateAll = d.transaction((images) => {
            for (const row of images) {
                const cat = categorizeImage(row.image_name);
                stmt.run(cat, row.image_name);
                if (cat) counts[cat] = (counts[cat] || 0) + 1;
            }
        });

        updateAll(rows);
        log.info({ counts }, `Re-categorized ${rows.length} images`);
        return { resetCount: rows.length, categorized: counts };
    } catch (error) {
        log.error(`recategorizeAllRepos error: ${error.message}`);
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

export async function exportAllGameSnapshots() {
    try {
        return getDb().prepare('SELECT * FROM game_snapshots ORDER BY snapshot_date ASC').all();
    } catch (error) {
        throw new Error(`Export game_snapshots failed: ${error.message}`);
    }
}

export async function upsertGameSnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO game_snapshots (snapshot_date, game_name, instance_count, created_at)
        VALUES (@snapshot_date, @game_name, @instance_count, @created_at)
        ON CONFLICT(snapshot_date, game_name) DO UPDATE SET
            instance_count = @instance_count
    `);

    const insertAll = getDb().transaction((items) => {
        for (const row of items) {
            stmt.run({
                snapshot_date: row.snapshot_date,
                game_name: row.game_name,
                instance_count: row.instance_count,
                created_at: row.created_at || Date.now()
            });
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

// ============================================
// NODE IP CLASSIFICATION (decentralization metric, issue #108)
// ============================================

/**
 * Every classified node IP. Carries asn even though the stats/grouping callers ignore it:
 * reclassifyStoredDatacenterFlags() (issue #196) writes rows from this projection straight
 * back through upsertNodeIpClassifications(), which sets every column, so a projection that
 * dropped asn would silently null it for every re-flagged row. SQLite has no row-count cap
 * the way PostgREST does, so this is a plain unpaginated SELECT.
 */
export async function getAllNodeIpClassifications() {
    const rows = getDb().prepare('SELECT ip, asn, org, is_datacenter, classified_at, country, country_code, continent, continent_code FROM node_ip_classification').all();
    return rows.map(row => ({
        ip: row.ip,
        asn: row.asn,
        org: row.org,
        isDatacenter: !!row.is_datacenter,
        classifiedAt: row.classified_at,
        country: row.country,
        countryCode: row.country_code,
        continent: row.continent,
        continentCode: row.continent_code
    }));
}

export async function upsertNodeIpClassifications(rows) {
    if (!rows || rows.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO node_ip_classification (ip, asn, org, is_datacenter, classified_at, country, country_code, continent, continent_code)
        VALUES (@ip, @asn, @org, @is_datacenter, @classified_at, @country, @country_code, @continent, @continent_code)
        ON CONFLICT(ip) DO UPDATE SET
            asn = @asn,
            org = @org,
            is_datacenter = @is_datacenter,
            classified_at = @classified_at,
            country = @country,
            country_code = @country_code,
            continent = @continent,
            continent_code = @continent_code
    `);

    const insertAll = getDb().transaction((items) => {
        for (const row of items) {
            stmt.run({
                ip: row.ip,
                asn: row.asn ?? null,
                org: row.org ?? null,
                is_datacenter: row.isDatacenter ? 1 : 0,
                classified_at: row.classifiedAt,
                country: row.country ?? null,
                country_code: row.countryCode ?? null,
                continent: row.continent ?? null,
                continent_code: row.continentCode ?? null
            });
        }
    });

    insertAll(rows);
    return rows.length;
}

// ============================================
// DECENTRALIZATION SNAPSHOTS (historical per-provider breakdown, issue #108 Phase 3)
// ============================================

/**
 * Write one dimension's breakdown for a date (issue #151).
 *
 * One implementation for datacenter, country and continent, which were three copies of this
 * differing only in table and column names. Those names come from the dimension whitelist in
 * decentralizationDimensions.js and never from a caller's string: SQL identifiers cannot be
 * bound as parameters, so an unrecognised key has to throw rather than reach a query.
 */
export async function createDecentralizationDimensionSnapshots(dimensionKey, snapshotDate, breakdown) {
    if (!breakdown || breakdown.length === 0) return 0;

    const dimension = resolveDimension(dimensionKey);
    const hasCode = Boolean(dimension.codeColumn);

    const columns = [
        'snapshot_date',
        dimension.nameColumn,
        ...(hasCode ? [dimension.codeColumn] : []),
        'node_count',
        'created_at'
    ];
    const updates = [
        ...(hasCode ? [`${dimension.codeColumn} = @${dimension.codeColumn}`] : []),
        'node_count = @node_count'
    ];

    const stmt = getDb().prepare(`
        INSERT INTO ${dimension.table} (${columns.join(', ')})
        VALUES (${columns.map(column => `@${column}`).join(', ')})
        ON CONFLICT(snapshot_date, ${dimension.nameColumn}) DO UPDATE SET
            ${updates.join(',\n            ')}
    `);

    const insertAll = getDb().transaction((items) => {
        for (const item of items) {
            const params = {
                snapshot_date: snapshotDate,
                [dimension.nameColumn]: item[dimension.nameField],
                node_count: item.count,
                created_at: Date.now()
            };
            if (hasCode) params[dimension.codeColumn] = item[dimension.codeField] ?? null;
            stmt.run(params);
        }
    });

    insertAll(breakdown);
    return breakdown.length;
}

/** Inclusive date range, ordered by date then node_count desc -- backs the CSV export
 *  and the KPI top-3-for-period computation. */
export async function getDecentralizationDimensionSnapshotHistory(dimensionKey, startDate, endDate) {
    const dimension = resolveDimension(dimensionKey);
    const columns = [
        'snapshot_date',
        dimension.nameColumn,
        ...(dimension.codeColumn ? [dimension.codeColumn] : []),
        'node_count'
    ];

    return getDb().prepare(`
        SELECT ${columns.join(', ')}
        FROM ${dimension.table}
        WHERE snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC, node_count DESC
    `).all(startDate, endDate);
}

export async function createDecentralizationSnapshots(snapshotDate, breakdown) {
    return createDecentralizationDimensionSnapshots('datacenter', snapshotDate, breakdown);
}

export async function getDecentralizationSnapshotHistory(startDate, endDate) {
    return getDecentralizationDimensionSnapshotHistory('datacenter', startDate, endDate);
}

// ============================================
// GAME SNAPSHOTS (issue #163)
// ============================================

export async function createGameSnapshots(snapshotDate, games) {
    if (!games || games.length === 0) return 0;

    const stmt = getDb().prepare(`
        INSERT INTO game_snapshots (snapshot_date, game_name, instance_count, created_at)
        VALUES (@snapshot_date, @game_name, @instance_count, @created_at)
        ON CONFLICT(snapshot_date, game_name) DO UPDATE SET
            instance_count = @instance_count
    `);

    const insertAll = getDb().transaction((items) => {
        for (const item of items) {
            stmt.run({
                snapshot_date: snapshotDate,
                game_name: item.name,
                instance_count: item.instances,
                created_at: Date.now()
            });
        }
    });

    insertAll(games);
    return games.length;
}

/** Per-game counts for one date. Empty when that date was never snapshotted. */
export async function getGameSnapshotsByDate(snapshotDate) {
    return getDb().prepare(`
        SELECT game_name, instance_count
        FROM game_snapshots
        WHERE snapshot_date = ?
        ORDER BY instance_count DESC
    `).all(snapshotDate);
}

/**
 * Per-game counts across a date range (issue #175) -- backs the Historical Performance
 * chart's Gaming category.
 *
 * A game with no row on a date is genuinely absent from the result, never filled in as 0:
 * the chart has to draw that as a gap, because "we took no reading" and "nobody ran it" are
 * different claims and only the first one is true on a day the collection failed.
 */
export async function getGameSnapshotHistory(startDate, endDate) {
    return getDb().prepare(`
        SELECT snapshot_date, game_name, instance_count
        FROM game_snapshots
        WHERE snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC, instance_count DESC
    `).all(startDate, endDate);
}

// ============================================
// DECENTRALIZATION COUNTRY/CONTINENT SNAPSHOTS (issue #138)
// ============================================

// Country/continent are the same write and the same read as the datacenter dimension,
// differing only in table and column names -- they are named entry points onto the
// generic pair above (issue #151).

export async function createDecentralizationCountrySnapshots(snapshotDate, breakdown) {
    return createDecentralizationDimensionSnapshots('country', snapshotDate, breakdown);
}

export async function getDecentralizationCountrySnapshotHistory(startDate, endDate) {
    return getDecentralizationDimensionSnapshotHistory('country', startDate, endDate);
}

export async function createDecentralizationContinentSnapshots(snapshotDate, breakdown) {
    return createDecentralizationDimensionSnapshots('continent', snapshotDate, breakdown);
}

export async function getDecentralizationContinentSnapshotHistory(startDate, endDate) {
    return getDecentralizationDimensionSnapshotHistory('continent', startDate, endDate);
}

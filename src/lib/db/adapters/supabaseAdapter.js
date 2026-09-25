import { supabase } from '../supabaseClient.js';
import { categorizeImage, METRIC_COLUMNS, TRACKED_GAMES, CRYPTO_REPOS } from '../../config.js';
import { createLogger } from '../../logger.js';
import { resolveDimension } from '../../decentralizationDimensions.js';

const log = createLogger('supabaseAdapter');

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
// INITIALIZATION
// ============================================

let _dbReady = false;

export function isDbReady() {
    return _dbReady;
}

/**
 * Active health probe — lightweight query with a short timeout.
 * Returns true if DB responds, false otherwise. Updates _dbReady.
 */
export async function probeDb() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const { error } = await supabase
            .from('current_metrics')
            .select('id', { count: 'exact', head: true })
            .abortSignal(controller.signal);

        clearTimeout(timeout);

        if (error) {
            _dbReady = false;
            return false;
        }
        _dbReady = true;
        return true;
    } catch {
        _dbReady = false;
        return false;
    }
}

export async function initDatabase() {
    try {
        // Verify connection by reading the singleton current_metrics row
        const { data, error } = await supabase
            .from('current_metrics')
            .select('id')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw new Error(`Supabase connection check failed: ${error.message}`);
        }

        // Ensure the singleton row exists
        if (!data) {
            await supabase
                .from('current_metrics')
                .upsert({ id: 1, last_update: 0 }, { onConflict: 'id' });
        }

        // NOTE: Partial index idx_rt_usd_null added via migration 004_partial_index_usd_null.sql
        // Run it in Supabase SQL editor if not applied yet:
        //   CREATE INDEX IF NOT EXISTS idx_rt_usd_null ON revenue_transactions(txid) WHERE amount_usd IS NULL;

        // Run schema migration (adds dynamic columns if needed)
        try {
            log.info('[SCHEMA] Checking for schema updates...');
            const config = await import('../../config.js');
            const { migrateSchema } = await import('../schemaMigrator.js');
            const migrationResult = await migrateSchema(config);
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
            const { count } = await supabase
                .from('repo_snapshots')
                .select('image_name', { count: 'exact', head: true })
                .is('category', null);
            if (count > 0) {
                log.info(`[BACKFILL] Backfilling categories for ${count} uncategorized images...`);
                setTimeout(async () => {
                    try { await backfillRepoCategories(); } catch(e) { log.warn(`Backfill error: ${e.message}`); }
                }, 100);
            }
        } catch (e) {
            log.warn(`Category backfill check skipped: ${e.message}`);
        }

        _dbReady = true;
        log.info('[DB] Database initialized successfully (Supabase)');
    } catch (error) {
        _dbReady = false;
        log.error({ err: error }, '[DB] Database initialization error');
        throw error;
    }
}

/**
 * Initialize database with retry and exponential backoff.
 * Up to 10 attempts (~5 minutes total). Does not throw — returns success/failure.
 */
export async function ensureInitialized() {
    const MAX_ATTEMPTS = 10;
    let delay = 2000; // start at 2s

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await initDatabase();
            return true;
        } catch (error) {
            log.warn(`[DB] DB init attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
            if (attempt < MAX_ATTEMPTS) {
                log.info(`Retrying in ${Math.round(delay / 1000)}s...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 60_000); // cap at 60s
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
    const { data, error } = await supabase
        .from('current_metrics')
        .select('*')
        .eq('id', 1)
        // maybeSingle: a missing row is "no metrics yet" (null), not an error -- .single()
        // reports it as PGRST116, which would now throw on a fresh database (#307).
        .maybeSingle();

    if (error) {
        throw readFailed('getCurrentMetrics', error);
    }
    return data;
}

export async function updateCurrentMetrics(metrics) {
    const current = await getCurrentMetrics();
    if (!current) return;

    const mergedMetrics = { last_update: Date.now() };

    // Only touch columns the table actually has — METRIC_COLUMNS grows with the repo config
    // and schemaMigrator may not have added the newest ones yet.
    for (const key of METRIC_COLUMNS) {
        if (!(key in current)) continue;
        mergedMetrics[key] = metrics[key] ?? current[key] ?? null;
    }

    const { error } = await supabase
        .from('current_metrics')
        .update(mergedMetrics)
        .eq('id', 1);

    // Throws rather than logs-and-returns (issue #220): callers follow this with
    // updateSyncStatus(..., 'completed'), so swallowing the error records a sync that
    // wrote nothing.
    if (error) throw new Error(`updateCurrentMetrics failed: ${error.message}`);
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
    const { data, error } = await supabase
        .from('daily_snapshots')
        .update({ daily_revenue: dailyRevenue })
        .eq('snapshot_date', snapshotDate)
        .select('snapshot_date');

    if (error) throw new Error(`Update daily_snapshots.daily_revenue failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
}

export async function createDailySnapshot(snapshot) {
    const row = {
        snapshot_date: snapshot.snapshot_date,
        timestamp: snapshot.timestamp,
        daily_revenue: snapshot.daily_revenue,
        flux_price_usd: snapshot.flux_price_usd,
        total_cpu_cores: snapshot.total_cpu_cores,
        used_cpu_cores: snapshot.used_cpu_cores,
        cpu_utilization_percent: snapshot.cpu_utilization_percent,
        total_ram_gb: snapshot.total_ram_gb,
        used_ram_gb: snapshot.used_ram_gb,
        ram_utilization_percent: snapshot.ram_utilization_percent,
        total_storage_gb: snapshot.total_storage_gb,
        used_storage_gb: snapshot.used_storage_gb,
        storage_utilization_percent: snapshot.storage_utilization_percent,
        total_apps: snapshot.total_apps,
        watchtower_count: snapshot.watchtower_count,
        gitapps_count: snapshot.gitapps_count,
        dockerapps_count: snapshot.dockerapps_count,
        gitapps_percent: snapshot.gitapps_percent,
        dockerapps_percent: snapshot.dockerapps_percent,
        // Gaming and crypto columns are DERIVED FROM CONFIG here too (issue #229). The
        // snapshot builder, this adapter and its Supabase twin each enumerated them
        // literally, so a game added to GAMING_REPOS had to be remembered in THREE places
        // -- and was not. Deriving all three from the same config list is what makes the
        // documented "adding a repo to config is enough" actually true.
        gaming_apps_total: snapshot.gaming_apps_total,
        gaming_instances_total: snapshot.gaming_instances_total,
        ...Object.fromEntries(TRACKED_GAMES.map(g => [g.dbKey, snapshot[g.dbKey] ?? null])),
        ...Object.fromEntries(CRYPTO_REPOS.map(r => [r.dbKey, snapshot[r.dbKey] ?? null])),
        crypto_nodes_total: snapshot.crypto_nodes_total,
        wordpress_count: snapshot.wordpress_count,
        node_cumulus: snapshot.node_cumulus,
        node_nimbus: snapshot.node_nimbus,
        node_stratus: snapshot.node_stratus,
        node_total: snapshot.node_total,
        // `?? null` rather than bare, like the nullable columns below: a service failure
        // leaves these unset and a fabricated 0 would record "no operators today" as a
        // real reading. unique_wallets was omitted from this row when #201 shipped and
        // survived only via snapshotManager's NULL top-up; both are written here now.
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

    const { error } = await supabase
        .from('daily_snapshots')
        .upsert(row, { onConflict: 'snapshot_date' });

    // Throws rather than logs-and-returns (issue #220), matching every sibling snapshot
    // writer. takeSnapshot()'s own try/catch turns this into { success: false }, which is
    // what stops a lost day from resetting the failure counter and firing a backup.
    if (error) throw new Error(`createDailySnapshot failed for ${snapshot.snapshot_date}: ${error.message}`);
    log.info(`Snapshot created for ${snapshot.snapshot_date}`);
}

/**
 * Set unique_wallets on one day, touching nothing else (issue #201).
 *
 * See the SQLite twin for why this is a targeted UPDATE rather than a snapshot upsert: the
 * history import lands on days that already hold real revenue and node figures, and
 * createDailySnapshot() would rewrite every column from whatever the caller passed.
 *
 * Returns 'updated' or 'created'. The UPDATE is issued first and its returned rows tell us
 * which happened -- checking existence separately would race a concurrent nightly snapshot.
 */
export async function setSnapshotWalletCount(date, uniqueWallets) {
    if (!Number.isInteger(uniqueWallets) || uniqueWallets <= 0) {
        throw new Error(`Refusing to write unique_wallets=${uniqueWallets} for ${date}: must be a positive integer`);
    }

    const { data: updatedRows, error: updateError } = await supabase
        .from('daily_snapshots')
        .update({ unique_wallets: uniqueWallets })
        .eq('snapshot_date', date)
        .select('snapshot_date');

    if (updateError) throw new Error(`setSnapshotWalletCount(${date}) update failed: ${updateError.message}`);
    if (updatedRows && updatedRows.length > 0) return 'updated';

    const { error: insertError } = await supabase
        .from('daily_snapshots')
        .upsert({
            snapshot_date: date,
            timestamp: new Date(`${date}T00:00:00Z`).getTime(),
            daily_revenue: 0,
            unique_wallets: uniqueWallets,
            sync_status: 'backfilled'
        }, { onConflict: 'snapshot_date' });

    if (insertError) throw new Error(`setSnapshotWalletCount(${date}) insert failed: ${insertError.message}`);
    return 'created';
}

/**
 * Fill columns that are still NULL on an existing snapshot row. Returns the names filled.
 *
 * See the SQLite twin for the reasoning. Same three rules: NULL columns only, real readings
 * only (0 means "collection failed" in a snapshot column), existing rows only.
 *
 * One UPDATE per column, each carrying its own `.is(column, null)` filter, so the NULL check
 * happens in the statement rather than between a read and a write. PostgREST has no COALESCE
 * in an update, and a single multi-column update could only guard one column -- the others
 * would be restated blind. In practice this loops over the one or two columns a newly shipped
 * metric left behind.
 */
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

    // One update for every column, not one per column: this runs across hundreds of days.
    const { error } = await supabase
        .from('daily_snapshots')
        .update(Object.fromEntries(writable))
        .eq('snapshot_date', date);

    if (error) throw new Error(`setSnapshotGameColumns failed for ${date}: ${error.message}`);
    return true;
}

export async function fillSnapshotNullColumns(date, columns) {
    const existing = await getSnapshotByDate(date);
    if (!existing) return [];

    const filled = [];
    for (const [column, value] of Object.entries(columns || {})) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        if (!(column in existing)) continue;
        if (existing[column] != null) continue;

        const { data, error } = await supabase
            .from('daily_snapshots')
            .update({ [column]: value })
            .eq('snapshot_date', date)
            .is(column, null)
            .select('snapshot_date');

        if (error) {
            log.warn(`fillSnapshotNullColumns(${date}.${column}): ${error.message}`);
            continue;
        }
        if (data && data.length > 0) filled.push(column);
    }

    if (filled.length > 0) log.info(`Filled NULL snapshot columns for ${date}: ${filled.join(', ')}`);
    return filled;
}

export async function getSnapshotByDate(date) {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .eq('snapshot_date', date)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getSnapshotByDate error: ${error.message}`);
    }
    return data || null;
}

/**
 * Must page. `.limit(n)` is a no-op past db-max-rows (1000) — the Chart's "All" timeframe
 * asks for 9999 days and used to get 1000 with no error (issue #217).
 */
export async function getLastNSnapshots(n = 30) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (offset < n) {
        const take = Math.min(PAGE_SIZE, n - offset);
        const { data, error } = await supabase
            .from('daily_snapshots')
            .select('*')
            .order('snapshot_date', { ascending: false })
            .range(offset, offset + take - 1);

        if (error) {
            throw readFailed('getLastNSnapshots', error);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < take) break;
        offset += take;
    }

    return rows;
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
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    // Must page (issue #217). A truncated range is the worst failure this function can have:
    // the KPI report requires 100% day coverage, so silently losing the tail of a range
    // renders a metric "Insufficient data" — or worse, averages a partial period as fact.
    while (true) {
        const { data, error } = await supabase
            .from('daily_snapshots')
            .select('*')
            .gte('snapshot_date', startDate)
            .lte('snapshot_date', endDate)
            .order('snapshot_date', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            log.error(`getSnapshotsInRange error: ${error.message}`);
            throw new Error(`getSnapshotsInRange failed: ${error.message}`);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

/**
 * Must page — see exportAllRepoSnapshots() for the identical pattern. PostgREST caps every
 * response at db-max-rows (1000), and this table gains a row a day: the 2.25 years of
 * imported wallet history (#201) already put it within a few months of that cap, at which
 * point an unpaged select would silently drop the OLDEST days with no error. The collateral
 * backfill (#210) reads this, so a truncation would leave early history permanently NULL.
 */
export async function getAllSnapshots() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('daily_snapshots')
            .select('*')
            .order('snapshot_date', { ascending: false })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw readFailed('getAllSnapshots', error);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function deleteOldSnapshots(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('daily_snapshots')
        .delete()
        .lt('snapshot_date', cutoffDateStr)
        .select('id');

    const count = data?.length || 0;
    if (error) {
        log.error(`deleteOldSnapshots error: ${error.message}`);
    } else {
        log.info(`[CLEANUP] Deleted ${count} old snapshots (older than ${cutoffDateStr})`);
    }
    return count;
}

// ============================================
// REVENUE TRANSACTIONS OPERATIONS
// ============================================

export async function insertTransaction(tx) {
    const { error } = await supabase
        .from('revenue_transactions')
        .upsert({
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
        }, { onConflict: 'txid', ignoreDuplicates: true });

    if (error) {
        log.error(`insertTransaction error: ${error.message}`);
    }
}

// Message-metadata columns (issue #262, migration 019). Until the migration is applied the
// columns do not exist, and PostgREST rejects the whole insert -- which would stop the
// revenue sync outright. So a missing-column rejection retries the chunk without them and
// remembers not to send them again this process: new payments keep landing either way.
const METADATA_FIELDS = ['msg_type', 'enterprise', 'expire_blocks', 'instances'];
let metadataColumnsMissing = false;

function isMissingColumnError(error) {
    return error?.code === 'PGRST204' || /column .* (does not exist|of 'revenue_transactions')/i.test(error?.message ?? '');
}

export async function insertTransactionsBatch(transactions) {
    if (!transactions || transactions.length === 0) return true;

    const rows = transactions.map(tx => ({
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
        enterprise: tx.enterprise ?? null,
        expire_blocks: tx.expire_blocks ?? null,
        instances: tx.instances ?? null
    }));
    const withoutMetadata = row => {
        const copy = { ...row };
        for (const field of METADATA_FIELDS) delete copy[field];
        return copy;
    };

    // Chunk into batches of 500 to respect Supabase limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        let chunk = rows.slice(i, i + CHUNK_SIZE);
        if (metadataColumnsMissing) chunk = chunk.map(withoutMetadata);
        let { error } = await supabase
            .from('revenue_transactions')
            .upsert(chunk, { onConflict: 'txid', ignoreDuplicates: true });

        if (error && !metadataColumnsMissing && isMissingColumnError(error)) {
            metadataColumnsMissing = true;
            log.warn('revenue_transactions has no message-metadata columns yet -- inserting without them (apply migration 019)');
            ({ error } = await supabase
                .from('revenue_transactions')
                .upsert(chunk.map(withoutMetadata), { onConflict: 'txid', ignoreDuplicates: true }));
        }

        if (error) {
            log.error(`insertTransactionsBatch chunk error (offset ${i}): ${error.message}`);
            return false;
        }
    }

    log.info(`Inserted ${transactions.length} transactions`);
    return true;
}

/**
 * Must page (issue #227). Unpaged, the app-type backfill only ever saw an arbitrary 1000-row
 * slice, so names outside it stayed undetermined forever with no error to say why.
 */
export async function getUndeterminedAppNames() {
    const names = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('revenue_transactions')
            .select('app_name')
            .not('app_name', 'is', null)
            .neq('app_name', '')
            .is('app_type', null)
            .order('id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            log.error(`getUndeterminedAppNames error: ${error.message}`);
            break;
        }
        if (!data || data.length === 0) break;

        names.push(...data.map(r => r.app_name));
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    // Deduplicate
    return [...new Set(names)];
}

export async function updateAppTypeForAppName(appName, appType) {
    const { error } = await supabase
        .from('revenue_transactions')
        .update({ app_type: appType })
        .eq('app_name', appName)
        .is('app_type', null);

    if (error) {
        log.error(`updateAppTypeForAppName error: ${error.message}`);
    }
}

export async function getTxidsWithoutAppName(limit = 500, recentDays = null) {
    let query = supabase
        .from('revenue_transactions')
        .select('txid')
        .is('app_name', null)
        .order('block_height', { ascending: false })
        .limit(limit);

    if (recentDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - Math.floor(recentDays));
        query = query.gte('date', cutoff.toISOString().split('T')[0]);
    }

    const { data, error } = await query;
    if (error) {
        throw readFailed('getTxidsWithoutAppName', error);
    }
    return (data || []).map(r => r.txid);
}

export async function countTxidsWithoutAppName(recentDays = null) {
    let query = supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true })
        .is('app_name', null);

    if (recentDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - Math.floor(recentDays));
        query = query.gte('date', cutoff.toISOString().split('T')[0]);
    }

    const { count, error } = await query;
    if (error) {
        throw readFailed('countTxidsWithoutAppName', error);
    }
    return count || 0;
}

export async function updateAppNameForTxid(txid, appName, appType) {
    const { error } = await supabase
        .from('revenue_transactions')
        .update({ app_name: appName, app_type: appType })
        .eq('txid', txid)
        .is('app_name', null);

    if (error) {
        log.error(`updateAppNameForTxid error: ${error.message}`);
    }
}

/**
 * Must page (issue #227). The old `.limit(10000)` read as a generous ceiling but PostgREST
 * caps at 1000 regardless, so a busy day's tail vanished with no error.
 */
export async function getTransactionsByDate(date) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('revenue_transactions')
            .select('*')
            .eq('date', date)
            // Paging needs a total order or Postgres may repeat/skip rows between pages.
            .order('id', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw readFailed('getTransactionsByDate', error);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

// Must page — same cap as getTransactionsByDate above (issue #227).
export async function getTransactionsByBlockRange(startBlock, endBlock) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('revenue_transactions')
            .select('*')
            .gte('block_height', startBlock)
            .lte('block_height', endBlock)
            .order('block_height', { ascending: false })
            .order('id', { ascending: true }) // tiebreak: block_height is not unique
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw readFailed('getTransactionsByBlockRange', error);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

/**
 * Call a set-returning RPC and read every row (issue #227).
 *
 * PostgREST's db-max-rows cap applies to rpc() exactly as it does to a table read, and
 * truncates just as silently -- #232 swept that out of the table reads and missed these
 * because they are RPC calls, not selects. Each of these returns one row per day, so at
 * 836 days of history they were roughly 160 days from quietly dropping their oldest data,
 * with no error anywhere.
 *
 * Throws on error rather than deciding per-caller; the callers keep their own logging and
 * their own choice of throw-vs-empty.
 */
async function pagedRpc(name, params) {
    const PAGE_SIZE = 1000;
    const rows = [];
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .rpc(name, params)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function getRevenueForDateRange(startDate, endDate) {
    // Server-side aggregation, PAGED (issue #227). The RPC returns one row per day, and
    // an RPC response is capped at db-max-rows and truncated silently exactly like a
    // select -- so past 1000 days this would have quietly under-reported the headline
    // revenue figure that the dashboard, the KPI report and every snapshot read from.
    let data;
    try {
        data = await pagedRpc('get_daily_revenue_in_range', { p_start: startDate, p_end: endDate });
    } catch (error) {
        log.error(`getRevenueForDateRange error: ${error.message}`);
        throw new Error(`getRevenueForDateRange failed: ${error.message}`);
    }
    return data.reduce((sum, row) => sum + (row.daily_revenue || 0), 0);
}

/**
 * Revenue in a range from a specific set of sender addresses.
 *
 * Team transactions are a small subset, so paging the rows is cheap and avoids needing an
 * RPC. Paging is mandatory, not optional — an un-paged select would silently stop at
 * PostgREST's 1000-row cap and under-report the total.
 */
export async function getRevenueFromAddressesForDateRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return { revenue: 0, payments: 0 };

    // Two round trips with bounded results, whatever the range (issue #227). This used to
    // page every matching row back to Node to add them up -- ceil(N/1000) sequential
    // requests with every row transferred, on an endpoint polled by every open tab -- when
    // migration 010 already ships an RPC that does the SUM server-side and returns one row
    // per day. The payment count comes from a head request, which transfers no rows at all.
    try {
        const [daily, { count, error: countError }] = await Promise.all([
            pagedRpc('get_daily_revenue_from_addresses_in_range', {
                p_start: startDate, p_end: endDate, p_addresses: addresses
            }),
            supabase
                .from('revenue_transactions')
                .select('*', { count: 'exact', head: true })
                .gte('date', startDate)
                .lte('date', endDate)
                .in('from_address', addresses)
        ]);

        if (countError) throw countError;

        const revenue = daily.reduce((sum, row) => sum + (row.daily_revenue || 0), 0);
        return { revenue, payments: count || 0 };
    } catch (error) {
        log.error(`getRevenueFromAddressesForDateRange error: ${error.message}`);
        throw new Error(`getRevenueFromAddressesForDateRange failed: ${error.message}`);
    }
}

export async function getPaymentCountForDateRange(startDate, endDate) {
    const { count, error } = await supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate);

    if (error) {
        throw readFailed('getPaymentCountForDateRange', error);
    }
    return count || 0;
}

export async function getRevenueForBlockRange(startBlock, endBlock) {
    // Paginate to avoid 1000-row default limit
    let total = 0;
    let offset = 0;
    const pageSize = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('revenue_transactions')
            .select('amount')
            .gte('block_height', startBlock)
            .lte('block_height', endBlock)
            .order('id', { ascending: true }) // offset paging needs a total order (#313)
            .range(offset, offset + pageSize - 1);

        if (error) {
            throw readFailed('getRevenueForBlockRange', error);
        }
        if (!data || data.length === 0) break;

        total += data.reduce((sum, row) => sum + (row.amount || 0), 0);
        if (data.length < pageSize) break;
        offset += pageSize;
    }
    return total;
}

export async function getLastSyncedBlock() {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('block_height')
        .order('block_height', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getLastSyncedBlock error: ${error.message}`);
    }
    return data?.block_height || null;
}

export async function getTxidCount() {
    const { count, error } = await supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true });

    if (error) {
        throw readFailed('getTxidCount', error);
    }
    return count || 0;
}

/**
 * True when PostgREST could not find a function matching the arguments we sent -- i.e. the
 * database is behind the code on a migration, rather than the query itself failing.
 * PGRST202 is the documented code; the message check covers older PostgREST versions that
 * report the same condition without one.
 */
function isMissingRpcSignature(error) {
    if (!error) return false;
    if (error.code === 'PGRST202') return true;
    const message = String(error.message || '').toLowerCase();
    return message.includes('could not find the function') || message.includes('does not exist');
}

export async function getTransactionsPaginated(page = 1, limit = 50, search = '', appName = null, fromAddresses = null) {
    const offset = (page - 1) * limit;

    // Payer filter (issue #159) -- see migration 011. NULL rather than an empty array when
    // nothing is selected: the RPC treats both as "no filter", but sending NULL keeps the
    // intent obvious in the query log.
    const addresses = Array.isArray(fromAddresses) && fromAddresses.length > 0 ? fromAddresses : null;

    const baseArgs = {
        p_search: search || null,
        p_app: appName || null,
        p_limit: limit,
        p_offset: offset
    };

    let { data, error } = await supabase.rpc('get_transactions_paginated', {
        ...baseArgs,
        p_from_addresses: addresses
    });

    // Deploy-order resilience. Migration 011 added p_from_addresses; deploying this code
    // against a database that has not had the migration applied yet makes PostgREST report
    // PGRST202 ("could not find the function ... in the schema cache"). That used to be
    // swallowed into an empty result, so the dashboard showed "0 transactions" beside a
    // healthy sync indicator while 22k rows sat untouched -- a schema mismatch has to be
    // distinguishable from "there is no data".
    //
    // The argument is optional by design (the migration gives it a SQL DEFAULT), so an
    // un-migrated database can still answer the unfiltered question. Retry without it.
    if (error && isMissingRpcSignature(error)) {
        if (addresses) {
            // But never on the filtered path: serving unfiltered rows under an active TEAM
            // or FIAT badge would show someone else's payments as team-funded. Wrong data is
            // worse than no data.
            throw new Error(
                'Transaction payer filter needs migration 011 (get_transactions_paginated). ' +
                `Apply supabase/migrations/011_transactions_source_filter.sql. Cause: ${error.message}`
            );
        }

        log.warn(
            'get_transactions_paginated is missing p_from_addresses -- migration 011 not applied. ' +
            'Serving unfiltered transactions; apply the migration to enable the TEAM/FIAT filter.'
        );
        ({ data, error } = await supabase.rpc('get_transactions_paginated', baseArgs));
    }

    if (error) {
        // Deliberately throws rather than returning an empty page. A timeout, a permission
        // failure or a schema mismatch is not "no transactions", and rendering it as an
        // empty table hides the problem behind a plausible-looking UI.
        log.error(`getTransactionsPaginated error: ${error.message}`);
        throw new Error(`getTransactionsPaginated failed: ${error.message}`);
    }

    const total = data?.[0]?.total_count || 0;

    return {
        transactions: (data || []).map(r => {
            const { total_count, ...rest } = r;
            return rest;
        }),
        total: Number(total),
        page,
        limit,
        offset
    };
}

export async function getAppAnalytics(page = 1, limit = 50, search = '') {
    const offset = (page - 1) * limit;

    const { data, error } = await supabase.rpc('get_app_analytics', {
        p_search: search || null,
        p_limit: limit,
        p_offset: offset
    });

    if (error) {
        throw readFailed('getAppAnalytics', error);
    }

    const total = data?.[0]?.total_count || 0;

    return {
        apps: (data || []).map(r => {
            const { total_count, ...rest } = r;
            return rest;
        }),
        total: Number(total),
        page,
        limit,
        offset
    };
}

export async function getDailyRevenueFromTransactions(days = 30) {
    // days - 1: the range is inclusive of both ends, so "last 30 days" is today plus the
    // 29 before it. Subtracting `days` returned 31 rows and made the daily chart disagree
    // with the period totals in /api/analytics/comparison.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const startDate = cutoff.toISOString().split('T')[0];

    // Paged (issue #306): one row per day, ORDER BY date ASC -- past 1000 days an unpaged
    // call silently drops the NEWEST days, which is exactly what the "All" chart shows.
    let data;
    try {
        data = await pagedRpc('get_daily_revenue', { start_date: startDate });
    } catch (error) {
        throw readFailed('getDailyRevenueFromTransactions', error);
    }
    log.info(`Retrieved daily revenue for ${data.length} days from transactions`);
    return data;
}

export async function getDailyRevenueInRange(startDate, endDate) {
    let data;
    try {
        data = await pagedRpc('get_daily_revenue_in_range', { p_start: startDate, p_end: endDate });
    } catch (error) {
        throw readFailed('getDailyRevenueInRange', error);
    }
    log.info(`Retrieved daily revenue for ${data.length} days from transactions (${startDate} to ${endDate})`);
    return data;
}

export async function getDailyRevenueUSDFromTransactions(days = 30) {
    // days - 1: the range is inclusive of both ends, so "last 30 days" is today plus the
    // 29 before it. Subtracting `days` returned 31 rows and made the daily chart disagree
    // with the period totals in /api/analytics/comparison.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const startDate = cutoff.toISOString().split('T')[0];

    // Paged (issue #306): one row per day, ORDER BY date ASC -- past 1000 days an unpaged
    // call silently drops the NEWEST days, which is exactly what the "All" chart shows.
    let data;
    try {
        data = await pagedRpc('get_daily_revenue_usd', { start_date: startDate });
    } catch (error) {
        throw readFailed('getDailyRevenueUSDFromTransactions', error);
    }
    log.info(`Retrieved daily USD revenue for ${data.length} days from transactions`);
    return data;
}

export async function getDailyRevenueUSDInRange(startDate, endDate) {
    let data;
    try {
        data = await pagedRpc('get_daily_revenue_usd_in_range', { p_start: startDate, p_end: endDate });
    } catch (error) {
        log.error(`getDailyRevenueUSDInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueUSDInRange failed: ${error.message}`);
    }
    log.info(`Retrieved daily USD revenue for ${data.length} days from transactions (${startDate} to ${endDate})`);
    return data;
}

// Daily revenue mix (issue #262 part 2, migration 020): new apps vs renewals, enterprise,
// average commitment in days. Payments with no message metadata count in total_flux only.
export async function getDailyRevenueMixInRange(startDate, endDate) {
    let data;
    try {
        data = await pagedRpc('get_daily_revenue_mix', { p_start: startDate, p_end: endDate });
    } catch (error) {
        log.error(`getDailyRevenueMixInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueMixInRange failed: ${error.message}`);
    }
    return data;
}

// App retention cohorts (issue #264, migration 022): per registration month, how many app
// lives started and how many were still paid for 30/90/180 days later.
export async function getAppCohorts(startDate, endDate, today) {
    let data;
    try {
        data = await pagedRpc('get_app_cohorts', { p_start: startDate, p_end: endDate, p_today: today });
    } catch (error) {
        log.error(`getAppCohorts error: ${error.message}`);
        throw new Error(`getAppCohorts failed: ${error.message}`);
    }
    return data;
}

// Payer base (issue #267): paying wallets per month, new vs returning, excluding the given
// addresses (team + fiat on-ramp). Aggregates only -- the RPC never returns an address.
export async function getMonthlyPayerStats(startDate, endDate, excludeAddresses = []) {
    let data;
    try {
        data = await pagedRpc('get_monthly_payer_stats', {
            p_start: startDate, p_end: endDate, p_exclude: excludeAddresses ?? []
        });
    } catch (error) {
        log.error(`getMonthlyPayerStats error: ${error.message}`);
        throw new Error(`getMonthlyPayerStats failed: ${error.message}`);
    }
    return data.map(row => ({
        month: row.month,
        payers: Number(row.payers) || 0,
        new_payers: Number(row.new_payers) || 0
    }));
}

// Revenue concentration across apps (issue #267): all-time FLUX total, app count, the top
// ten's revenue and how many apps make up 80% of it. One row.
export async function getAppRevenueConcentration() {
    let data;
    try {
        data = await pagedRpc('get_app_revenue_concentration', {});
    } catch (error) {
        log.error(`getAppRevenueConcentration error: ${error.message}`);
        throw new Error(`getAppRevenueConcentration failed: ${error.message}`);
    }
    const row = data[0] ?? {};
    return {
        total_revenue: Number(row.total_revenue) || 0,
        app_count: Number(row.app_count) || 0,
        top10_revenue: Number(row.top10_revenue) || 0,
        apps_for_80pct: Number(row.apps_for_80pct) || 0
    };
}

// Team Funded historical trend (issue #146). A per-day GROUP BY needs to run server-side,
// unlike getRevenueFromAddressesForDateRange()'s single-range sum (which gets away with a
// plain .in() + client-side sum) -- so this goes through an RPC function, same as every
// other per-day revenue query in this adapter.
export async function getDailyRevenueFromAddressesInRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return [];

    let data;
    try {
        data = await pagedRpc('get_daily_revenue_from_addresses_in_range', {
            p_start: startDate, p_end: endDate, p_addresses: addresses
        });
    } catch (error) {
        log.error(`getDailyRevenueFromAddressesInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueFromAddressesInRange failed: ${error.message}`);
    }
    log.info(`Retrieved daily revenue from ${addresses.length} addresses for ${data.length} days (${startDate} to ${endDate})`);
    return data;
}

export async function getDailyRevenueUSDFromAddressesInRange(startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return [];

    let data;
    try {
        data = await pagedRpc('get_daily_revenue_usd_from_addresses_in_range', {
            p_start: startDate, p_end: endDate, p_addresses: addresses
        });
    } catch (error) {
        log.error(`getDailyRevenueUSDFromAddressesInRange error: ${error.message}`);
        throw new Error(`getDailyRevenueUSDFromAddressesInRange failed: ${error.message}`);
    }
    log.info(`Retrieved daily USD revenue from ${addresses.length} addresses for ${data.length} days (${startDate} to ${endDate})`);
    return data;
}

export async function deleteOldTransactions(daysToKeep = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('revenue_transactions')
        .delete()
        .lt('date', cutoffDateStr)
        .select('id');

    const count = data?.length || 0;
    if (error) {
        log.error(`deleteOldTransactions error: ${error.message}`);
    } else {
        log.info(`[CLEANUP] Deleted ${count} old transactions (older than ${cutoffDateStr})`);
    }
    return count;
}

// ============================================
// FAILED TXID TRACKING
// ============================================

export async function upsertFailedTxid(txid, address, reason = 'fetch_failed') {
    const now = Math.floor(Date.now() / 1000);

    // Two-step approach: check if exists, then insert or update
    const { data: existing } = await supabase
        .from('failed_txids')
        .select('txid, attempt_count')
        .eq('txid', txid)
        .single();

    if (existing) {
        await supabase
            .from('failed_txids')
            .update({
                attempt_count: existing.attempt_count + 1,
                last_attempt: now,
                failure_reason: reason,
                resolved: 0
            })
            .eq('txid', txid);
    } else {
        await supabase
            .from('failed_txids')
            .insert({
                txid,
                address,
                failure_reason: reason,
                attempt_count: 1,
                first_seen: now,
                last_attempt: now,
                resolved: 0
            });
    }
}

export async function getUnresolvedFailedTxids(limit = 200) {
    const { data, error } = await supabase
        .from('failed_txids')
        .select('txid, address, failure_reason, attempt_count, first_seen, last_attempt')
        .eq('resolved', 0)
        .order('attempt_count', { ascending: true })
        .order('last_attempt', { ascending: true })
        .limit(limit);

    if (error) {
        throw readFailed('getUnresolvedFailedTxids', error);
    }
    return data || [];
}

export async function resolveFailedTxid(txid) {
    const { error } = await supabase
        .from('failed_txids')
        .update({ resolved: 1 })
        .eq('txid', txid);

    if (error) {
        log.error(`resolveFailedTxid error: ${error.message}`);
    }
}

export async function getFailedTxidCount() {
    const { count, error } = await supabase
        .from('failed_txids')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', 0);

    if (error) {
        throw readFailed('getFailedTxidCount', error);
    }
    return count || 0;
}

export async function clearAbandonedFailedTxids(maxAgeDays = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 86400);

    const { data, error } = await supabase
        .from('failed_txids')
        .delete()
        .eq('resolved', 1)
        .lt('last_attempt', cutoff)
        .select('txid');

    if (error) {
        log.error(`clearAbandonedFailedTxids error: ${error.message}`);
        return 0;
    }
    return data?.length || 0;
}

export async function isFailedTxid(txid) {
    const { data, error } = await supabase
        .from('failed_txids')
        .select('*')
        .eq('txid', txid)
        .eq('resolved', 0)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`isFailedTxid error: ${error.message}`);
    }
    return data || null;
}

// ============================================
// SYNC STATUS OPERATIONS
// ============================================

export async function getSyncStatus(syncType) {
    const { data, error } = await supabase
        .from('sync_status')
        .select('*')
        .eq('sync_type', syncType)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getSyncStatus error: ${error.message}`);
    }
    return data || null;
}

export async function updateSyncStatus(syncType, status, errorMessage = null, lastBlock = null) {
    // Upsert, not update: rows for new sync types (e.g. the KPI scheduler's
    // kpi_daily/kpi_weekly receipts) do not exist until first written — a plain
    // .update() with .eq() on a missing row matches 0 rows and silently no-ops,
    // breaking dedupe forever. sync_type is UNIQUE in the schema, so onConflict works.
    //
    // last_sync_block is only written when a block is given (issue #335). The failure paths
    // pass null, and writing it nulled the revenue cursor -- which makes the next pass rescan
    // the whole chain from block 1. An upsert leaves columns absent from the payload alone
    // on conflict; resetRevenueSyncBlock() is the one deliberate way to clear it.
    const row = {
        sync_type: syncType,
        last_sync: Date.now(),
        status,
        error_message: errorMessage
    };
    if (lastBlock !== null && lastBlock !== undefined) row.last_sync_block = lastBlock;

    const { error } = await supabase
        .from('sync_status')
        .upsert(row, { onConflict: 'sync_type' });

    if (error) {
        log.error(`updateSyncStatus error: ${error.message}`);
    }
}

export async function resetRevenueSyncBlock() {
    const { error } = await supabase
        .from('sync_status')
        .update({ last_sync_block: null })
        .eq('sync_type', 'revenue');

    if (error) {
        log.error(`resetRevenueSyncBlock error: ${error.message}`);
    }
}

export async function clearRevenueData() {
    const { count } = await supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true });

    await supabase
        .from('revenue_transactions')
        .delete()
        .neq('id', 0); // delete all

    await supabase
        .from('sync_status')
        .update({ last_sync_block: null, last_sync: 0, status: 'pending' })
        .eq('sync_type', 'revenue');

    return count || 0;
}

export async function setNextSync(syncType, nextSyncTime) {
    const { error } = await supabase
        .from('sync_status')
        .update({ next_sync: nextSyncTime })
        .eq('sync_type', syncType);

    if (error) {
        log.error(`setNextSync error: ${error.message}`);
    }
}

// ============================================
// PRICE HISTORY OPERATIONS
// ============================================

export async function insertPriceHistoryBatch(prices) {
    if (!prices || prices.length === 0) return true;

    const rows = prices.map(p => ({
        date: p.date,
        price_usd: p.price_usd,
        source: p.source || 'cryptocompare'
    }));

    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('flux_price_history')
            .upsert(chunk, { onConflict: 'date' });

        if (error) {
            log.error(`insertPriceHistoryBatch chunk error (offset ${i}): ${error.message}`);
            return false;
        }
    }

    log.info(`Inserted/updated ${prices.length} price history rows`);
    return true;
}

export async function getPriceForDate(date) {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('price_usd')
        .eq('date', date)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getPriceForDate error: ${error.message}`);
    }
    return data ? data.price_usd : null;
}

// PostgREST caps a single response at db-max-rows (1000 by default), so this must page.
// Without paging the price map silently loses everything past the first 1000 days.
export async function getPricesForDateRange(startDate, endDate) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('flux_price_history')
            .select('date, price_usd')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            throw readFailed('getPricesForDateRange', error);
        }
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function getLatestPriceDate() {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getLatestPriceDate error: ${error.message}`);
    }
    return data ? data.date : null;
}

export async function getOldestPriceDate() {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('date')
        .order('date', { ascending: true })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getOldestPriceDate error: ${error.message}`);
    }
    return data ? data.date : null;
}

export async function getTransactionsWithNullUsd(limit = 1000, offset = 0) {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('txid, amount, date, timestamp')
        .is('amount_usd', null)
        .order('block_height', { ascending: false })
        .order('id', { ascending: true }) // tiebreak: block_height is not unique (#313)
        .range(offset, offset + limit - 1);

    if (error) {
        throw readFailed('getTransactionsWithNullUsd', error);
    }
    return data || [];
}

export async function getOldestTransactionDate() {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('date')
        .order('date', { ascending: true })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        log.error(`getOldestTransactionDate error: ${error.message}`);
    }
    return data ? data.date : null;
}

/**
 * Message-metadata back-fill (issue #262): one statement per 500-row chunk via the RPC from
 * migration 019, which only touches rows with no metadata yet. Returns the rows updated.
 * Throws when the migration is missing -- the back-fill cannot do anything useful without it.
 */
export async function updateTransactionMetadataBatch(updates) {
    if (!updates || updates.length === 0) return 0;
    const CHUNK_SIZE = 500;
    let updated = 0;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE).map(u => ({
            txid: u.txid,
            msg_type: u.msg_type ?? null,
            enterprise: u.enterprise ?? null,
            expire_blocks: u.expire_blocks ?? null,
            instances: u.instances ?? null
        }));
        const { data, error } = await supabase.rpc('update_transaction_metadata_batch', { p_updates: chunk });
        if (error) {
            log.error(`updateTransactionMetadataBatch error: ${error.message}`);
            throw new Error(`updateTransactionMetadataBatch failed: ${error.message}`);
        }
        updated += Number(data) || 0;
    }
    return updated;
}

export async function updateTransactionUsdBatch(updates) {
    if (!updates || updates.length === 0) return true;

    // Preferred path: one statement per chunk via RPC (migration 006). Falls back to
    // per-row updates if the RPC isn't deployed yet — a full backfill of ~21k rows costs
    // ~21k round-trips on the fallback path, so apply the migration.
    const CHUNK_SIZE = 500;
    let useRpc = true;

    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE);

        if (useRpc) {
            const { error } = await supabase.rpc('update_transaction_usd_batch', { p_updates: chunk });
            if (!error) continue;

            // PGRST202 = function not found in schema cache
            if (error.code !== 'PGRST202') {
                log.error(`updateTransactionUsdBatch error: ${error.message}`);
                return false;
            }
            log.warn('update_transaction_usd_batch RPC not found - falling back to per-row updates (apply migration 006)');
            useRpc = false;
        }

        const promises = chunk.map(u =>
            supabase
                .from('revenue_transactions')
                .update({ amount_usd: u.amount_usd })
                .eq('txid', u.txid)
                .is('amount_usd', null)
        );
        const results = await Promise.all(promises);
        const firstError = results.find(r => r.error);
        if (firstError?.error) {
            log.error(`updateTransactionUsdBatch error: ${firstError.error.message}`);
            return false;
        }
    }

    log.info(`Updated USD for ${updates.length} transactions`);
    return true;
}

export async function getPriceHistoryCount() {
    const { count, error } = await supabase
        .from('flux_price_history')
        .select('*', { count: 'exact', head: true });

    if (error) {
        throw readFailed('getPriceHistoryCount', error);
    }
    return count || 0;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Row counts. `{ lean: true }` counts only daily_snapshots and revenue_transactions -- all the
 * header shows (issue #301). The full set adds an exact count of repo_snapshots (~200k rows)
 * and a COUNT(DISTINCT image_name), which /api/header paid on every cache miss for nothing.
 */
export async function getDatabaseStats({ lean = false } = {}) {
    if (lean) {
        const [snapshots, transactions] = await Promise.all([
            supabase.from('daily_snapshots').select('*', { count: 'exact', head: true }),
            supabase.from('revenue_transactions').select('*', { count: 'exact', head: true })
        ]);
        return { snapshots: snapshots.count || 0, transactions: transactions.count || 0 };
    }
    const [snapshots, transactions, priceHistory, repoSnapshots, distinctRepos] = await Promise.all([
        supabase.from('daily_snapshots').select('*', { count: 'exact', head: true }),
        supabase.from('revenue_transactions').select('*', { count: 'exact', head: true }),
        supabase.from('flux_price_history').select('*', { count: 'exact', head: true }),
        supabase.from('repo_snapshots').select('*', { count: 'exact', head: true }),
        supabase.rpc('get_distinct_repo_count').then(({ data }) => {
            return { count: data || 0 };
        })
    ]);

    return {
        snapshots: snapshots.count || 0,
        transactions: transactions.count || 0,
        priceHistory: priceHistory.count || 0,
        repoSnapshots: repoSnapshots.count || 0,
        distinctRepos: distinctRepos.count || 0,
        dbSizeKB: null, // No local file - use Supabase dashboard for DB size
        dbPath: 'supabase',
        isWriter: true,
        instanceId: 'supabase'
    };
}

// ============================================
// REPO SNAPSHOTS
// ============================================

export async function createRepoSnapshots(snapshotDate, repoCounts) {
    const now = Math.floor(Date.now() / 1000);
    const entries = Object.entries(repoCounts);
    if (entries.length === 0) return 0;

    const rows = entries.map(([imageName, count]) => ({
        snapshot_date: snapshotDate,
        image_name: imageName,
        instance_count: count,
        category: categorizeImage(imageName),
        created_at: now
    }));

    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('repo_snapshots')
            .upsert(chunk, { onConflict: 'snapshot_date,image_name' });

        if (error) {
            log.error(`createRepoSnapshots chunk error (offset ${i}): ${error.message}`);
        }
    }

    return entries.length;
}

export async function getRepoSnapshotCountByDate(date) {
    const { count, error } = await supabase
        .from('repo_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', date);

    if (error) {
        throw readFailed('getRepoSnapshotCountByDate', error);
    }
    return count || 0;
}

export async function getRepoHistory(imageName, limit = 90) {
    // If imageName has no tag (no ':'), merge all tags via RPC
    if (!imageName.includes(':')) {
        const { data, error } = await supabase.rpc('get_repo_history_merged', {
            p_image: imageName,
            lim: limit
        });

        if (error) {
            throw readFailed('getRepoHistory', error);
        }
        return data || [];
    }

    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date, instance_count')
        .eq('image_name', imageName)
        .order('snapshot_date', { ascending: false })
        .limit(limit);

    if (error) {
        throw readFailed('getRepoHistory', error);
    }
    return data || [];
}

export async function getDistinctRepos() {
    // Paged (issue #304): there are well over 1000 distinct images, and an unpaged RPC stops
    // at db-max-rows silently -- recategorize then left every image past the cap uncategorized.
    let data;
    try {
        data = await pagedRpc('get_distinct_repos');
    } catch (error) {
        throw readFailed('getDistinctRepos', error);
    }

    return data.map(r => r.image_name);
}

export async function getLatestRepoSnapshot() {
    // Get the latest date
    const { data: dateRow, error: dateError } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (dateError) throw readFailed('getLatestRepoSnapshot', dateError);
    if (!dateRow) return [];

    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('image_name, instance_count')
        .eq('snapshot_date', dateRow.snapshot_date)
        .order('instance_count', { ascending: false });

    if (error) {
        throw readFailed('getLatestRepoSnapshot', error);
    }
    return data || [];
}

// ============================================
// CATEGORY-BASED REPO QUERIES
// ============================================

/**
 * Latest day's rows for a category, one per FULL image name (tag included), biggest first.
 *
 * Deliberately not the get_top_repos_by_category RPC: that strips the tag before grouping,
 * and the route re-validates each row with categorizeImage() -- which decides some images
 * BY their tag (`ethereum/client-go:stable` is crypto, `ethereum/client-go` is nothing). So
 * the tagless row failed re-validation and dropped out of the card (issue #305). Tags are
 * merged by the caller's groupReposByCanonicalName(), after validation.
 */
export async function getTopReposByCategory(category, limit = 3) {
    const { data: dateRow, error: dateError } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .eq('category', category)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (dateError) {
        throw readFailed('getTopReposByCategory', dateError);
    }
    if (!dateRow) return { date: null, repos: [] };

    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('image_name, instance_count')
        .eq('category', category)
        .eq('snapshot_date', dateRow.snapshot_date)
        .order('instance_count', { ascending: false })
        .order('image_name', { ascending: true })
        .limit(limit);

    if (error) {
        throw readFailed('getTopReposByCategory', error);
    }

    return { date: dateRow.snapshot_date, repos: data || [] };
}

export async function getCategoryTotal(category, date) {
    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('instance_count')
        .eq('category', category)
        .eq('snapshot_date', date);

    if (error) {
        throw readFailed('getCategoryTotal', error);
    }
    return (data || []).reduce((sum, r) => sum + (r.instance_count || 0), 0);
}

export async function getCategoryHistory(category, limit = 90) {
    let data;
    try {
        data = await pagedRpc('get_category_history', { cat: category, lim: limit });
    } catch (error) {
        throw readFailed('getCategoryHistory', error);
    }
    return data;
}

export async function getReposByCategory(category) {
    let data;
    try {
        data = await pagedRpc('get_repos_by_category', { cat: category });
    } catch (error) {
        throw readFailed('getReposByCategory', error);
    }
    return data;
}

/**
 * The image list comes from the get_distinct_repos RPC, never from scanning rows.
 *
 * repo_snapshots holds one row per image per day — hundreds of images across 800+ days is
 * hundreds of thousands of rows, and an unpaged select of them stopped at db-max-rows
 * (1000), i.e. a handful of days of a single image. Because that truncated read could never
 * drain a backlog bigger than the cap, this ran on every boot forever without finishing
 * (issue #222). DISTINCT is server-side and bounded: hundreds of rows, no paging needed.
 */
export async function backfillRepoCategories() {
    const { count, error } = await supabase
        .from('repo_snapshots')
        .select('image_name', { count: 'exact', head: true })
        .is('category', null);

    if (error || !count) return 0;

    const uniqueImages = await getDistinctRepos();
    if (uniqueImages.length === 0) return 0;

    let updated = 0;

    for (const imageName of uniqueImages) {
        const cat = categorizeImage(imageName);
        if (cat) {
            await supabase
                .from('repo_snapshots')
                .update({ category: cat })
                .eq('image_name', imageName)
                .is('category', null);
            updated++;
        }
    }

    log.info(`Backfilled categories for ${updated} of ${uniqueImages.length} distinct images`);
    return uniqueImages.length;
}

export async function recategorizeAllRepos() {
    // Distinct images via the (paged) RPC, not a row scan — see backfillRepoCategories().
    //
    // Each image is set to its category in ONE update, null included for an image that no
    // longer matches. This used to null every row first and then restore only the images the
    // RPC returned -- and the RPC was capped at 1000, so every image past the cap stayed NULL
    // for good (issues #222, #304). With no global reset, a run that dies midway leaves each
    // row either old-correct or new-correct, never blank.
    const uniqueImages = await getDistinctRepos();
    if (uniqueImages.length === 0) {
        throw new Error('recategorizeAllRepos: no images returned — refusing to run');
    }
    const counts = {};

    for (const imageName of uniqueImages) {
        const cat = categorizeImage(imageName);
        const { error } = await supabase
            .from('repo_snapshots')
            .update({ category: cat })
            .eq('image_name', imageName);
        if (error) throw new Error(`recategorize ${imageName} failed: ${error.message}`);
        if (cat) counts[cat] = (counts[cat] || 0) + 1;
    }

    log.info({ counts }, `Re-categorized ${uniqueImages.length} images`);
    return { resetCount: uniqueImages.length, categorized: counts };
}

// ============================================
// BACKUP EXPORT / IMPORT
// ============================================

// Must page — an un-paged select silently truncates the backup at db-max-rows (1000).
export async function exportAllPriceHistory() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('flux_price_history')
            .select('*')
            .order('date', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Export flux_price_history failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function upsertPriceHistory(rows) {
    if (!rows || rows.length === 0) return 0;

    const CHUNK_SIZE = 500;
    let total = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('flux_price_history')
            .upsert(chunk, { onConflict: 'date' });

        if (error) throw new Error(`Upsert flux_price_history chunk ${i} failed: ${error.message}`);
        total += chunk.length;
    }

    return total;
}

// Must page — see exportAllPriceHistory.
export async function exportAllDailySnapshots() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('daily_snapshots')
            .select('*')
            .order('snapshot_date', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Export daily_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function exportAllRepoSnapshots() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('repo_snapshots')
            .select('*')
            .order('snapshot_date', { ascending: true })
            .order('image_name', { ascending: true }) // tiebreak (#313)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Export repo_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

/**
 * Every game_snapshots row. Paged: PostgREST caps any response at db-max-rows (1000) and
 * truncates silently, and this table grows by ~13 rows a day, so it passes the cap inside
 * three months. A missing .range() here would quietly ship a partial backup.
 */
export async function exportAllGameSnapshots() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('game_snapshots')
            .select('*')
            .order('snapshot_date', { ascending: true })
            .order('game_name', { ascending: true }) // tiebreak (#313)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Export game_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function upsertGameSnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    const CHUNK_SIZE = 500;
    let total = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('game_snapshots')
            .upsert(chunk, { onConflict: 'snapshot_date,game_name' });

        if (error) throw new Error(`Upsert game_snapshots chunk ${i} failed: ${error.message}`);
        total += chunk.length;
    }

    return total;
}

export async function upsertDailySnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    const { error } = await supabase
        .from('daily_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date' });

    if (error) throw new Error(`Upsert daily_snapshots failed: ${error.message}`);
    return rows.length;
}

export async function upsertRepoSnapshots(rows) {
    if (!rows || rows.length === 0) return 0;

    const CHUNK_SIZE = 500;
    let total = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('repo_snapshots')
            .upsert(chunk, { onConflict: 'snapshot_date,image_name' });

        if (error) throw new Error(`Upsert repo_snapshots chunk ${i} failed: ${error.message}`);
        total += chunk.length;
    }

    return total;
}

// ============================================
// NODE IP CLASSIFICATION (decentralization metric, issue #108)
// ============================================

/**
 * Every classified node IP -- lightweight projection (no asn/org) since callers only need
 * ip/isDatacenter/classifiedAt to decide what's stale and to aggregate the stats. Must page
 * — PostgREST caps every response at db-max-rows (1000), and this table can grow past that
 * as more of the network gets classified.
 */
export async function getAllNodeIpClassifications() {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('node_ip_classification')
            // asn is carried for reclassifyStoredDatacenterFlags() (issue #196) -- it writes
            // these rows straight back through upsertNodeIpClassifications(), which sets
            // every column, so dropping asn here would null it on every re-flagged row.
            .select('ip, asn, org, is_datacenter, classified_at, country, country_code, continent, continent_code')
            // Offset paging with no ORDER BY can skip or repeat rows while the decentralization
            // scheduler upserts into this table (issue #313).
            .order('ip', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Fetch node_ip_classification failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

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

    const payload = rows.map(row => ({
        ip: row.ip,
        asn: row.asn ?? null,
        org: row.org ?? null,
        is_datacenter: !!row.isDatacenter,
        classified_at: row.classifiedAt,
        country: row.country ?? null,
        country_code: row.countryCode ?? null,
        continent: row.continent ?? null,
        continent_code: row.continentCode ?? null
    }));

    const CHUNK_SIZE = 500;
    let total = 0;

    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('node_ip_classification')
            .upsert(chunk, { onConflict: 'ip' });

        if (error) throw new Error(`Upsert node_ip_classification chunk ${i} failed: ${error.message}`);
        total += chunk.length;
    }

    return total;
}

// ============================================
// DECENTRALIZATION SNAPSHOTS (historical per-provider breakdown, issue #108 Phase 3)
// ============================================

// ============================================
// GAME SNAPSHOTS (issue #163)
// ============================================

export async function createGameSnapshots(snapshotDate, games) {
    if (!games || games.length === 0) return 0;

    const rows = games.map(g => ({
        snapshot_date: snapshotDate,
        game_name: g.name,
        instance_count: g.instances,
        created_at: Date.now()
    }));

    const { error } = await supabase
        .from('game_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,game_name' });

    if (error) throw new Error(`Upsert game_snapshots failed: ${error.message}`);
    return rows.length;
}

/**
 * Per-game counts for one date. No .range() paging needed: this is a single date and the
 * network runs well under a dozen distinct games, far below PostgREST's 1000-row cap.
 */
export async function getGameSnapshotsByDate(snapshotDate) {
    const { data, error } = await supabase
        .from('game_snapshots')
        .select('game_name, instance_count')
        .eq('snapshot_date', snapshotDate)
        .order('instance_count', { ascending: false });

    if (error) {
        throw readFailed('getGameSnapshotsByDate', error);
    }
    return data || [];
}

/**
 * Per-game counts across a date range (issue #175) -- backs the Historical Performance
 * chart's Gaming category.
 *
 * Must page -- see getDecentralizationSnapshotHistory() for the identical pattern. A year of
 * history times a dozen games is several thousand rows, well past PostgREST's 1000-row cap,
 * and a missing .range() truncates silently rather than erroring.
 *
 * Unlike getGameSnapshotsByDate this THROWS on error rather than returning []: the caller
 * degrades a missing table to an empty series deliberately and logs it, which an empty array
 * here would hide.
 */
export async function getGameSnapshotHistory(startDate, endDate) {
    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from('game_snapshots')
            .select('snapshot_date, game_name, instance_count')
            .gte('snapshot_date', startDate)
            .lte('snapshot_date', endDate)
            .order('snapshot_date', { ascending: true })
            .order('instance_count', { ascending: false })
            .order('game_name', { ascending: true }) // tiebreak (#313)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Fetch game_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

/**
 * Write one dimension's breakdown for a date (issue #151).
 *
 * One implementation for datacenter, country and continent, which were three copies of this
 * differing only in table and column names. Those names come from the dimension whitelist in
 * decentralizationDimensions.js and never from a caller's string, so an unrecognised key
 * throws rather than reaching a query.
 */
export async function createDecentralizationDimensionSnapshots(dimensionKey, snapshotDate, breakdown) {
    if (!breakdown || breakdown.length === 0) return 0;

    const dimension = resolveDimension(dimensionKey);

    const rows = breakdown.map(item => {
        const row = {
            snapshot_date: snapshotDate,
            [dimension.nameColumn]: item[dimension.nameField],
            node_count: item.count,
            created_at: Date.now()
        };
        if (dimension.codeColumn) row[dimension.codeColumn] = item[dimension.codeField] ?? null;
        return row;
    });

    const { error } = await supabase
        .from(dimension.table)
        .upsert(rows, { onConflict: dimension.conflict });

    if (error) throw new Error(`Upsert ${dimension.table} failed: ${error.message}`);
    return rows.length;
}

/** Must page — see exportAllRepoSnapshots() for the identical pattern. A long date
 *  range times dozens of providers can exceed PostgREST's 1000-row cap. */
export async function getDecentralizationDimensionSnapshotHistory(dimensionKey, startDate, endDate) {
    const dimension = resolveDimension(dimensionKey);
    const columns = [
        'snapshot_date',
        dimension.nameColumn,
        ...(dimension.codeColumn ? [dimension.codeColumn] : []),
        'node_count'
    ].join(', ');

    const rows = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase
            .from(dimension.table)
            .select(columns)
            .gte('snapshot_date', startDate)
            .lte('snapshot_date', endDate)
            .order('snapshot_date', { ascending: true })
            .order('node_count', { ascending: false })
            .order(dimension.nameColumn, { ascending: true }) // tiebreak (#313)
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Fetch ${dimension.table} failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
}

export async function createDecentralizationSnapshots(snapshotDate, breakdown) {
    return createDecentralizationDimensionSnapshots('datacenter', snapshotDate, breakdown);
}

export async function getDecentralizationSnapshotHistory(startDate, endDate) {
    return getDecentralizationDimensionSnapshotHistory('datacenter', startDate, endDate);
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

export async function closeDatabase() {
    // No-op for Supabase - connection is managed by the client
    log.info('[DB] Supabase client does not require explicit close');
}

// NOTE: No top-level await — caller must use ensureInitialized() for resilient startup

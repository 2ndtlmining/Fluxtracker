import { supabase } from './supabaseClient.js';
import { categorizeImage } from '../config.js';

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
            console.log('\n🔄 Checking for schema updates...');
            const config = await import('../config.js');
            const { migrateSchema } = await import('./schemaMigrator.js');
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
        }

        // Backfill repo categories for existing rows
        try {
            const { count } = await supabase
                .from('repo_snapshots')
                .select('image_name', { count: 'exact', head: true })
                .is('category', null);
            if (count > 0) {
                console.log(`🔄 Backfilling categories for ${count} uncategorized images...`);
                setTimeout(async () => {
                    try { await backfillRepoCategories(); } catch(e) { console.warn('Backfill error:', e.message); }
                }, 100);
            }
        } catch (e) {
            console.warn('Category backfill check skipped:', e.message);
        }

        _dbReady = true;
        console.log('✅ Database initialized successfully (Supabase)');
    } catch (error) {
        _dbReady = false;
        console.error('❌ Database initialization error:', error);
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
            console.warn(`⚠️  DB init attempt ${attempt}/${MAX_ATTEMPTS} failed: ${error.message}`);
            if (attempt < MAX_ATTEMPTS) {
                console.log(`   Retrying in ${Math.round(delay / 1000)}s...`);
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 60_000); // cap at 60s
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
    const { data, error } = await supabase
        .from('current_metrics')
        .select('*')
        .eq('id', 1)
        .single();

    if (error) {
        console.error('getCurrentMetrics error:', error.message);
        return null;
    }
    return data;
}

export async function updateCurrentMetrics(metrics) {
    const current = await getCurrentMetrics();
    if (!current) return;

    const mergedMetrics = {
        last_update: Date.now(),
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
        gitapps_count: metrics.gitapps_count ?? current.gitapps_count ?? null,
        dockerapps_count: metrics.dockerapps_count ?? current.dockerapps_count ?? null,
        gitapps_percent: metrics.gitapps_percent ?? current.gitapps_percent ?? null,
        dockerapps_percent: metrics.dockerapps_percent ?? current.dockerapps_percent ?? null,
        gaming_apps_total: metrics.gaming_apps_total ?? current.gaming_apps_total ?? null,
        gaming_palworld: metrics.gaming_palworld ?? current.gaming_palworld ?? null,
        gaming_enshrouded: metrics.gaming_enshrouded ?? current.gaming_enshrouded ?? null,
        gaming_minecraft: metrics.gaming_minecraft ?? current.gaming_minecraft ?? null,
        gaming_valheim: metrics.gaming_valheim ?? current.gaming_valheim ?? null,
        gaming_satisfactory: metrics.gaming_satisfactory ?? current.gaming_satisfactory ?? null,
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

    const { error } = await supabase
        .from('current_metrics')
        .update(mergedMetrics)
        .eq('id', 1);

    if (error) {
        console.error('updateCurrentMetrics error:', error.message);
    } else {
        console.log('✅ Current metrics updated');
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
        gaming_apps_total: snapshot.gaming_apps_total,
        gaming_palworld: snapshot.gaming_palworld,
        gaming_enshrouded: snapshot.gaming_enshrouded,
        gaming_minecraft: snapshot.gaming_minecraft,
        gaming_valheim: snapshot.gaming_valheim,
        gaming_satisfactory: snapshot.gaming_satisfactory,
        crypto_presearch: snapshot.crypto_presearch,
        crypto_streamr: snapshot.crypto_streamr,
        crypto_ravencoin: snapshot.crypto_ravencoin,
        crypto_kadena: snapshot.crypto_kadena,
        crypto_alephium: snapshot.crypto_alephium,
        crypto_bittensor: snapshot.crypto_bittensor,
        crypto_timpi_collector: snapshot.crypto_timpi_collector,
        crypto_timpi_geocore: snapshot.crypto_timpi_geocore,
        crypto_kaspa: snapshot.crypto_kaspa,
        crypto_nodes_total: snapshot.crypto_nodes_total,
        wordpress_count: snapshot.wordpress_count,
        node_cumulus: snapshot.node_cumulus,
        node_nimbus: snapshot.node_nimbus,
        node_stratus: snapshot.node_stratus,
        node_total: snapshot.node_total,
        sync_status: snapshot.sync_status || 'completed',
        created_at: Date.now()
    };

    const { error } = await supabase
        .from('daily_snapshots')
        .upsert(row, { onConflict: 'snapshot_date' });

    if (error) {
        console.error('createDailySnapshot error:', error.message);
    } else {
        console.log(`✅ Snapshot created for ${snapshot.snapshot_date}`);
    }
}

export async function getSnapshotByDate(date) {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .eq('snapshot_date', date)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('getSnapshotByDate error:', error.message);
    }
    return data || null;
}

export async function getLastNSnapshots(n = 30) {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(n);

    if (error) {
        console.error('getLastNSnapshots error:', error.message);
        return [];
    }
    return data || [];
}

export async function getSnapshotsInRange(startDate, endDate) {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .gte('snapshot_date', startDate)
        .lte('snapshot_date', endDate)
        .order('snapshot_date', { ascending: true });

    if (error) {
        console.error('getSnapshotsInRange error:', error.message);
        return [];
    }
    return data || [];
}

export async function getAllSnapshots() {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false });

    if (error) {
        console.error('getAllSnapshots error:', error.message);
        return [];
    }
    return data || [];
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
        console.error('deleteOldSnapshots error:', error.message);
    } else {
        console.log(`🗑️  Deleted ${count} old snapshots (older than ${cutoffDateStr})`);
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
        console.error('insertTransaction error:', error.message);
    }
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
        app_type: tx.app_type || null
    }));

    // Chunk into batches of 500 to respect Supabase limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
            .from('revenue_transactions')
            .upsert(chunk, { onConflict: 'txid', ignoreDuplicates: true });

        if (error) {
            console.error(`insertTransactionsBatch chunk error (offset ${i}):`, error.message);
            return false;
        }
    }

    console.log(`✅ Inserted ${transactions.length} transactions`);
    return true;
}

export async function getUndeterminedAppNames() {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('app_name')
        .not('app_name', 'is', null)
        .neq('app_name', '')
        .is('app_type', null);

    if (error) {
        console.error('getUndeterminedAppNames error:', error.message);
        return [];
    }

    // Deduplicate
    const unique = [...new Set((data || []).map(r => r.app_name))];
    return unique;
}

export async function updateAppTypeForAppName(appName, appType) {
    const { error } = await supabase
        .from('revenue_transactions')
        .update({ app_type: appType })
        .eq('app_name', appName)
        .is('app_type', null);

    if (error) {
        console.error('updateAppTypeForAppName error:', error.message);
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
        console.error('getTxidsWithoutAppName error:', error.message);
        return [];
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
        console.error('countTxidsWithoutAppName error:', error.message);
        return 0;
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
        console.error('updateAppNameForTxid error:', error.message);
    }
}

export async function getTransactionsByDate(date) {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('*')
        .eq('date', date)
        .limit(10000);

    if (error) {
        console.error('getTransactionsByDate error:', error.message);
        return [];
    }
    return data || [];
}

export async function getTransactionsByBlockRange(startBlock, endBlock) {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('*')
        .gte('block_height', startBlock)
        .lte('block_height', endBlock)
        .order('block_height', { ascending: false })
        .limit(10000);

    if (error) {
        console.error('getTransactionsByBlockRange error:', error.message);
        return [];
    }
    return data || [];
}

export async function getRevenueForDateRange(startDate, endDate) {
    // Use existing RPC function for server-side aggregation (avoids 1000-row limit)
    const { data, error } = await supabase.rpc('get_daily_revenue_in_range', {
        p_start: startDate,
        p_end: endDate
    });

    if (error) {
        console.error('getRevenueForDateRange error:', error.message);
        return 0;
    }
    // Sum the daily totals
    return (data || []).reduce((sum, row) => sum + (row.daily_revenue || 0), 0);
}

export async function getPaymentCountForDateRange(startDate, endDate) {
    const { count, error } = await supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate);

    if (error) {
        console.error('getPaymentCountForDateRange error:', error.message);
        return 0;
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
            .range(offset, offset + pageSize - 1);

        if (error) {
            console.error('getRevenueForBlockRange error:', error.message);
            return total;
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
        console.error('getLastSyncedBlock error:', error.message);
    }
    return data?.block_height || null;
}

export async function getTxidCount() {
    const { count, error } = await supabase
        .from('revenue_transactions')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('getTxidCount error:', error.message);
        return 0;
    }
    return count || 0;
}

export async function getTransactionsPaginated(page = 1, limit = 50, search = '', appName = null) {
    const offset = (page - 1) * limit;

    const { data, error } = await supabase.rpc('get_transactions_paginated', {
        p_search: search || null,
        p_app: appName || null,
        p_limit: limit,
        p_offset: offset
    });

    if (error) {
        console.error('getTransactionsPaginated error:', error.message);
        return { transactions: [], total: 0, page, limit, offset };
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
        console.error('getAppAnalytics error:', error.message);
        return { apps: [], total: 0, page, limit, offset };
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const startDate = cutoff.toISOString().split('T')[0];

    const { data, error } = await supabase.rpc('get_daily_revenue', {
        start_date: startDate
    });

    if (error) {
        console.error('getDailyRevenueFromTransactions error:', error.message);
        return [];
    }
    console.log(`✅ Retrieved daily revenue for ${(data || []).length} days from transactions`);
    return data || [];
}

export async function getDailyRevenueInRange(startDate, endDate) {
    const { data, error } = await supabase.rpc('get_daily_revenue_in_range', {
        p_start: startDate,
        p_end: endDate
    });

    if (error) {
        console.error('getDailyRevenueInRange error:', error.message);
        return [];
    }
    console.log(`✅ Retrieved daily revenue for ${(data || []).length} days from transactions (${startDate} to ${endDate})`);
    return data || [];
}

export async function getDailyRevenueUSDFromTransactions(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const startDate = cutoff.toISOString().split('T')[0];

    const { data, error } = await supabase.rpc('get_daily_revenue_usd', {
        start_date: startDate
    });

    if (error) {
        console.error('getDailyRevenueUSDFromTransactions error:', error.message);
        return [];
    }
    console.log(`✅ Retrieved daily USD revenue for ${(data || []).length} days from transactions`);
    return data || [];
}

export async function getDailyRevenueUSDInRange(startDate, endDate) {
    const { data, error } = await supabase.rpc('get_daily_revenue_usd_in_range', {
        p_start: startDate,
        p_end: endDate
    });

    if (error) {
        console.error('getDailyRevenueUSDInRange error:', error.message);
        return [];
    }
    console.log(`✅ Retrieved daily USD revenue for ${(data || []).length} days from transactions (${startDate} to ${endDate})`);
    return data || [];
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
        console.error('deleteOldTransactions error:', error.message);
    } else {
        console.log(`🗑️  Deleted ${count} old transactions (older than ${cutoffDateStr})`);
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
        console.error('getUnresolvedFailedTxids error:', error.message);
        return [];
    }
    return data || [];
}

export async function resolveFailedTxid(txid) {
    const { error } = await supabase
        .from('failed_txids')
        .update({ resolved: 1 })
        .eq('txid', txid);

    if (error) {
        console.error('resolveFailedTxid error:', error.message);
    }
}

export async function getFailedTxidCount() {
    const { count, error } = await supabase
        .from('failed_txids')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', 0);

    if (error) {
        console.error('getFailedTxidCount error:', error.message);
        return 0;
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
        console.error('clearAbandonedFailedTxids error:', error.message);
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
        console.error('isFailedTxid error:', error.message);
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
        console.error('getSyncStatus error:', error.message);
    }
    return data || null;
}

export async function updateSyncStatus(syncType, status, errorMessage = null, lastBlock = null) {
    const { error } = await supabase
        .from('sync_status')
        .update({
            last_sync: Date.now(),
            last_sync_block: lastBlock,
            status,
            error_message: errorMessage
        })
        .eq('sync_type', syncType);

    if (error) {
        console.error('updateSyncStatus error:', error.message);
    }
}

export async function resetRevenueSyncBlock() {
    const { error } = await supabase
        .from('sync_status')
        .update({ last_sync_block: null })
        .eq('sync_type', 'revenue');

    if (error) {
        console.error('resetRevenueSyncBlock error:', error.message);
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
        console.error('setNextSync error:', error.message);
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
            console.error(`insertPriceHistoryBatch chunk error (offset ${i}):`, error.message);
            return false;
        }
    }

    console.log(`Inserted/updated ${prices.length} price history rows`);
    return true;
}

export async function getPriceForDate(date) {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('price_usd')
        .eq('date', date)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('getPriceForDate error:', error.message);
    }
    return data ? data.price_usd : null;
}

export async function getPricesForDateRange(startDate, endDate) {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('date, price_usd')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

    if (error) {
        console.error('getPricesForDateRange error:', error.message);
        return [];
    }
    return data || [];
}

export async function getLatestPriceDate() {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('getLatestPriceDate error:', error.message);
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
        console.error('getOldestPriceDate error:', error.message);
    }
    return data ? data.date : null;
}

export async function getTransactionsWithNullUsd(limit = 1000) {
    const { data, error } = await supabase
        .from('revenue_transactions')
        .select('txid, amount, date, timestamp')
        .is('amount_usd', null)
        .order('block_height', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('getTransactionsWithNullUsd error:', error.message);
        return [];
    }
    return data || [];
}

export async function updateTransactionUsdBatch(updates) {
    if (!updates || updates.length === 0) return true;

    // Batch update: Supabase doesn't support batch update by different PKs natively,
    // so we do individual updates in chunks
    const CHUNK_SIZE = 500;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
        const chunk = updates.slice(i, i + CHUNK_SIZE);
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
            console.error('updateTransactionUsdBatch error:', firstError.error.message);
            return false;
        }
    }

    console.log(`Updated USD for ${updates.length} transactions`);
    return true;
}

export async function getPriceHistoryCount() {
    const { count, error } = await supabase
        .from('flux_price_history')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('getPriceHistoryCount error:', error.message);
        return 0;
    }
    return count || 0;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

export async function getDatabaseStats() {
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
            console.error(`createRepoSnapshots chunk error (offset ${i}):`, error.message);
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
        console.error('getRepoSnapshotCountByDate error:', error.message);
        return 0;
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
            console.error('getRepoHistory (merged) error:', error.message);
            return [];
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
        console.error('getRepoHistory error:', error.message);
        return [];
    }
    return data || [];
}

export async function getDistinctRepos() {
    const { data, error } = await supabase.rpc('get_distinct_repos');

    if (error) {
        console.error('getDistinctRepos error:', error.message);
        return [];
    }

    return (data || []).map(r => r.image_name);
}

export async function getLatestRepoSnapshot() {
    // Get the latest date
    const { data: dateRow, error: dateError } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

    if (dateError || !dateRow) return [];

    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('image_name, instance_count')
        .eq('snapshot_date', dateRow.snapshot_date)
        .order('instance_count', { ascending: false });

    if (error) {
        console.error('getLatestRepoSnapshot error:', error.message);
        return [];
    }
    return data || [];
}

// ============================================
// CATEGORY-BASED REPO QUERIES
// ============================================

export async function getTopReposByCategory(category, limit = 3) {
    const { data, error } = await supabase.rpc('get_top_repos_by_category', {
        cat: category,
        lim: limit
    });

    if (error) {
        console.error('getTopReposByCategory error:', error.message);
        return { date: null, repos: [] };
    }

    // Get the latest date for this category
    const { data: dateRow } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .eq('category', category)
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

    return {
        date: dateRow?.snapshot_date || null,
        repos: data || []
    };
}

export async function getCategoryTotal(category, date) {
    const { data, error } = await supabase
        .from('repo_snapshots')
        .select('instance_count')
        .eq('category', category)
        .eq('snapshot_date', date);

    if (error) {
        console.error('getCategoryTotal error:', error.message);
        return 0;
    }
    return (data || []).reduce((sum, r) => sum + (r.instance_count || 0), 0);
}

export async function getCategoryHistory(category, limit = 90) {
    const { data, error } = await supabase.rpc('get_category_history', {
        cat: category,
        lim: limit
    });

    if (error) {
        console.error('getCategoryHistory error:', error.message);
        return [];
    }
    return data || [];
}

export async function getReposByCategory(category) {
    const { data, error } = await supabase.rpc('get_repos_by_category', {
        cat: category
    });

    if (error) {
        console.error('getReposByCategory error:', error.message);
        return [];
    }
    return data || [];
}

export async function backfillRepoCategories() {
    const { data: rows, error } = await supabase
        .from('repo_snapshots')
        .select('image_name')
        .is('category', null);

    if (error || !rows || rows.length === 0) return 0;

    // Deduplicate
    const uniqueImages = [...new Set(rows.map(r => r.image_name))];
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

    console.log(`Backfilled categories for ${updated} of ${uniqueImages.length} distinct images`);
    return uniqueImages.length;
}

export async function recategorizeAllRepos() {
    // Reset all categories to NULL
    await supabase
        .from('repo_snapshots')
        .update({ category: null })
        .neq('id', 0); // update all

    // Get all distinct images
    const { data: rows } = await supabase
        .from('repo_snapshots')
        .select('image_name');

    const uniqueImages = [...new Set((rows || []).map(r => r.image_name))];
    const counts = {};

    for (const imageName of uniqueImages) {
        const cat = categorizeImage(imageName);
        if (cat) {
            await supabase
                .from('repo_snapshots')
                .update({ category: cat })
                .eq('image_name', imageName);
            counts[cat] = (counts[cat] || 0) + 1;
        }
    }

    console.log(`Re-categorized ${uniqueImages.length} images:`, counts);
    return { resetCount: uniqueImages.length, categorized: counts };
}

// ============================================
// BACKUP EXPORT / IMPORT
// ============================================

export async function exportAllPriceHistory() {
    const { data, error } = await supabase
        .from('flux_price_history')
        .select('*')
        .order('date', { ascending: true });

    if (error) throw new Error(`Export flux_price_history failed: ${error.message}`);
    return data || [];
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

export async function exportAllDailySnapshots() {
    const { data, error } = await supabase
        .from('daily_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: true });

    if (error) throw new Error(`Export daily_snapshots failed: ${error.message}`);
    return data || [];
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
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw new Error(`Export repo_snapshots failed: ${error.message}`);
        if (!data || data.length === 0) break;

        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    return rows;
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

export async function closeDatabase() {
    // No-op for Supabase - connection is managed by the client
    console.log('✅ Supabase client does not require explicit close');
}

// NOTE: No top-level await — caller must use ensureInitialized() for resilient startup

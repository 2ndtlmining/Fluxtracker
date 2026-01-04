// lib/db/snapshotManager.js - SIMPLIFIED VERSION
// ✅ No backfill - only creates TODAY's snapshot
// ✅ Includes gaming_valheim (fixes 36/37 column mismatch)
// ✅ Uses transaction-based revenue
// ✅ Runs every 30 minutes

import { 
    createDailySnapshot, 
    getCurrentMetrics,
    getSnapshotByDate,
    getRevenueForDateRange
} from './database.js';

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    CHECK_INTERVAL_MS: 30 * 60 * 1000,  // Check every 30 minutes
    GRACE_PERIOD_MINUTES: 5,             // Wait 5 minutes after midnight
    MIN_VALID_METRICS: 2,                // Only need 2 metrics populated
    MAX_METRIC_AGE_HOURS: 24,            // Accept metrics up to 24 hours old
};

let state = {
    isRunning: false,
    lastCheck: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    intervalId: null,
};

export function getSnapshotState() {
    return { ...state };
}

export function getSnapshotSystemStatus() {
    const today = new Date().toISOString().split('T')[0];
    const todaySnapshot = getSnapshotByDate(today);
    
    return {
        config: CONFIG,
        state: state,
        todaySnapshotExists: !!todaySnapshot,
        todaySnapshotDate: todaySnapshot?.snapshot_date || null,
        isHealthy: state.consecutiveFailures < 3
    };
}

// ============================================
// VALIDATION
// ============================================

function areMetricsPopulated(metrics) {
    if (!metrics) {
        return { valid: false, reason: 'No metrics in database' };
    }
    
    if (!metrics.last_update) {
        return { valid: false, reason: 'No last_update timestamp' };
    }
    
    const metricAge = Date.now() - metrics.last_update;
    const maxAge = CONFIG.MAX_METRIC_AGE_HOURS * 60 * 60 * 1000;
    
    if (metricAge > maxAge) {
        const ageHours = Math.round(metricAge / 1000 / 60 / 60);
        return { valid: false, reason: `Metrics ${ageHours}h old (max ${CONFIG.MAX_METRIC_AGE_HOURS}h)` };
    }
    
    const keyMetrics = [
        metrics.node_total,
        metrics.total_apps,
        metrics.total_cpu_cores,
        metrics.total_ram_gb,
        metrics.total_storage_gb
    ];
    
    const nonZeroCount = keyMetrics.filter(v => v && v > 0).length;
    
    if (nonZeroCount < CONFIG.MIN_VALID_METRICS) {
        return { 
            valid: false, 
            reason: `Only ${nonZeroCount}/${keyMetrics.length} metrics populated (need ${CONFIG.MIN_VALID_METRICS})` 
        };
    }
    
    const ageMinutes = Math.round(metricAge / 1000 / 60);
    return { 
        valid: true, 
        reason: `Valid: ${nonZeroCount}/${keyMetrics.length} metrics, ${ageMinutes}min old` 
    };
}

// ============================================
// SNAPSHOT CREATION
// ============================================

function shouldTakeSnapshot() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Check if today's snapshot exists
    const existingSnapshot = getSnapshotByDate(today);
    if (existingSnapshot) {
        return {
            should: false,
            reason: `Snapshot already exists for ${today}`
        };
    }
    
    // Check grace period after midnight
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const minutesSinceMidnight = currentHour * 60 + currentMinute;
    
    if (minutesSinceMidnight < CONFIG.GRACE_PERIOD_MINUTES) {
        return {
            should: false,
            reason: `Within grace period (${CONFIG.GRACE_PERIOD_MINUTES} min after midnight)`
        };
    }
    
    // Validate metrics
    const currentMetrics = getCurrentMetrics();
    const metricsCheck = areMetricsPopulated(currentMetrics);
    
    if (!metricsCheck.valid) {
        return {
            should: false,
            reason: `Metrics not ready: ${metricsCheck.reason}`
        };
    }
    
    return {
        should: true,
        reason: `Ready: ${metricsCheck.reason}`
    };
}

async function takeSnapshot() {
    console.log('📸 Taking snapshot...');
    
    try {
        const now = new Date();
        const snapshotDate = now.toISOString().split('T')[0];
        
        const currentMetrics = getCurrentMetrics();
        
        if (!currentMetrics) {
            throw new Error('No current metrics available');
        }
        
        // Get actual revenue from transactions for TODAY
        const actualRevenue = getRevenueForDateRange(snapshotDate, snapshotDate);
        
        console.log(`   💰 Revenue for ${snapshotDate}: ${actualRevenue.toFixed(2)} FLUX`);
        
        const snapshotData = {
            snapshot_date: snapshotDate,
            timestamp: Math.floor(now.getTime() / 1000),
            
            // Revenue - FROM TRANSACTIONS
            daily_revenue: actualRevenue,
            flux_price_usd: currentMetrics.flux_price_usd || null,
            
            // Cloud Utilization
            total_cpu_cores: currentMetrics.total_cpu_cores || 0,
            used_cpu_cores: currentMetrics.used_cpu_cores || 0,
            cpu_utilization_percent: currentMetrics.cpu_utilization_percent || 0,
            
            total_ram_gb: currentMetrics.total_ram_gb || 0,
            used_ram_gb: currentMetrics.used_ram_gb || 0,
            ram_utilization_percent: currentMetrics.ram_utilization_percent || 0,
            
            total_storage_gb: currentMetrics.total_storage_gb || 0,
            used_storage_gb: currentMetrics.used_storage_gb || 0,
            storage_utilization_percent: currentMetrics.storage_utilization_percent || 0,
            
            // Apps
            total_apps: currentMetrics.total_apps || 0,
            watchtower_count: currentMetrics.watchtower_count || 0,
            
            // Gaming - ✅ INCLUDES gaming_valheim
            gaming_apps_total: currentMetrics.gaming_apps_total || 0,
            gaming_palworld: currentMetrics.gaming_palworld || 0,
            gaming_enshrouded: currentMetrics.gaming_enshrouded || 0,
            gaming_minecraft: currentMetrics.gaming_minecraft || 0,
            gaming_valheim: currentMetrics.gaming_valheim || 0,
            gaming_satisfactory: currentMetrics.gaming_satisfactory || 0,
            
            // Crypto Nodes
            crypto_presearch: currentMetrics.crypto_presearch || 0,
            crypto_streamr: currentMetrics.crypto_streamr || 0,
            crypto_ravencoin: currentMetrics.crypto_ravencoin || 0,
            crypto_kadena: currentMetrics.crypto_kadena || 0,
            crypto_alephium: currentMetrics.crypto_alephium || 0,
            crypto_bittensor: currentMetrics.crypto_bittensor || 0,
            crypto_timpi_collector: currentMetrics.crypto_timpi_collector || 0,
            crypto_timpi_geocore: currentMetrics.crypto_timpi_geocore || 0,
            crypto_kaspa: currentMetrics.crypto_kaspa || 0,
            crypto_nodes_total: currentMetrics.crypto_nodes_total || 0,
            
            // WordPress
            wordpress_count: currentMetrics.wordpress_count || 0,
            
            // Nodes
            node_cumulus: currentMetrics.node_cumulus || 0,
            node_nimbus: currentMetrics.node_nimbus || 0,
            node_stratus: currentMetrics.node_stratus || 0,
            node_total: currentMetrics.node_total || 0,
            
            sync_status: 'completed'
        };
        
        createDailySnapshot(snapshotData);
        
        state.lastSuccess = Date.now();
        state.consecutiveFailures = 0;
        
        console.log(`✅ Snapshot created for ${snapshotDate}`);
        console.log(`   Revenue: ${snapshotData.daily_revenue.toFixed(2)} FLUX`);
        console.log(`   Nodes: ${snapshotData.node_total}, Apps: ${snapshotData.total_apps}`);
        
        return {
            success: true,
            snapshotDate,
            data: snapshotData
        };
        
    } catch (error) {
        console.error('❌ Snapshot failed:', error.message);
        state.consecutiveFailures++;
        
        return {
            success: false,
            error: error.message
        };
    }
}

// ============================================
// MAIN CHECK
// ============================================

async function runCheck() {
    const now = new Date();
    state.lastCheck = Date.now();
    
    console.log(`\n⏰ Snapshot check at ${now.toISOString()}`);
    
    if (state.isRunning) {
        console.log('⏸️  Previous check still running, skipping...');
        return;
    }
    
    try {
        state.isRunning = true;
        
        const check = shouldTakeSnapshot();
        
        if (!check.should) {
            console.log(`⏸️  ${check.reason}`);
            return;
        }
        
        console.log(`✅ ${check.reason} - taking snapshot...`);
        const result = await takeSnapshot();
        
        if (!result.success) {
            console.error(`❌ Snapshot failed: ${result.error}`);
            
            if (state.consecutiveFailures >= 3) {
                console.error(`🚨 ALERT: ${state.consecutiveFailures} consecutive failures!`);
            }
        }
        
    } catch (error) {
        console.error('❌ Check error:', error);
        state.consecutiveFailures++;
    } finally {
        state.isRunning = false;
    }
}

// ============================================
// PUBLIC API
// ============================================

export function startSnapshotChecker() {
    if (state.intervalId) {
        console.warn('⚠️  Snapshot checker already running');
        return;
    }
    
    console.log('🚀 Starting snapshot checker...');
    console.log(`   Check interval: ${CONFIG.CHECK_INTERVAL_MS / 1000 / 60} minutes`);
    console.log(`   Grace period: ${CONFIG.GRACE_PERIOD_MINUTES} minutes after midnight`);
    
    // Run immediately on startup
    runCheck();
    
    // Then every 30 minutes
    state.intervalId = setInterval(runCheck, CONFIG.CHECK_INTERVAL_MS);
    
    console.log('✅ Snapshot checker started\n');
}

export function stopSnapshotChecker() {
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
        console.log('🛑 Snapshot checker stopped');
    }
}

export async function takeManualSnapshot() {
    console.log('🔧 Manual snapshot triggered...');
    
    const check = shouldTakeSnapshot();
    
    if (!check.should) {
        return {
            success: false,
            skipped: true,
            reason: check.reason
        };
    }
    
    return await takeSnapshot();
}
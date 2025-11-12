import { 
    createDailySnapshot, 
    getCurrentMetrics,
    getSnapshotByDate
} from './database.js';

/**
 * SIMPLIFIED SNAPSHOT MANAGER
 * Dead simple logic: Check every 30 minutes if today's snapshot exists. If not, create it.
 */

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    CHECK_INTERVAL_MS: 30 * 60 * 1000,  // Check every 30 minutes
    GRACE_PERIOD_MINUTES: 5,             // Wait 5 minutes after midnight before first snapshot
};

// ============================================
// STATE TRACKING (for monitoring only)
// ============================================

let state = {
    isRunning: false,
    lastCheck: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    intervalId: null
};

/**
 * Get current state (for status endpoint)
 */
export function getSnapshotState() {
    return { ...state };
}

/**
 * Get system status (for health checks)
 */
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
// CORE SNAPSHOT LOGIC (SIMPLIFIED)
// ============================================

/**
 * Check if we should take a snapshot right now
 * SIMPLE LOGIC: Just check if today's snapshot exists!
 */
function shouldTakeSnapshot() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    // Check 1: Does today's snapshot exist?
    const existingSnapshot = getSnapshotByDate(today);
    if (existingSnapshot) {
        return {
            should: false,
            reason: `Snapshot already exists for ${today}`
        };
    }
    
    // Check 2: Are we past the grace period after midnight?
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const minutesSinceMidnight = currentHour * 60 + currentMinute;
    
    if (minutesSinceMidnight < CONFIG.GRACE_PERIOD_MINUTES) {
        return {
            should: false,
            reason: `Within grace period (${CONFIG.GRACE_PERIOD_MINUTES} min after midnight)`
        };
    }
    
    // If we get here: No snapshot exists AND past grace period
    return {
        should: true,
        reason: 'No snapshot exists for today and past grace period'
    };
}

/**
 * Take a snapshot (the actual work)
 */
async function takeSnapshot() {
    console.log('📸 Taking snapshot...');
    
    try {
        const now = new Date();
        const snapshotDate = now.toISOString().split('T')[0];
        
        // Get current metrics
        const currentMetrics = getCurrentMetrics();
        
        if (!currentMetrics) {
            throw new Error('No current metrics available');
        }
        
        // Check if metrics are recent (within last 24 hours)
        const metricAge = Date.now() - currentMetrics.last_update;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (metricAge > maxAge) {
            console.warn(`⚠️  Metrics are ${Math.round(metricAge / 1000 / 60 / 60)} hours old`);
            // Continue anyway - better to have old data than no data
        }
        
        // Prepare snapshot data
        const snapshotData = {
            snapshot_date: snapshotDate,
            timestamp: Math.floor(now.getTime() / 1000),
            
            // Revenue
            daily_revenue: currentMetrics.current_revenue || 0,
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
            
            // Gaming
            gaming_apps_total: currentMetrics.gaming_apps_total || 0,
            gaming_palworld: currentMetrics.gaming_palworld || 0,
            gaming_enshrouded: currentMetrics.gaming_enshrouded || 0,
            gaming_minecraft: currentMetrics.gaming_minecraft || 0,
            
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
        
        // Create the snapshot
        createDailySnapshot(snapshotData);
        
        // Update state
        state.lastSuccess = Date.now();
        state.consecutiveFailures = 0;
        
        console.log(`✅ Snapshot created for ${snapshotDate}`);
        console.log(`   Revenue: ${snapshotData.daily_revenue.toFixed(2)} FLUX`);
        console.log(`   Nodes: ${snapshotData.node_total}`);
        console.log(`   Apps: ${snapshotData.total_apps}`);
        
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

/**
 * Main check function - runs every 30 minutes
 */
async function runCheck() {
    const now = new Date();
    state.lastCheck = Date.now();
    
    console.log(`\n⏰ Snapshot check at ${now.toISOString()}`);
    
    // Prevent concurrent runs
    if (state.isRunning) {
        console.log('⏭️  Previous check still running, skipping...');
        return;
    }
    
    try {
        state.isRunning = true;
        
        // Check if we should take a snapshot
        const check = shouldTakeSnapshot();
        
        if (!check.should) {
            console.log(`⏭️  ${check.reason}`);
            return;
        }
        
        // Take the snapshot
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

/**
 * Start the snapshot checker
 * This runs indefinitely, checking every 30 minutes
 */
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
    
    // Then run every 30 minutes
    state.intervalId = setInterval(runCheck, CONFIG.CHECK_INTERVAL_MS);
    
    console.log('✅ Snapshot checker started and will run every 30 minutes');
}

/**
 * Stop the snapshot checker
 */
export function stopSnapshotChecker() {
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
        console.log('🛑 Snapshot checker stopped');
    }
}

/**
 * Manual snapshot trigger (for API endpoint)
 */
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

// ============================================
// THAT'S IT! SIMPLE AND BULLETPROOF!
// ============================================
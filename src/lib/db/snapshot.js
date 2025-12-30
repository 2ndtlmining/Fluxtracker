import cron from 'node-cron';
import { 
    createDailySnapshot, 
    getCurrentMetrics,
    getSnapshotByDate,
    deleteOldSnapshots,
    deleteOldTransactions,
    updateSyncStatus,
    getRevenueForDateRange
} from './database.js';

/**
 * Takes a daily snapshot at midnight UTC
 * Runs automatically via cron job
 */
export function takeSnapshot() {
    try {
        console.log('📸 Taking daily snapshot...');
        
        const now = new Date();
        const snapshotDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Check if snapshot already exists for today
        const existingSnapshot = getSnapshotByDate(snapshotDate);
        if (existingSnapshot) {
            console.log(`⚠️  Snapshot already exists for ${snapshotDate}`);
            return existingSnapshot;
        }
        
        // Get current metrics from the database
        const currentMetrics = getCurrentMetrics();
        
        if (!currentMetrics) {
            throw new Error('No current metrics available to snapshot');
        }
        
        // Prepare snapshot data
        const snapshotData = {
            snapshot_date: snapshotDate,
            timestamp: Math.floor(now.getTime() / 1000),
            
            // Revenue - use current_revenue from current_metrics
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
            gaming_valheim: currentMetrics.gaming_valheim || 0, 
            
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
        
        // Update sync status
        updateSyncStatus('daily_snapshot', 'completed');
        
        console.log(`✅ Daily snapshot created successfully for ${snapshotDate}`);
        
        return snapshotData;
        
    } catch (error) {
        console.error('❌ Error taking snapshot:', error);
        updateSyncStatus('daily_snapshot', 'failed', error.message);
        throw error;
    }
}

/**
 * BACKFILL SNAPSHOTS FROM REVENUE TRANSACTIONS
 * This function creates historical snapshots using revenue transaction data
 * Use this once to populate snapshots for dates where you have revenue but no snapshots
 */
export function backfillRevenueSnapshots(startDate, endDate) {
    console.log(`📊 Backfilling snapshots from ${startDate} to ${endDate}...`);
    
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        let created = 0;
        let skipped = 0;
        
        // Iterate through each day
        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const dateStr = date.toISOString().split('T')[0];
            
            // Check if snapshot already exists
            const existing = getSnapshotByDate(dateStr);
            if (existing) {
                skipped++;
                continue;
            }
            
            // Get revenue for this specific date
            const dailyRevenue = getRevenueForDateRange(dateStr, dateStr);
            
            // Skip if no revenue data for this date
            if (!dailyRevenue || dailyRevenue === 0) {
                continue;
            }
            
            // Create snapshot with revenue data
            // Note: Other metrics will be 0 since we don't have historical data for them
            const snapshotData = {
                snapshot_date: dateStr,
                timestamp: Math.floor(date.getTime() / 1000),
                
                // Revenue from transactions
                daily_revenue: dailyRevenue,
                flux_price_usd: null, // No historical price data
                
                // All other metrics set to 0 (we don't have historical data)
                total_cpu_cores: 0,
                used_cpu_cores: 0,
                cpu_utilization_percent: 0,
                total_ram_gb: 0,
                used_ram_gb: 0,
                ram_utilization_percent: 0,
                total_storage_gb: 0,
                used_storage_gb: 0,
                storage_utilization_percent: 0,
                total_apps: 0,
                watchtower_count: 0,
                gaming_apps_total: 0,
                gaming_palworld: 0,
                gaming_enshrouded: 0,
                gaming_minecraft: 0,
                gaming_valheim: 0,
                crypto_presearch: 0,
                crypto_streamr: 0,
                crypto_ravencoin: 0,
                crypto_kadena: 0,
                crypto_alephium: 0,
                crypto_bittensor: 0,
                crypto_timpi_collector: 0,
                crypto_timpi_geocore: 0,
                crypto_kaspa: 0,
                crypto_nodes_total: 0,
                wordpress_count: 0,
                node_cumulus: 0,
                node_nimbus: 0,
                node_stratus: 0,
                node_total: 0,
                sync_status: 'backfilled'
            };
            
            createDailySnapshot(snapshotData);
            created++;
        }
        
        console.log(`✅ Backfill complete: ${created} snapshots created, ${skipped} skipped (already existed)`);
        
        return { created, skipped };
        
    } catch (error) {
        console.error('❌ Error during backfill:', error);
        throw error;
    }
}

/**
 * Manual snapshot (can be triggered anytime for testing)
 */
export function takeManualSnapshot() {
    console.log('🔧 Taking manual snapshot...');
    return takeSnapshot();
}

/**
 * Cleanup old data (snapshots and transactions older than retention period)
 */
export function cleanupOldData(retentionDays = 365) {
    console.log(`🗑️  Cleaning up data older than ${retentionDays} days...`);
    
    try {
        const snapshotsDeleted = deleteOldSnapshots(retentionDays);
        const transactionsDeleted = deleteOldTransactions(retentionDays);
        
        console.log(`✅ Cleanup complete:`);
        console.log(`   Snapshots deleted: ${snapshotsDeleted}`);
        console.log(`   Transactions deleted: ${transactionsDeleted}`);
        
        return {
            snapshotsDeleted,
            transactionsDeleted
        };
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error);
        throw error;
    }
}

/**
 * Schedule daily snapshot at midnight UTC
 */
export function scheduleSnapshotJob() {
    // Run at 00:05 UTC (5 minutes after midnight)
    const job = cron.schedule('5 0 * * *', () => {
        console.log('\n⏰ Scheduled snapshot job triggered');
        takeSnapshot();
    }, {
        timezone: 'UTC'
    });
    
    console.log('📅 Snapshot job scheduled (runs at 00:05 UTC daily)');
    return job;
}

/**
 * Schedule weekly cleanup job
 */
export function scheduleCleanupJob() {
    // Run every Sunday at 3 AM UTC
    const job = cron.schedule('0 3 * * 0', () => {
        console.log('\n🗑️  Scheduled cleanup job triggered');
        cleanupOldData(365); // Keep 1 year of data
    }, {
        timezone: 'UTC'
    });
    
    console.log('📅 Cleanup job scheduled (runs Sundays at 03:00 UTC)');
    return job;
}

/**
 * NEW: Compare current metrics vs snapshot from X days ago
 * UPDATED: Now includes CPU, RAM, and Storage comparisons
 */
export function getComparisonWithCurrent(daysAgo) {
    // Get current live metrics
    const currentMetrics = getCurrentMetrics();
    
    if (!currentMetrics) {
        console.warn('⚠️  No current metrics available');
        return null;
    }
    
    // Calculate the comparison date
    const compareDate = new Date();
    compareDate.setDate(compareDate.getDate() - daysAgo);
    const compareDateStr = compareDate.toISOString().split('T')[0];
    
    // Get snapshot from X days ago
    const pastSnapshot = getSnapshotByDate(compareDateStr);
    
    if (!pastSnapshot) {
        console.warn(`⚠️  No snapshot found for ${compareDateStr}`);
        return null;
    }
    
    const calculateChange = (oldVal, newVal) => {
        if (oldVal === 0) return newVal > 0 ? 100 : 0;
        return ((newVal - oldVal) / oldVal) * 100;
    };
    
    const calculateDifference = (oldVal, newVal) => {
        return newVal - oldVal;
    };
    
    // FIXED: Get today's date for transaction-based revenue comparison
    const today = new Date().toISOString().split('T')[0];
    
    // Get actual daily revenue from transactions for both dates
    const todayRevenue = getRevenueForDateRange(today, today);
    const pastRevenue = getRevenueForDateRange(compareDateStr, compareDateStr);
    
    // Compare current metrics to past snapshot
    return {
        revenue: {
            old: pastRevenue,
            new: todayRevenue,
            change: calculateChange(pastRevenue, todayRevenue),
            difference: calculateDifference(pastRevenue, todayRevenue)
        },
        apps: {
            old: pastSnapshot.total_apps,
            new: currentMetrics.total_apps,
            change: calculateChange(pastSnapshot.total_apps, currentMetrics.total_apps),
            difference: calculateDifference(pastSnapshot.total_apps, currentMetrics.total_apps)
        },
        gaming: {
            old: pastSnapshot.gaming_apps_total,
            new: currentMetrics.gaming_apps_total,
            change: calculateChange(pastSnapshot.gaming_apps_total, currentMetrics.gaming_apps_total),
            difference: calculateDifference(pastSnapshot.gaming_apps_total, currentMetrics.gaming_apps_total)
        },
        crypto: {
            old: pastSnapshot.crypto_nodes_total,
            new: currentMetrics.crypto_nodes_total,
            change: calculateChange(pastSnapshot.crypto_nodes_total, currentMetrics.crypto_nodes_total),
            difference: calculateDifference(pastSnapshot.crypto_nodes_total, currentMetrics.crypto_nodes_total)
        },
        wordpress: {
            old: pastSnapshot.wordpress_count,
            new: currentMetrics.wordpress_count,
            change: calculateChange(pastSnapshot.wordpress_count, currentMetrics.wordpress_count),
            difference: calculateDifference(pastSnapshot.wordpress_count, currentMetrics.wordpress_count)
        },
        nodes: {
            old: pastSnapshot.node_total,
            new: currentMetrics.node_total,
            change: calculateChange(pastSnapshot.node_total, currentMetrics.node_total),
            difference: calculateDifference(pastSnapshot.node_total, currentMetrics.node_total)
        },
        // NEW: Cloud resource comparisons
        cpu: {
            old: pastSnapshot.cpu_utilization_percent,
            new: currentMetrics.cpu_utilization_percent,
            change: calculateChange(pastSnapshot.cpu_utilization_percent, currentMetrics.cpu_utilization_percent),
            difference: calculateDifference(pastSnapshot.cpu_utilization_percent, currentMetrics.cpu_utilization_percent)
        },
        ram: {
            old: pastSnapshot.ram_utilization_percent,
            new: currentMetrics.ram_utilization_percent,
            change: calculateChange(pastSnapshot.ram_utilization_percent, currentMetrics.ram_utilization_percent),
            difference: calculateDifference(pastSnapshot.ram_utilization_percent, currentMetrics.ram_utilization_percent)
        },
        storage: {
            old: pastSnapshot.storage_utilization_percent,
            new: currentMetrics.storage_utilization_percent,
            change: calculateChange(pastSnapshot.storage_utilization_percent, currentMetrics.storage_utilization_percent),
            difference: calculateDifference(pastSnapshot.storage_utilization_percent, currentMetrics.storage_utilization_percent)
        }
    };
}

/**
 * DEPRECATED: Compare two snapshots (old method)
 * Kept for backward compatibility but not recommended
 */
export function getComparisonMetrics(date1, date2) {
    const snapshot1 = getSnapshotByDate(date1);
    const snapshot2 = getSnapshotByDate(date2);
    
    if (!snapshot1 || !snapshot2) {
        return null;
    }
    
    const calculateChange = (oldVal, newVal) => {
        if (oldVal === 0) return newVal > 0 ? 100 : 0;
        return ((newVal - oldVal) / oldVal) * 100;
    };
    
    const calculateDifference = (oldVal, newVal) => {
        return newVal - oldVal;
    };
    
    return {
        revenue: {
            old: snapshot1.daily_revenue,
            new: snapshot2.daily_revenue,
            change: calculateChange(snapshot1.daily_revenue, snapshot2.daily_revenue),
            difference: calculateDifference(snapshot1.daily_revenue, snapshot2.daily_revenue)
        },
        apps: {
            old: snapshot1.total_apps,
            new: snapshot2.total_apps,
            change: calculateChange(snapshot1.total_apps, snapshot2.total_apps),
            difference: calculateDifference(snapshot1.total_apps, snapshot2.total_apps)
        },
        gaming: {
            old: snapshot1.gaming_apps_total,
            new: snapshot2.gaming_apps_total,
            change: calculateChange(snapshot1.gaming_apps_total, snapshot2.gaming_apps_total),
            difference: calculateDifference(snapshot1.gaming_apps_total, snapshot2.gaming_apps_total)
        },
        crypto: {
            old: snapshot1.crypto_nodes_total,
            new: snapshot2.crypto_nodes_total,
            change: calculateChange(snapshot1.crypto_nodes_total, snapshot2.crypto_nodes_total),
            difference: calculateDifference(snapshot1.crypto_nodes_total, snapshot2.crypto_nodes_total)
        },
        wordpress: {
            old: snapshot1.wordpress_count,
            new: snapshot2.wordpress_count,
            change: calculateChange(snapshot1.wordpress_count, snapshot2.wordpress_count),
            difference: calculateDifference(snapshot1.wordpress_count, snapshot2.wordpress_count)
        },
        nodes: {
            old: snapshot1.node_total,
            new: snapshot2.node_total,
            change: calculateChange(snapshot1.node_total, snapshot2.node_total),
            difference: calculateDifference(snapshot1.node_total, snapshot2.node_total)
        }
    };
}

/**
 * DEPRECATED: Get metrics for specific time period (old method)
 * Kept for backward compatibility
 */
export function getTimeframeMetrics(timeframe = 'day') {
    // Convert number to string, or handle invalid input
    if (typeof timeframe === 'number') {
        // If it's a number, use it directly as days
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        const compareDate = new Date(now);
        compareDate.setDate(compareDate.getDate() - timeframe);
        const compareDateStr = compareDate.toISOString().split('T')[0];
        
        const comparison = getComparisonMetrics(compareDateStr, today);
        
        // If today's snapshot doesn't exist yet, try yesterday
        if (!comparison) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            const fallbackCompareDate = new Date(yesterday);
            fallbackCompareDate.setDate(fallbackCompareDate.getDate() - timeframe);
            const fallbackCompareDateStr = fallbackCompareDate.toISOString().split('T')[0];
            
            return getComparisonMetrics(fallbackCompareDateStr, yesterdayStr);
        }
        
        return comparison;
    }
    
    if (typeof timeframe !== 'string' || !timeframe) {
        console.warn('Invalid timeframe provided. Defaulting to "day".');
        timeframe = 'day';
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    let daysAgo;
    switch (timeframe.toLowerCase()) {
        case 'day':
        case 'd':
            daysAgo = 1;
            break;
        case 'week':
        case 'w':
            daysAgo = 7;
            break;
        case 'month':
        case 'm':
            daysAgo = 30;
            break;
        case 'quarter':
        case 'q':
            daysAgo = 90;
            break;
        case 'year':
        case 'y':
            daysAgo = 365;
            break;
        default:
            daysAgo = parseInt(timeframe) || 1; // Allow numeric input
    }
    
    const compareDate = new Date(now);
    compareDate.setDate(compareDate.getDate() - daysAgo);
    const compareDateStr = compareDate.toISOString().split('T')[0];
    
    // Get comparison
    const comparison = getComparisonMetrics(compareDateStr, today);
    
    // If today's snapshot doesn't exist yet, try yesterday
    if (!comparison) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        const fallbackCompareDate = new Date(yesterday);
        fallbackCompareDate.setDate(fallbackCompareDate.getDate() - daysAgo);
        const fallbackCompareDateStr = fallbackCompareDate.toISOString().split('T')[0];
        
        return getComparisonMetrics(fallbackCompareDateStr, yesterdayStr);
    }
    
    return comparison;
}

/**
 * Initialize all snapshot jobs
 */
export function initializeSnapshotJobs() {
    console.log('🚀 Initializing snapshot jobs...');
    
    const snapshotJob = scheduleSnapshotJob();
    const cleanupJob = scheduleCleanupJob();
    
    console.log('✅ All snapshot jobs initialized');
    
    return {
        snapshotJob,
        cleanupJob
    };
}

/**
 * UPDATED: Get analytics for comparison API
 * Now includes cloud resource comparisons (CPU, RAM, Storage)
 */
export function getAnalyticsComparison(days) {
    // Use the new comparison method
    const comparison = getComparisonWithCurrent(days);
    
    if (!comparison) {
        return null;
    }
    
    // Format for frontend
    return {
        period: days,
        changes: {
            revenue: {
                change: comparison.revenue.change,
                difference: comparison.revenue.difference,
                trend: comparison.revenue.change > 0 ? 'up' : comparison.revenue.change < 0 ? 'down' : 'neutral'
            },
            nodes: {
                change: comparison.nodes.change,
                difference: comparison.nodes.difference,
                trend: comparison.nodes.change > 0 ? 'up' : comparison.nodes.change < 0 ? 'down' : 'neutral'
            },
            gaming: {
                change: comparison.gaming.change,
                difference: comparison.gaming.difference,
                trend: comparison.gaming.change > 0 ? 'up' : comparison.gaming.change < 0 ? 'down' : 'neutral'
            },
            crypto: {
                change: comparison.crypto.change,
                difference: comparison.crypto.difference,
                trend: comparison.crypto.change > 0 ? 'up' : comparison.crypto.change < 0 ? 'down' : 'neutral'
            },
            wordpress: {
                change: comparison.wordpress.change,
                difference: comparison.wordpress.difference,
                trend: comparison.wordpress.change > 0 ? 'up' : comparison.wordpress.change < 0 ? 'down' : 'neutral'
            },
            apps: {
                change: comparison.apps.change,
                difference: comparison.apps.difference,
                trend: comparison.apps.change > 0 ? 'up' : comparison.apps.change < 0 ? 'down' : 'neutral'
            },
            // NEW: Cloud resource comparisons
            cpu: {
                change: comparison.cpu.change,
                difference: comparison.cpu.difference,
                trend: comparison.cpu.change > 0 ? 'up' : comparison.cpu.change < 0 ? 'down' : 'neutral'
            },
            ram: {
                change: comparison.ram.change,
                difference: comparison.ram.difference,
                trend: comparison.ram.change > 0 ? 'up' : comparison.ram.change < 0 ? 'down' : 'neutral'
            },
            storage: {
                change: comparison.storage.change,
                difference: comparison.storage.difference,
                trend: comparison.storage.change > 0 ? 'up' : comparison.storage.change < 0 ? 'down' : 'neutral'
            }
        }
    };
}
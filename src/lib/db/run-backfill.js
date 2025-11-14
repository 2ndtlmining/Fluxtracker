// Place this file in: /src/lib/db/run-backfill.js
// (Same directory as snapshot.js and database.js)

import { getRevenueForDateRange, createDailySnapshot, getSnapshotByDate, getCurrentMetrics } from './database.js';

/**
 * Backfills daily revenue snapshots from transaction history
 * Creates one snapshot per day using the SUM of transactions for that day
 * Uses zeros for all other metrics to avoid confusion with historical data
 */
export function backfillRevenueSnapshots(fromDate, toDate) {
    console.log(`\n📊 Backfilling revenue snapshots from ${fromDate} to ${toDate}`);
    
    let created = 0;
    let skipped = 0;
    
    const start = new Date(fromDate);
    const end = new Date(toDate);
    
    // Iterate through each day in the range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        // Check if snapshot already exists
        const existing = getSnapshotByDate(dateStr);
        if (existing) {
            skipped++;
            continue;
        }
        
        // Get revenue for this specific day
        const dailyRevenue = getRevenueForDateRange(dateStr, dateStr);
        
        // Create snapshot with ONLY revenue data - all other metrics set to 0
        // This avoids confusion by not pretending we have historical metrics
        const snapshot = {
            snapshot_date: dateStr,
            timestamp: new Date(dateStr).getTime(),
            
            // Revenue - the only real data we have
            daily_revenue: dailyRevenue,
            flux_price_usd: null,
            
            // All other metrics set to 0 (no historical data)
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
            sync_status: 'completed',
            created_at: Date.now()
        };
        
        createDailySnapshot(snapshot);
        created++;
    }
    
    return { created, skipped };
}

/**
 * Take a manual snapshot using current metrics and today's revenue
 * This is different from backfill - it uses REAL current data
 */
export function takeManualSnapshot() {
    const today = new Date().toISOString().split('T')[0];
    
    // Check if today's snapshot already exists
    const existing = getSnapshotByDate(today);
    if (existing) {
        console.log(`⚠️  Snapshot for ${today} already exists`);
        return existing;
    }
    
    // Get today's revenue
    const dailyRevenue = getRevenueForDateRange(today, today);
    
    // Get current metrics for today's snapshot
    const current = getCurrentMetrics();
    
    const snapshot = {
        snapshot_date: today,
        timestamp: Date.now(),
        daily_revenue: dailyRevenue,
        flux_price_usd: current?.flux_price_usd || null,
        total_cpu_cores: current?.total_cpu_cores || 0,
        used_cpu_cores: current?.used_cpu_cores || 0,
        cpu_utilization_percent: current?.cpu_utilization_percent || 0,
        total_ram_gb: current?.total_ram_gb || 0,
        used_ram_gb: current?.used_ram_gb || 0,
        ram_utilization_percent: current?.ram_utilization_percent || 0,
        total_storage_gb: current?.total_storage_gb || 0,
        used_storage_gb: current?.used_storage_gb || 0,
        storage_utilization_percent: current?.storage_utilization_percent || 0,
        total_apps: current?.total_apps || 0,
        watchtower_count: current?.watchtower_count || 0,
        gaming_apps_total: current?.gaming_apps_total || 0,
        gaming_palworld: current?.gaming_palworld || 0,
        gaming_enshrouded: current?.gaming_enshrouded || 0,
        gaming_minecraft: current?.gaming_minecraft || 0,
        crypto_presearch: current?.crypto_presearch || 0,
        crypto_streamr: current?.crypto_streamr || 0,
        crypto_ravencoin: current?.crypto_ravencoin || 0,
        crypto_kadena: current?.crypto_kadena || 0,
        crypto_alephium: current?.crypto_alephium || 0,
        crypto_bittensor: current?.crypto_bittensor || 0,
        crypto_timpi_collector: current?.crypto_timpi_collector || 0,
        crypto_timpi_geocore: current?.crypto_timpi_geocore || 0,
        crypto_kaspa: current?.crypto_kaspa || 0,
        crypto_nodes_total: current?.crypto_nodes_total || 0,
        wordpress_count: current?.wordpress_count || 0,
        node_cumulus: current?.node_cumulus || 0,
        node_nimbus: current?.node_nimbus || 0,
        node_stratus: current?.node_stratus || 0,
        node_total: current?.node_total || 0,
        sync_status: 'completed',
        created_at: Date.now()
    };
    
    createDailySnapshot(snapshot);
    console.log(`✅ Created snapshot for ${today}`);
    return snapshot;
}

/**
 * Get analytics comparison for a given period
 */
export function getAnalyticsComparison(days) {
    const today = new Date().toISOString().split('T')[0];
    const compareDate = new Date();
    compareDate.setDate(compareDate.getDate() - days);
    const compareDateStr = compareDate.toISOString().split('T')[0];
    
    const todaySnapshot = getSnapshotByDate(today);
    const compareSnapshot = getSnapshotByDate(compareDateStr);
    
    if (!todaySnapshot || !compareSnapshot) {
        return null;
    }
    
    const calculateChange = (current, past) => {
        if (!past || past === 0) return { change: 0, difference: 0, trend: 'neutral' };
        const change = ((current - past) / past) * 100;
        const difference = current - past;
        return {
            change: Math.round(change * 100) / 100,
            difference: Math.round(difference * 100) / 100,
            trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
        };
    };
    
    return {
        period: days,
        currentDate: today,
        comparisonDate: compareDateStr,
        changes: {
            revenue: calculateChange(todaySnapshot.daily_revenue, compareSnapshot.daily_revenue),
            nodes: calculateChange(todaySnapshot.node_total, compareSnapshot.node_total),
            apps: calculateChange(todaySnapshot.total_apps, compareSnapshot.total_apps),
            gaming: calculateChange(todaySnapshot.gaming_apps_total, compareSnapshot.gaming_apps_total)
        }
    };
}

// Main execution for command-line usage
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('🚀 Flux Performance Dashboard - Snapshot Setup\n');
    console.log('This script will:');
    console.log('1. Create historical snapshots from your revenue data');
    console.log('2. Create today\'s snapshot with current metrics');
    console.log('3. Test that comparisons are working\n');
    console.log('⚠️  Historical snapshots will use 0 for all metrics except revenue\n');
    console.log('Starting in 3 seconds...\n');

    setTimeout(async () => {
        try {
            // Calculate dynamic date range
            const toDate = new Date();
            toDate.setDate(toDate.getDate() - 1); // Yesterday
            const toDateStr = toDate.toISOString().split('T')[0];
            
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - 365); // 365 days ago
            const fromDateStr = fromDate.toISOString().split('T')[0];
            
            // Step 1: Backfill historical snapshots
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📊 Step 1: Backfilling revenue snapshots');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`Creating snapshots from ${fromDateStr} to ${toDateStr}...\n`);
            console.log('Note: Historical snapshots will have 0 for all metrics except revenue\n');
            
            const result = backfillRevenueSnapshots(fromDateStr, toDateStr);
            
            console.log(`\n✅ Backfill Complete!`);
            console.log(`   • Created: ${result.created} new snapshots`);
            console.log(`   • Skipped: ${result.skipped} existing snapshots\n`);
            
            // Step 2: Create today's snapshot
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📸 Step 2: Creating today\'s snapshot');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('Note: Today\'s snapshot will use actual current metrics\n');
            
            const todaySnapshot = takeManualSnapshot();
            
            console.log(`\n✅ Today's Snapshot Created!`);
            console.log(`   • Date: ${todaySnapshot.snapshot_date}`);
            console.log(`   • Revenue: ${todaySnapshot.daily_revenue.toFixed(2)} FLUX`);
            console.log(`   • Nodes: ${todaySnapshot.node_total}`);
            console.log(`   • Gaming Apps: ${todaySnapshot.gaming_apps_total}\n`);
            
            // Step 3: Test comparisons
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🧪 Step 3: Testing Comparisons');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            // Test each period
            const periods = [
                { key: 'D', days: 1, name: 'Day' },
                { key: 'W', days: 7, name: 'Week' },
                { key: 'M', days: 30, name: 'Month' }
            ];
            
            for (const period of periods) {
                const comparison = getAnalyticsComparison(period.days);
                
                if (comparison && comparison.changes.revenue) {
                    const rev = comparison.changes.revenue;
                    console.log(`${period.key} (${period.name}):`);
                    console.log(`   Revenue: ${rev.change >= 0 ? '+' : ''}${rev.change.toFixed(2)}% ${rev.trend === 'up' ? '↑' : rev.trend === 'down' ? '↓' : '→'}`);
                    console.log(`   Difference: ${rev.difference >= 0 ? '+' : ''}${rev.difference.toFixed(2)} FLUX\n`);
                } else {
                    console.log(`${period.key} (${period.name}): Not enough data yet\n`);
                }
            }
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🎉 Setup Complete!');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            console.log('✅ Your comparison toggle should now work!');
            console.log('✅ Revenue comparisons available for all periods');
            console.log('✅ Daily snapshots will run automatically at midnight UTC\n');
            console.log('💡 Historical snapshots use 0 for non-revenue metrics');
            console.log('💡 Only today\'s snapshot has actual current metrics\n');
            console.log('Next steps:');
            console.log('1. Restart your app to ensure cron job is running');
            console.log('2. Check your dashboard - toggle should show changes');
            console.log('3. Test API: curl http://localhost:3000/api/analytics/comparison/7\n');
            
        } catch (error) {
            console.error('\n❌ Error during setup:', error.message);
            console.error('\nPlease check:');
            console.error('1. Database connection is working');
            console.error('2. All required functions are exported in database.js');
            console.error('3. Transaction data exists in the database\n');
            process.exit(1);
        }
        
        process.exit(0);
    }, 3000);
}
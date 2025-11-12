// Place this file in: /src/lib/db/run-backfill.js
// (Same directory as snapshot.js and database.js)

import { backfillRevenueSnapshots, takeManualSnapshot, getAnalyticsComparison } from './snapshot.js';

console.log('🚀 Flux Performance Dashboard - Snapshot Setup\n');
console.log('This script will:');
console.log('1. Create historical snapshots from your revenue data');
console.log('2. Create today\'s snapshot with current metrics');
console.log('3. Test that comparisons are working\n');
console.log('Starting in 3 seconds...\n');

setTimeout(async () => {
    try {
        // Step 1: Backfill historical snapshots
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 Step 1: Backfilling revenue snapshots');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Creating snapshots from Sep 22, 2024 to Nov 5, 2025...\n');
        
        const result = backfillRevenueSnapshots('2024-09-22', '2025-11-09');
        
        console.log(`\n✅ Backfill Complete!`);
        console.log(`   • Created: ${result.created} new snapshots`);
        console.log(`   • Skipped: ${result.skipped} existing snapshots\n`);
        
        // Step 2: Create today's snapshot
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📸 Step 2: Creating today\'s snapshot');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
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
        console.log('Next steps:');
        console.log('1. Restart your app to ensure cron job is running');
        console.log('2. Check your dashboard - toggle should show changes');
        console.log('3. Test API: curl http://localhost:3000/api/analytics/comparison/7\n');
        
    } catch (error) {
        console.error('\n❌ Error during setup:', error.message);
        console.error('\nPlease check:');
        console.error('1. Database connection is working');
        console.error('2. snapshot.js is the updated version');
        console.error('3. getRevenueForDateRange is exported in database.js\n');
        process.exit(1);
    }
    
    process.exit(0);
}, 3000);
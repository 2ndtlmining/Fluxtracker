import express from 'express';
import cors from 'cors';
import { 
    getCurrentMetrics,
    getLastNSnapshots,
    getSnapshotsInRange,
    getTransactionsByDate,
    getRevenueForDateRange,
    getDatabaseStats,
    getTxidCount,
    getTransactionsPaginated,
    getDailyRevenueFromTransactions,
    getDailyRevenueInRange
} from './lib/db/database.js';

// Import the NEW snapshot manager
import { 
    startSnapshotChecker, 
    getSnapshotSystemStatus,
    takeManualSnapshot
} from './lib/db/snapshotManager.js';

// Import the revenue scheduler (wraps your existing revenueService.js)
import { 
    startRevenueSync,
    getRevenueSyncSchedulerStatus
} from './lib/services/revenueScheduler.js';

// Import revenue service for manual trigger
import { fetchRevenueStats } from './lib/services/revenueService.js';

// Import testAllServices
import { startServiceTests, getServiceTestSchedulerStatus } from './lib/services/servicesScheduler.js';
import { testAllServices } from './lib/services/test-allServices.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// LOGGING CONFIGURATION
// ============================================
const LOGGING_CONFIG = {
    enableRequestLogging: true,           // Master switch for request logging
    logHealthChecks: false,               // Don't spam logs with health checks
    logStatsEndpoints: false,             // Don't log /api/stats calls
    logMetricsEndpoints: false,           // Don't log /api/metrics/current calls
    logComparisonEndpoints: false,        // Don't log /api/analytics/comparison calls
    logHistoryEndpoints: true,            // Log history endpoint calls
    logAdminEndpoints: true,              // Always log admin actions
    logErrorsOnly: false,                 // Only log errors (overrides above)
};

// Middleware
app.use(cors());
app.use(express.json());

// Smart request logging with filters
app.use((req, res, next) => {
    if (!LOGGING_CONFIG.enableRequestLogging) {
        return next();
    }
    
    // Skip logging based on configuration
    const path = req.path.toLowerCase();
    
    if (LOGGING_CONFIG.logErrorsOnly) {
        // Only log on response if there's an error
        const originalSend = res.send;
        res.send = function(data) {
            if (res.statusCode >= 400) {
                console.log(`❌ ${new Date().toISOString()} - ${req.method} ${req.path} - Status: ${res.statusCode}`);
            }
            return originalSend.call(this, data);
        };
        return next();
    }
    
    // Skip specific endpoints based on config
    if (!LOGGING_CONFIG.logHealthChecks && path.includes('/health')) return next();
    if (!LOGGING_CONFIG.logStatsEndpoints && path.includes('/stats')) return next();
    if (!LOGGING_CONFIG.logMetricsEndpoints && path.includes('/metrics')) return next();
    if (!LOGGING_CONFIG.logComparisonEndpoints && path.includes('/comparison')) return next();
    
    // Log the request
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check (enhanced with snapshot system status)
app.get('/api/health', (req, res) => {
    try {
        const snapshotStatus = getSnapshotSystemStatus();
        
        res.json({ 
            status: 'ok', 
            timestamp: Date.now(), 
            uptime: process.uptime(),
            snapshot: {
                healthy: snapshotStatus.isHealthy,
                todaySnapshotExists: snapshotStatus.todaySnapshotExists,
                consecutiveFailures: snapshotStatus.state.consecutiveFailures,
                lastCheck: snapshotStatus.state.lastCheck,
                lastSuccess: snapshotStatus.state.lastSuccess
            }
        });
    } catch (error) {
        res.json({ 
            status: 'ok', 
            timestamp: Date.now(), 
            uptime: process.uptime(),
            snapshot: {
                error: 'Unable to get snapshot status'
            }
        });
    }
});

// NEW: Snapshot system status endpoint
app.get('/api/admin/snapshot-status', (req, res) => {
    try {
        const status = getSnapshotSystemStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Manual revenue sync trigger endpoint
app.post('/api/admin/revenue-sync', async (req, res) => {
    try {
        console.log('🔧 Manual revenue sync triggered via API');
        
        // Trigger the revenue sync
        await fetchRevenueStats();
        
        // Get transaction count after sync
        const txCount = getTxidCount();
        
        res.json({ 
            success: true,
            message: 'Revenue sync completed',
            transactionCount: txCount
        });
    } catch (error) {
        console.error('❌ Manual revenue sync failed:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// NEW: Revenue sync status endpoint
app.get('/api/admin/revenue-status', (req, res) => {
    try {
        const status = getRevenueSyncSchedulerStatus();
        const txCount = getTxidCount();
        
        res.json({
            ...status,
            transactionCount: txCount
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Manual test services trigger endpoint
app.post('/api/admin/test-services', async (req, res) => {
    try {
        console.log('🔧 Manual test services triggered via API');
        
        // Check if tests are already running
        const status = getServiceTestSchedulerStatus();
        
        if (status.isTestInProgress) {
            console.log('⚠️  Tests already in progress, skipping...');
            return res.json({
                success: false,
                alreadyRunning: true,
                message: 'Tests are already running',
                status
            });
        }
        
        // Trigger the test services
        await testAllServices();
        
        res.json({
            success: true,
            message: 'All services tested successfully',
            status: getServiceTestSchedulerStatus()
        });
    } catch (error) {
        console.error('❌ Manual test services failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// NEW: Test services status endpoint
app.get('/api/admin/test-status', (req, res) => {
    try {
        const status = getServiceTestSchedulerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Database stats
app.get('/api/stats', (req, res) => {
    try {
        const stats = getDatabaseStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Current metrics
app.get('/api/metrics/current', (req, res) => {
    try {
        console.log('Fetching current metrics');
        const metrics = getCurrentMetrics();
        if (!metrics) return res.status(404).json({ error: 'No metrics found' });
        
        res.json({
            lastUpdate: metrics.last_update,
            revenue: {
                current: metrics.current_revenue,
                fluxPriceUsd: metrics.flux_price_usd,
                usdValue: metrics.flux_price_usd ? metrics.current_revenue * metrics.flux_price_usd : null
            },
            cloud: {
                cpu: { total: metrics.total_cpu_cores, used: metrics.used_cpu_cores, utilization: metrics.cpu_utilization_percent },
                ram: { total: metrics.total_ram_gb, used: metrics.used_ram_gb, utilization: metrics.ram_utilization_percent },
                storage: { total: metrics.total_storage_gb, used: metrics.used_storage_gb, utilization: metrics.storage_utilization_percent }
            },
            apps: { total: metrics.total_apps, watchtower: metrics.watchtower_count },
            gaming: { total: metrics.gaming_apps_total, palworld: metrics.gaming_palworld, enshrouded: metrics.gaming_enshrouded, minecraft: metrics.gaming_minecraft },
            crypto: { total: metrics.crypto_nodes_total, presearch: metrics.crypto_presearch, kadena: metrics.crypto_kadena, kaspa: metrics.crypto_kaspa },
            wordpress: { count: metrics.wordpress_count },
            nodes: { cumulus: metrics.node_cumulus, nimbus: metrics.node_nimbus, stratus: metrics.node_stratus, total: metrics.node_total }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/analytics/comparison/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days) || 1;
        const { getAnalyticsComparison } = await import('./lib/db/snapshot.js');
        const comparison = getAnalyticsComparison(days);
        
        if (!comparison) {
            return res.status(404).json({ 
                error: 'No comparison data available'
            });
        }
        
        res.json(comparison);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enhanced endpoint with full snapshot data for charts
app.get('/api/history/snapshots/full', (req, res) => {
    try {
        const { limit, start_date, end_date } = req.query;
        
        // Get snapshots using existing function
        const snapshots = (start_date && end_date) 
            ? getSnapshotsInRange(start_date, end_date)
            : getLastNSnapshots(parseInt(limit) || 30);
        
        // Return FULL snapshot data (not summarized)
        res.json({
            count: snapshots.length,
            data: snapshots
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Endpoint to get daily revenue from transactions (not snapshots)
app.get('/api/history/revenue/daily', (req, res) => {
    try {
        console.log('Fetching daily revenue from transactions');
        const { limit, start_date, end_date } = req.query;
        
        // Get daily revenue aggregated from transactions
        const revenueData = (start_date && end_date)
            ? getDailyRevenueInRange(start_date, end_date)
            : getDailyRevenueFromTransactions(parseInt(limit) || 30);
        
        res.json({
            count: revenueData.length,
            data: revenueData
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Historical snapshots
app.get('/api/history/snapshots', (req, res) => {
    try {
        console.log('Fetching snapshots');
        const { limit, start_date, end_date } = req.query;
        const snapshots = (start_date && end_date) 
            ? getSnapshotsInRange(start_date, end_date)
            : getLastNSnapshots(parseInt(limit) || 30);
        
        res.json({
            count: snapshots.length,
            data: snapshots.map(s => ({
                date: s.snapshot_date,
                revenue: s.daily_revenue,
                nodes: { total: s.node_total, cumulus: s.node_cumulus, nimbus: s.node_nimbus },
                apps: { total: s.total_apps, gaming: s.gaming_apps_total, crypto: s.crypto_nodes_total }
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// IMPORTANT: Specific routes MUST come BEFORE parameterized routes
// Transaction summary - MUST be before /api/transactions/:date
app.get('/api/transactions/summary', (req, res) => {
    try {
        console.log('Fetching Transaction summary');
        const today = new Date().toISOString().split('T')[0];
        const sevenDays = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
        const thirtyDays = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
        
        res.json({
            totalTransactions: getTxidCount(),
            revenue: {
                today: getRevenueForDateRange(today, today),
                last7Days: getRevenueForDateRange(sevenDays, today),
                last30Days: getRevenueForDateRange(thirtyDays, today)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Paginated transactions with search - MUST be before /api/transactions/:date
app.get('/api/transactions/paginated', (req, res) => {
    try {
        console.log('Starting transaction pagination');
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || '';
        
        const result = getTransactionsPaginated(page, limit, search);
        
        res.json({
            transactions: result.transactions,
            total: result.total,
            page: page,
            limit: limit,
            totalPages: Math.ceil(result.total / limit)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Transactions by date - MUST come AFTER specific routes
app.get('/api/transactions/:date', (req, res) => {
    try {
        console.log('Fetching transactions by date');
        const transactions = getTransactionsByDate(req.params.date);
        
        res.json({
            date: req.params.date,
            count: transactions.length,
            transactions: transactions.map(tx => ({
                txid: tx.txid,
                shortTxid: tx.txid.substring(0, 16) + '...',
                amount: tx.amount,
                blockHeight: tx.block_height,
                date: tx.date
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Gaming category
app.get('/api/categories/gaming', (req, res) => {
    try {
        console.log('Fetching gaming category');
        const current = getCurrentMetrics();
        const snapshots = getLastNSnapshots(parseInt(req.query.days) || 30);
        
        res.json({
            current: {
                total: current.gaming_apps_total,
                palworld: current.gaming_palworld,
                minecraft: current.gaming_minecraft
            },
            history: snapshots.reverse().map(s => ({ 
                date: s.snapshot_date, 
                total: s.gaming_apps_total 
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crypto category
app.get('/api/categories/crypto', (req, res) => {
    try {
        console.log('Fetching Crypto category');
        const current = getCurrentMetrics();
        res.json({
            current: {
                total: current.crypto_nodes_total,
                presearch: current.crypto_presearch,
                kadena: current.crypto_kadena,
                kaspa: current.crypto_kaspa
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Nodes category  
app.get('/api/categories/nodes', (req, res) => {
    try {
        console.log('Fetching Node category');
        const current = getCurrentMetrics();
        res.json({
            current: {
                total: current.node_total,
                cumulus: current.node_cumulus,
                nimbus: current.node_nimbus,
                stratus: current.node_stratus
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analytics comparison endpoint
app.get('/api/analytics/comparison/:days', (req, res) => {
    try {
        const days = parseInt(req.params.days);
        
        if (isNaN(days) || days < 1) {
            return res.status(400).json({ error: 'Invalid days parameter' });
        }
        
        const current = getCurrentMetrics();
        if (!current) {
            return res.status(404).json({ error: 'No current metrics found' });
        }
        
        // Get snapshot from N days ago
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        const pastSnapshot = getSnapshotByDate(targetDateStr);
        
        if (!pastSnapshot) {
            console.log(`⚠️  No snapshot found for comparison: ${targetDateStr} (${days} days ago)`);
            return res.status(404).json({ 
                error: 'No historical snapshot available for comparison',
                message: `No snapshot exists for ${targetDateStr} (${days} days ago). Snapshots are created daily and comparison requires historical data.`,
                targetDate: targetDateStr,
                days: days,
                currentDate: new Date().toISOString().split('T')[0]
            });
        }
        
        // Calculate changes
        const calculateChange = (current, past) => {
            if (!past || past === 0) return { change: 0, trend: 'neutral' };
            const change = ((current - past) / past) * 100;
            return {
                change: Math.round(change * 100) / 100,
                trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
            };
        };
        
        res.json({
            period: days,
            currentDate: new Date().toISOString().split('T')[0],
            comparisonDate: targetDateStr,
            changes: {
                revenue: calculateChange(current.current_revenue, pastSnapshot.daily_revenue),
                nodes: calculateChange(current.node_total, pastSnapshot.node_total),
                apps: calculateChange(current.total_apps, pastSnapshot.total_apps),
                cpu: calculateChange(current.cpu_utilization_percent, pastSnapshot.cpu_utilization_percent),
                ram: calculateChange(current.ram_utilization_percent, pastSnapshot.ram_utilization_percent),
                storage: calculateChange(current.storage_utilization_percent, pastSnapshot.storage_utilization_percent),
                gaming: calculateChange(current.gaming_apps_total, pastSnapshot.gaming_apps_total),
                crypto: calculateChange(current.crypto_nodes_total, pastSnapshot.crypto_nodes_total),
                wordpress: calculateChange(current.wordpress_count, pastSnapshot.wordpress_count)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATED: Manual snapshot trigger using new system
app.post('/api/admin/snapshot', async (req, res) => {
    try {
        console.log('📸 Manual snapshot triggered via API');
        const result = await takeManualSnapshot();
        
        if (result.success) {
            res.json({ 
                success: true,
                snapshot_date: result.snapshotDate,
                revenue: result.data.daily_revenue,
                nodes: result.data.node_total,
                apps: result.data.total_apps
            });
        } else {
            res.status(400).json({
                success: false,
                reason: result.reason,
                skipped: result.skipped || false,
                validationFailed: result.validationFailed || false,
                lockFailed: result.lockFailed || false
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║  FLUX DASHBOARD API - PORT ${PORT}              ║
║  Auto-Running Services: Revenue + Snapshots       ║
╚═══════════════════════════════════════════════════╝
    `);
    
    // Start the revenue sync scheduler (runs every 5 minutes)
    try {
        startRevenueSync();
        console.log('✅ Revenue sync scheduler initialized');
        console.log('   Sync interval: 5 minutes');
        console.log('   Uses your existing revenueService.js');
    } catch (error) {
        console.error('❌ Could not initialize sync:', error.message);
        console.error('⚠️  System will continue but with missing data!');
    }

    // Start the test scheduler (runs every hour)
    try {
        console.log('✅ Service test scheduler initialized');
        console.log('   Test interval: 1 hour');
        startServiceTests();
        
    } catch (error) {
        console.error('❌ Could not initialize test scheduler:', error.message);
        console.error('⚠️  System will continue but tests may not run!');
    }


    // Start the snapshot checker (runs every 30 minutes)
    try {
        console.log('✅ Snapshot checker initialized successfully');
        startSnapshotChecker();
        console.log('   Check interval: 30 minutes');
        console.log('   Grace period: 5 minutes after midnight');
    } catch (error) {
        console.error('❌ Could not initialize snapshot checker:', error.message);
        console.error('⚠️  System will continue but snapshots may not be taken!');
    }
    
    console.log('\n🎉 All services started successfully!');
    console.log('──────────────────────────────────────────────────\n');
    
    // Log the current logging configuration
    console.log('📋 Logging Configuration:');
    console.log(`   Request Logging: ${LOGGING_CONFIG.enableRequestLogging ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   Health Checks: ${LOGGING_CONFIG.logHealthChecks ? '✅ Logged' : '❌ Silent'}`);
    console.log(`   Stats Endpoints: ${LOGGING_CONFIG.logStatsEndpoints ? '✅ Logged' : '❌ Silent'}`);
    console.log(`   Metrics Endpoints: ${LOGGING_CONFIG.logMetricsEndpoints ? '✅ Logged' : '❌ Silent'}`);
    console.log(`   Comparison Endpoints: ${LOGGING_CONFIG.logComparisonEndpoints ? '✅ Logged' : '❌ Silent'}`);
    console.log(`   Errors Only Mode: ${LOGGING_CONFIG.logErrorsOnly ? '✅ Enabled' : '❌ Disabled'}`);
    console.log('──────────────────────────────────────────────────\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

export default app;
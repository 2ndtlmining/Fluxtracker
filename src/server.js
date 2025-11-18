import express from 'express';
import cors from 'cors';
import { 
    getCurrentMetrics,
    getLastNSnapshots,
    getSnapshotsInRange,
    getSnapshotByDate,
    getTransactionsByDate,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
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
import { startServiceTests, getServiceTestSchedulerStatus, startCarouselUpdates,stopCarouselUpdates, getCarouselSchedulerStatus  } from './lib/services/servicesScheduler.js';
import { testAllServices } from './lib/services/test-allServices.js';

// Import backfill functions
import { backfillRevenueSnapshots } from './lib/db/run-backfill.js';

import { json } from '@sveltejs/kit';
import { getCachedTopApps } from './lib/services/carouselService.js';

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

// ============================================
// CORS CONFIGURATION - CRITICAL FOR DOMAIN ACCESS
// ============================================
// IMPORTANT: This allows access from both IP address and domain name
const corsOptions = {
    origin: [
        'http://localhost:5173',                           // Development
        'http://localhost:37000',                          // Development (if using port 37000 locally)
        'http://127.0.0.1:5173',                          // Development
        'http://149.154.176.249:37000',                   // Production IP (update with your actual IP)
        'http://149.154.176.158:37000',                   // Alternative IP (if you have multiple IPs)
        'http://fluxtracker.app.runonflux.io:37000',      // Production Domain (update with your actual domain)
        'https://fluxtracker.app.runonflux.io:37000',     // Production Domain HTTPS (if using HTTPS)
        'http://fluxtracker.app.runonflux.io',            // Domain without port
        'https://fluxtracker.app.runonflux.io',           // Domain HTTPS without port
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    maxAge: 600 // Cache preflight requests for 10 minutes
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Add OPTIONS handler for preflight requests
app.options('*', cors(corsOptions));

// Middleware
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


// NEW: Backfill snapshots endpoint
app.post('/api/admin/backfill', async (req, res) => {
    try {
        console.log('🔄 Backfill triggered via API');
        
        // Calculate dynamic date range
        const toDate = new Date();
        toDate.setDate(toDate.getDate() - 1); // Yesterday
        const toDateStr = toDate.toISOString().split('T')[0];
        
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 365); // 365 days ago
        const fromDateStr = fromDate.toISOString().split('T')[0];
        
        console.log(`📊 Backfilling from ${fromDateStr} to ${toDateStr}`);
        
        // Run the backfill
        const result = backfillRevenueSnapshots(fromDateStr, toDateStr);
        
        console.log(`✅ Backfill complete: Created ${result.created}, Skipped ${result.skipped}`);
        
        res.json({
            success: true,
            message: 'Backfill completed successfully',
            created: result.created,
            skipped: result.skipped,
            dateRange: {
                from: fromDateStr,
                to: toDateStr
            }
        });
    } catch (error) {
        console.error('❌ Backfill failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Database stats
app.get('/api/stats', (req, res) => {
    try {
        const stats = getDatabaseStats();
        
        // Get the last snapshot date
        const lastSnapshot = getLastNSnapshots(1);
        const lastSnapshotDate = lastSnapshot.length > 0 ? lastSnapshot[0].snapshot_date : null;
        
        res.json({
            ...stats,
            lastSnapshotDate
        });
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
        
        // Get today's date for payment count
        const today = new Date().toISOString().split('T')[0];
        const paymentCount = getPaymentCountForDateRange(today, today);
        
        res.json({
            lastUpdate: metrics.last_update,
            revenue: {
                current: metrics.current_revenue,
                fluxPriceUsd: metrics.flux_price_usd,
                usdValue: metrics.flux_price_usd ? metrics.current_revenue * metrics.flux_price_usd : null,
                paymentCount: paymentCount
            },
            cloud: {
                cpu: { total: metrics.total_cpu_cores, used: metrics.used_cpu_cores, utilization: metrics.cpu_utilization_percent },
                ram: { total: metrics.total_ram_gb, used: metrics.used_ram_gb, utilization: metrics.ram_utilization_percent },
                storage: { total: metrics.total_storage_gb, used: metrics.used_storage_gb, utilization: metrics.storage_utilization_percent }
            },
            apps: { total: metrics.total_apps, watchtower: metrics.watchtower_count },
            gaming: { total: metrics.gaming_apps_total, palworld: metrics.gaming_palworld, enshrouded: metrics.gaming_enshrouded, minecraft: metrics.gaming_minecraft },
            crypto: { total: metrics.crypto_nodes_total, presearch: metrics.crypto_presearch, kaspa: metrics.crypto_kaspa, alephium: metrics.crypto_alephium },
            wordpress: { count: metrics.wordpress_count },
            nodes: { cumulus: metrics.node_cumulus, nimbus: metrics.node_nimbus, stratus: metrics.node_stratus, total: metrics.node_total }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DISABLED: This old endpoint is replaced by the more complete one below
/*

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

*/

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
// CORRECTED Analytics comparison endpoint
// This version TRANSFORMS getCurrentMetrics() to match the structure your frontend expects
// Replace the endpoint starting at line ~547 in server.js with this code

app.get('/api/analytics/comparison/:days', (req, res) => {
    try {
        const days = parseInt(req.params.days);
        
        if (isNaN(days) || days < 1) {
            return res.status(400).json({ error: 'Invalid days parameter' });
        }
        
        const rawCurrent = getCurrentMetrics();
        if (!rawCurrent) {
            return res.status(404).json({ error: 'No current metrics found' });
        }
        
        // CRITICAL: Transform raw database columns into nested structure
        // This matches what the OLD endpoint returned from snapshot.js
        const current = {
            nodes: { 
                total: rawCurrent.node_total, 
                cumulus: rawCurrent.node_cumulus, 
                nimbus: rawCurrent.node_nimbus, 
                stratus: rawCurrent.node_stratus 
            },
            apps: { 
                total: rawCurrent.total_apps 
            },
            gaming: { 
                total: rawCurrent.gaming_apps_total, 
                minecraft: rawCurrent.gaming_minecraft, 
                palworld: rawCurrent.gaming_palworld, 
                enshrouded: rawCurrent.gaming_enshrouded 
            },
            crypto: { 
                total: rawCurrent.crypto_nodes_total, 
                presearch: rawCurrent.crypto_presearch, 
                kaspa: rawCurrent.crypto_kaspa, 
                alephium: rawCurrent.crypto_alephium 
            },
            cloud: {
                cpu: { utilization: rawCurrent.cpu_utilization_percent },
                ram: { utilization: rawCurrent.ram_utilization_percent },
                storage: { utilization: rawCurrent.storage_utilization_percent }
            },
            wordpress: { 
                count: rawCurrent.wordpress_count 
            }
        };
        
        // Get dates for comparison
        const today = new Date().toISOString().split('T')[0];
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);
        const targetDateStr = targetDate.toISOString().split('T')[0];
        
        console.log(`📊 Comparison: Today=${today}, Target=${targetDateStr} (${days} days ago)`);
        
        // Calculate changes
        const calculateChange = (current, past) => {
            if (!past || past === 0) return { change: 0, trend: 'neutral' };
            const change = ((current - past) / past) * 100;
            return {
                change: Math.round(change * 100) / 100,
                trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
            };
        };
        
        // SPECIAL HANDLING FOR REVENUE
        const todayRevenue = getRevenueForDateRange(today, today);
        const comparisonRevenue = getRevenueForDateRange(targetDateStr, targetDateStr);
        
        let revenueComparison;
        if (comparisonRevenue > 0) {
            revenueComparison = calculateChange(todayRevenue, comparisonRevenue);
        } else {
            revenueComparison = { 
                change: 0, 
                trend: 'neutral',
                note: `No revenue data for ${targetDateStr}`
            };
        }
        
        // For other metrics, we need snapshot data
        const pastSnapshot = getSnapshotByDate(targetDateStr);
        
        // Build response
        const response = {
            period: days,
            currentDate: today,
            comparisonDate: targetDateStr,
            changes: {
                revenue: revenueComparison
            }
        };
        
        // Add other metrics only if snapshot exists
        if (pastSnapshot) {
            console.log(`✓ Found snapshot for ${targetDateStr}`);
            
            // Node comparisons with individual breakdowns
            const nodeChange = calculateChange(current.nodes?.total || 0, pastSnapshot.node_total);
            const cumulusChange = (current.nodes?.cumulus || 0) - (pastSnapshot.node_cumulus || 0);
            const nimbusChange = (current.nodes?.nimbus || 0) - (pastSnapshot.node_nimbus || 0);
            const stratusChange = (current.nodes?.stratus || 0) - (pastSnapshot.node_stratus || 0);
            
            response.changes.nodes = {
                ...nodeChange,
                difference: (current.nodes?.total || 0) - (pastSnapshot.node_total || 0),
                cumulusChange: cumulusChange,
                cumulusTrend: cumulusChange > 0 ? 'up' : cumulusChange < 0 ? 'down' : 'neutral',
                nimbusChange: nimbusChange,
                nimbusTrend: nimbusChange > 0 ? 'up' : nimbusChange < 0 ? 'down' : 'neutral',
                stratusChange: stratusChange,
                stratusTrend: stratusChange > 0 ? 'up' : stratusChange < 0 ? 'down' : 'neutral'
            };
            
            response.changes.apps = {
                ...calculateChange(current.apps?.total || 0, pastSnapshot.total_apps),
                difference: (current.apps?.total || 0) - (pastSnapshot.total_apps || 0)
            };
            
            // CLOUD COMPARISONS - Now using transformed data
            response.changes.cpu = calculateChange(current.cloud?.cpu?.utilization || 0, pastSnapshot.cpu_utilization_percent);
            response.changes.ram = calculateChange(current.cloud?.ram?.utilization || 0, pastSnapshot.ram_utilization_percent);
            response.changes.storage = calculateChange(current.cloud?.storage?.utilization || 0, pastSnapshot.storage_utilization_percent);
            
            // Gaming comparisons with individual breakdowns
            response.changes.gaming = {
                ...calculateChange(current.gaming?.total || 0, pastSnapshot.gaming_apps_total),
                difference: (current.gaming?.total || 0) - (pastSnapshot.gaming_apps_total || 0),
                minecraftChange: (current.gaming?.minecraft || 0) - (pastSnapshot.gaming_minecraft || 0),
                minecraftTrend: (current.gaming?.minecraft || 0) > (pastSnapshot.gaming_minecraft || 0) ? 'up' : 
                               (current.gaming?.minecraft || 0) < (pastSnapshot.gaming_minecraft || 0) ? 'down' : 'neutral',
                palworldChange: (current.gaming?.palworld || 0) - (pastSnapshot.gaming_palworld || 0),
                palworldTrend: (current.gaming?.palworld || 0) > (pastSnapshot.gaming_palworld || 0) ? 'up' : 
                              (current.gaming?.palworld || 0) < (pastSnapshot.gaming_palworld || 0) ? 'down' : 'neutral',
                enshroudedChange: (current.gaming?.enshrouded || 0) - (pastSnapshot.gaming_enshrouded || 0),
                enshroudedTrend: (current.gaming?.enshrouded || 0) > (pastSnapshot.gaming_enshrouded || 0) ? 'up' : 
                                (current.gaming?.enshrouded || 0) < (pastSnapshot.gaming_enshrouded || 0) ? 'down' : 'neutral'
            };
            
            // Crypto comparisons with individual breakdowns
            response.changes.crypto = {
                ...calculateChange(current.crypto?.total || 0, pastSnapshot.crypto_nodes_total),
                difference: (current.crypto?.total || 0) - (pastSnapshot.crypto_nodes_total || 0),
                presearchChange: (current.crypto?.presearch || 0) - (pastSnapshot.crypto_presearch || 0),
                presearchTrend: (current.crypto?.presearch || 0) > (pastSnapshot.crypto_presearch || 0) ? 'up' : 
                               (current.crypto?.presearch || 0) < (pastSnapshot.crypto_presearch || 0) ? 'down' : 'neutral',
                kaspaChange: (current.crypto?.kaspa || 0) - (pastSnapshot.crypto_kaspa || 0),
                kaspaTrend: (current.crypto?.kaspa || 0) > (pastSnapshot.crypto_kaspa || 0) ? 'up' : 
                           (current.crypto?.kaspa || 0) < (pastSnapshot.crypto_kaspa || 0) ? 'down' : 'neutral',
                alephiumChange: (current.crypto?.alephium || 0) - (pastSnapshot.crypto_alephium || 0),
                alephiumTrend: (current.crypto?.alephium || 0) > (pastSnapshot.crypto_alephium || 0) ? 'up' : 
                              (current.crypto?.alephium || 0) < (pastSnapshot.crypto_alephium || 0) ? 'down' : 'neutral'
            };
            
            response.changes.wordpress = {
                ...calculateChange(current.wordpress?.count || 0, pastSnapshot.wordpress_count),
                difference: (current.wordpress?.count || 0) - (pastSnapshot.wordpress_count || 0)
            };
            
        } else {
            console.log(`⚠️  No snapshot found for comparison: ${targetDateStr} (${days} days ago)`);
            console.log(`✓  Revenue comparison still available using transaction data`);
            
            response.partialData = true;
            response.message = `Snapshot data not available for ${targetDateStr}, but revenue comparison is available from transaction history.`;
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Comparison endpoint error:', error);
        console.error('   Stack:', error.stack);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
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

app.get('/api/carousel/top-apps', (req, res) => {
    try {
        const result = getCachedTopApps();
        res.json({
            apps: result.apps || [],
            cached: result.cached,
            cacheAge: result.cacheAge,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error in carousel API:', error);
        res.status(500).json({ 
            error: 'Failed to fetch top apps',
            apps: [],
            cached: false
        });
    }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║  FLUX DASHBOARD API - PORT ${PORT}              ║
║  Listening on: 0.0.0.0:${PORT}                   ║
║  Auto-Running Services: Revenue + Snapshots       ║
║  CORS enabled for domain and IP access            ║
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

    // NEW: Start the carousel updates
    try {
    console.log('🎠 Carousel update scheduler initialized');
    startCarouselUpdates();
    } catch (error) {
    console.error('❌ Could not initialize carousel:', error.message);
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

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    stopCarouselUpdates();  // ADD THIS
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    stopCarouselUpdates();  // ADD THIS
    process.exit(0);
});

export default app;
// Admin endpoints: sync triggers, status/diagnostic reads, manual snapshot triggers.
// Mounted at '/api/admin' in server.js. Split further per issue #123's own allowance --
// backup/failover and backfill/audit routes live in ./admin/backup.js and
// ./admin/backfill.js, mounted here with no extra prefix.
import express from 'express';

import {
    getTxidCount,
    clearRevenueData,
    resetRevenueSyncBlock,
    getSyncStatus
} from '../../lib/db/database.js';

import { createLogger } from '../../lib/logger.js';
import { getSnapshotSystemStatus, takeManualSnapshot, takeRepoSnapshot } from '../../lib/db/snapshotManager.js';
import { getRevenueSyncSchedulerStatus } from '../../lib/services/revenueScheduler.js';
import {
    fetchRevenueStats,
    getRevenueSyncState,
    fetchCurrentBlockHeight
} from '../../lib/services/revenueService.js';
import { getServiceTestSchedulerStatus } from '../../lib/services/servicesScheduler.js';
import { testAllServices } from '../../lib/services/test-allServices.js';
import { fetchCarouselData } from '../../lib/services/carouselService.js';
import { getHostLocation, getHostLocationError } from '../../lib/services/hostLocationService.js';
import { getPriceHistoryStatus, syncPriceHistory } from '../../lib/services/priceHistoryService.js';

import backupRouter from './admin/backup.js';
import backfillRouter from './admin/backfill.js';

const log = createLogger('server');
const router = express.Router();

// NEW: Snapshot system status endpoint
router.get('/snapshot-status', async (req, res) => {
    try {
        const status = await getSnapshotSystemStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Manual revenue sync trigger endpoint
router.post('/revenue-sync', async (req, res) => {
    try {
        log.info('manual revenue sync triggered via API');

        // Trigger the revenue sync
        await fetchRevenueStats();

        // Get transaction count after sync
        const txCount = await getTxidCount();

        res.json({
            success: true,
            message: 'Revenue sync completed',
            transactionCount: txCount
        });
    } catch (error) {
        log.error({ err: error }, 'manual revenue sync failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear all revenue data and reset sync — triggers a full resync on next cycle
router.post('/clear-revenue-data', async (req, res) => {
    try {
        const deleted = await clearRevenueData();
        log.info({ deleted }, 'cleared revenue transactions — full resync will run on next cycle');
        res.json({ success: true, deleted, message: `Cleared ${deleted} transactions. Resync will start on next cycle.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset revenue sync block to trigger full history re-scan from genesis on next sync
router.post('/reset-revenue-sync', async (req, res) => {
    try {
        await resetRevenueSyncBlock();
        const verified = await getSyncStatus('revenue');
        const didReset = verified?.last_sync_block === null;
        log.info({ lastSyncBlock: verified?.last_sync_block }, 'revenue sync block reset');
        res.json({
            success: didReset,
            last_sync_block: verified?.last_sync_block ?? null,
            message: didReset
                ? 'Reset successful. Full history scan from block 0 will run on next sync cycle.'
                : 'Reset may not have applied — last_sync_block is still set.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Where this server thinks it is running, and how it worked that out.
// The lookup is made by the Node process, so the reported IP is the server's own public
// egress address — never the viewer's. Use this to confirm the header on a Flux node.
router.get('/host-location', async (_req, res) => {
    try {
        const location = await getHostLocation();
        res.json({
            location,
            resolvedFrom: 'server-side lookup (the Node process calls the geo API, not the browser)',
            error: getHostLocationError(),
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Price history coverage — read-only diagnostic for "why is USD revenue empty?"
router.get('/price-history-status', async (_req, res) => {
    try {
        res.json(await getPriceHistoryStatus());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Force a gap-filling price history sync, bypassing the failed-source cooldown
router.post('/sync-price-history', async (_req, res) => {
    try {
        log.info('Price history sync triggered via API');
        const result = await syncPriceHistory({ force: true });
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'Price history sync failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

const REVENUE_COUNTS_TTL_MS = 30_000;
let revenueCounts = { value: null, at: 0 };
async function readRevenueCounts() {
    if (revenueCounts.value && Date.now() - revenueCounts.at < REVENUE_COUNTS_TTL_MS) return revenueCounts.value;
    const [txCount, syncStatus] = await Promise.all([getTxidCount(), getSyncStatus('revenue')]);
    revenueCounts = { value: { txCount, syncStatus }, at: Date.now() };
    return revenueCounts.value;
}

// Revenue sync status endpoint (used by footer)
router.get('/revenue-status', async (req, res) => {
    try {
        const schedulerStatus = getRevenueSyncSchedulerStatus();
        const syncState = getRevenueSyncState();
        // Issue #388: the exact transaction count and the sync row were read one after the
        // other on every page view with no cache. They change at most once per sync (every
        // 5 min), so they are read together and kept 30s; the scheduler/sync state above
        // stays live so the footer's "syncing" indicator is never stale.
        const [counts, currentBlock] = await Promise.all([
            readRevenueCounts(),
            fetchCurrentBlockHeight().catch(() => null) // cached internally; non-critical
        ]);
        const { txCount, syncStatus } = counts;

        res.json({
            ...schedulerStatus,
            transactionCount: txCount,
            lastSyncBlock: syncStatus?.last_sync_block || null,
            currentBlock,
            isSyncing: syncState.isRunning,
            lastCompleted: syncState.lastCompleted
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Manual test services trigger endpoint
router.post('/test-services', async (req, res) => {
    try {
        log.info('manual test services triggered via API');

        // Check if tests are already running
        const status = getServiceTestSchedulerStatus();

        if (status.isTestInProgress) {
            log.warn('tests already in progress, skipping');
            return res.json({
                success: false,
                alreadyRunning: true,
                message: 'Tests are already running',
                status
            });
        }

        // Trigger the test services, revenue sync, and carousel update in parallel
        await Promise.all([
            testAllServices(),
            fetchRevenueStats(),
            fetchCarouselData()
        ]);

        res.json({
            success: true,
            message: 'All services tested and revenue synced successfully',
            status: getServiceTestSchedulerStatus()
        });
    } catch (error) {
        log.error({ err: error }, 'manual test services failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// NEW: Test services status endpoint
router.get('/test-status', (req, res) => {
    try {
        const status = getServiceTestSchedulerStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// UPDATED: Manual snapshot trigger using new system
router.post('/snapshot', async (req, res) => {
    try {
        log.info('manual snapshot triggered via API');
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
                // `error` carries a refused write (issue #220); `reason` carries a
                // deliberate skip. Without both, a failed snapshot answered with an
                // otherwise empty body.
                reason: result.reason,
                error: result.error,
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

// Manual repo-only snapshot (works even if today's daily snapshot already exists)
router.post('/repo-snapshot', async (req, res) => {
    try {
        log.info('manual repo snapshot triggered via API');
        const result = await takeRepoSnapshot();
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.use(backupRouter);
router.use(backfillRouter);

export default router;

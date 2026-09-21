// Admin: data backfills and the transaction audit. Sub-router of
// src/routes/api/admin.js (mounted with no extra prefix -- final paths are /api/admin/*).
import express from 'express';

import { backfillRepoCategories, recategorizeAllRepos } from '../../../lib/db/database.js';
import { createLogger } from '../../../lib/logger.js';
import {
    backfillAppTypes,
    backfillAppNames,
    auditRecentTransactions
} from '../../../lib/services/revenueService.js';
import { backfillNullUsdAmounts } from '../../../lib/services/priceHistoryService.js';
import { reclassifyStoredDatacenterFlags } from '../../../lib/services/decentralizationService.js';
import { backfillRevenueSnapshots } from '../../../lib/db/run-backfill.js';
import { backfillLockedCollateral } from '../../../lib/db/collateralBackfill.js';
import { backfillGameCounts } from '../../../lib/db/gameCountBackfill.js';

const log = createLogger('server');
const router = express.Router();

// Backfill app_type (git/docker) for existing transactions
router.post('/backfill-app-types', async (req, res) => {
    try {
        log.info('app_type backfill triggered via API');
        const result = await backfillAppTypes();
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'app_type backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Backfill app_name for transactions where it is NULL (re-fetches raw txs to extract OP_RETURN hash)
router.post('/backfill-app-names', async (req, res) => {
    try {
        const batchSize = Math.min(parseInt(req.body?.batchSize) || 500, 2000);
        log.info({ batchSize }, 'app_name backfill triggered via API');
        const result = await backfillAppNames(batchSize);
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'app_name backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Audit recent transactions for missed entries
router.post('/audit-transactions', async (req, res) => {
    try {
        log.info('transaction audit triggered via API');
        const result = await auditRecentTransactions();
        res.json(result);
    } catch (error) {
        log.error({ err: error }, 'transaction audit failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Backfill USD amounts for transactions that have NULL amount_usd using historical prices
router.post('/backfill-usd', async (req, res) => {
    try {
        log.info('USD backfill triggered via API');
        const result = await backfillNullUsdAmounts();
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'USD backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// NEW: Backfill snapshots endpoint
router.post('/backfill', async (req, res) => {
    try {
        log.info('backfill triggered via API');

        // Calculate dynamic date range
        const toDate = new Date();
        toDate.setDate(toDate.getDate() - 1); // Yesterday
        const toDateStr = toDate.toISOString().split('T')[0];

        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 365); // 365 days ago
        const fromDateStr = fromDate.toISOString().split('T')[0];

        log.info({ from: fromDateStr, to: toDateStr }, 'backfilling date range');

        // Run the backfill
        const result = await backfillRevenueSnapshots(fromDateStr, toDateStr);

        log.info({ created: result.created, skipped: result.skipped }, 'backfill complete');

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
        log.error({ err: error }, 'backfill failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin: backfill repo categories (only NULL rows)
router.post('/backfill-repo-categories', async (req, res) => {
    try {
        const count = await backfillRepoCategories();
        res.json({ success: true, message: `Processed ${count} distinct images` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: full re-categorize (reset ALL categories then re-apply keywords)
router.post('/recategorize-repos', async (req, res) => {
    try {
        const { resetCount, categorized } = await recategorizeAllRepos();
        res.json({
            success: true,
            message: `Reset ${resetCount} images, categorized ${Object.values(categorized).reduce((a,b) => a+b, 0)}`,
            categorized
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin: fill locked_collateral* on historical snapshots from their own stored tier
// counts (issue #210). Exact rather than best-effort -- every snapshot back to day one
// already holds node_cumulus/nimbus/stratus and the rates have never changed -- so one
// call after deploying backfills the whole Historical graph. Does no external lookups.
// Never restates a day that already has a figure.
router.post('/backfill-collateral', async (_req, res) => {
    try {
        log.info('locked collateral backfill triggered via API');
        const result = await backfillLockedCollateral();
        res.json({
            success: true,
            ...result,
            message: `Filled ${result.filled} of ${result.total} snapshot(s), skipped ${result.skipped}, failed ${result.failed}`
        });
    } catch (error) {
        log.error({ err: error }, 'locked collateral backfill failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: repair game counts written to daily_snapshots as a fabricated 0 (issue #229).
// Reconstructs each day's figure from repo_snapshots, which holds per-image daily counts
// from the same image-matching pass that feeds the live counter -- so this is exact, not an
// estimate. Only a stored 0 is replaced, and only with a positive count, so a day the game
// genuinely ran zero stays 0 and correctly-written columns are never restated. Does no
// external lookups; idempotent.
router.post('/backfill-game-counts', async (_req, res) => {
    try {
        log.info('game count repair triggered via API');
        const result = await backfillGameCounts();
        res.json({
            success: true,
            ...result,
            message: `Repaired ${result.repaired} day(s) (${result.columns} column values), ${result.skipped} unchanged, ${result.failed} failed of ${result.total}`
        });
    } catch (error) {
        log.error({ err: error }, 'game count repair failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

// Admin: re-apply DATACENTER_ORG_KEYWORDS to already-classified node IPs (issue #196).
// Needed because is_datacenter is decided at classification time and never re-derived on
// read, so a keyword edit would otherwise only land as rows go stale over ~30 days. Does no
// external lookups -- the stored org is all it needs.
router.post('/reclassify-datacenters', async (req, res) => {
    try {
        log.info('datacenter reclassification triggered via API');
        const { checked, changed } = await reclassifyStoredDatacenterFlags();
        res.json({ success: true, checked, changed, message: `Re-checked ${checked} classified IP(s), updated ${changed}` });
    } catch (error) {
        log.error({ err: error }, 'datacenter reclassification failed');
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;

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
import { backfillRevenueSnapshots } from '../../../lib/db/run-backfill.js';

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

export default router;

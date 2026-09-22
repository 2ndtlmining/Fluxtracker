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
import { repairGameColumns } from '../../../lib/db/gameColumnRepair.js';

const log = createLogger('server');
const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Inclusive day count, so the default window is exactly the 365 days ending at `to` --
// the same span the hardcoded version produced.
const DEFAULT_BACKFILL_DAYS = 365;

/** A UTC date string `days` before `fromMs`, as YYYY-MM-DD. */
function utcDaysAgo(fromMs, days) {
    return new Date(fromMs - days * 86400000).toISOString().split('T')[0];
}

/**
 * The date range POST /api/admin/backfill should fill (issue #218).
 *
 * The endpoint used to ignore its body and always rewrite the last 365 days, so repairing
 * one known-bad week meant reprocessing a year. `from`/`to` are now honoured, with that
 * window kept as the default, and every boundary is computed in UTC -- snapshot_date is a
 * UTC date string, and deriving a default from local date parts is a day off for half the
 * world. Throws on a bad range rather than falling back to the year-long default.
 */
export function resolveBackfillRange({ from, to } = {}) {
    for (const [name, value] of [['from', from], ['to', to]]) {
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
            throw new Error(`Invalid "${name}" date: expected YYYY-MM-DD, got ${value}`);
        }
    }

    const now = Date.now();
    const resolvedTo = to ?? utcDaysAgo(now, 1);
    const resolvedFrom = from ?? utcDaysAgo(Date.parse(`${resolvedTo}T00:00:00Z`), DEFAULT_BACKFILL_DAYS - 1);

    if (Date.parse(`${resolvedFrom}T00:00:00Z`) > Date.parse(`${resolvedTo}T00:00:00Z`)) {
        throw new Error(`"from" (${resolvedFrom}) must be on or before "to" (${resolvedTo})`);
    }

    return { from: resolvedFrom, to: resolvedTo };
}

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

// Backfill revenue-only daily_snapshots rows. Body: { from?, to? } as YYYY-MM-DD;
// defaults to the year ending yesterday (UTC). Only daily_revenue is written -- every
// other column is left NULL (issue #218).
router.post('/backfill', async (req, res) => {
    let range;
    try {
        range = resolveBackfillRange(req.body);
    } catch (error) {
        // A bad range is the caller's mistake, not a server failure -- and answering 500
        // here previously meant falling through to a silent 365-day rewrite.
        return res.status(400).json({ success: false, error: error.message });
    }

    try {
        log.info({ from: range.from, to: range.to }, 'backfill triggered via API');

        const result = await backfillRevenueSnapshots(range.from, range.to);

        log.info({ created: result.created, skipped: result.skipped }, 'backfill complete');

        res.json({
            success: true,
            message: 'Backfill completed successfully',
            created: result.created,
            skipped: result.skipped,
            dateRange: range
        });
    } catch (error) {
        log.error({ err: error }, 'backfill failed');
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Admin: bring the per-game gaming_* columns onto the app-name definition (issue #231).
//
// Rewrites the days game_snapshots covers and NULLs the ones before it, which have no
// app-name reading and never can. `?dryRun=1` reports the counts without writing -- worth
// running first, since this rewrites history.
router.post('/repair-game-columns', async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true' || req.body?.dryRun === true;
    try {
        log.info({ dryRun }, 'per-game column repair triggered via API');
        const result = await repairGameColumns({ dryRun });
        res.json({ success: true, ...result });
    } catch (error) {
        log.error({ err: error }, 'per-game column repair failed');
        res.status(500).json({ success: false, error: error.message });
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

// Revenue-by-period and transaction listing endpoints. Mounted at '/api' in server.js
// ('/revenue/:period' and '/transactions/*' don't share a common sub-prefix).
import express from 'express';

import {
    getCurrentMetrics,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getRevenueFromAddressesForDateRange,
    getDailyRevenueUSDInRange,
    getTxidCount,
    getTransactionsByDate,
    getTransactionsPaginated
} from '../../lib/db/database.js';

import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES } from '../../lib/config.js';
import { getToDateRanges, TIMEFRAMES } from '../../lib/kpi/periods.js';
import { computeDemandSplit, sumUsd } from '../../lib/utils/revenueSources.js';
import { createLogger } from '../../lib/logger.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';

const log = createLogger('server');
const router = express.Router();

// /api/revenue/:period had no caching at all (issue #227), while every client polls all
// five periods on load and again on DASHBOARD_REFRESH_MS. 60s is under that interval, so
// a burst of viewers shares one set of reads without the numbers visibly lagging.
const periodCache = createCache(60_000);

// Largest page /api/transactions/paginated will serve. The CSV export pages at this size.
//
// This is PostgREST's db-max-rows, not a number of our choosing: the server caps every
// response at 1000 rows silently, so advertising more meant `totalPages` was computed from
// a page size the database never served -- ceil(23102/5000) = 5 pages x 1000 real rows, and
// the export wrote 5,000 of 23,102 transactions reporting success (issue #158).
export const MAX_PAGE_SIZE = 1000;

/**
 * Clamp a client-supplied `limit` to a page the database can actually serve.
 * Exported for tests -- the arithmetic is what made #158 silent.
 * @param {string|undefined} rawLimit
 * @returns {number} rows per page, 1..MAX_PAGE_SIZE
 */
export function resolvePageSize(rawLimit) {
    return Math.min(Math.max(parseInt(rawLimit) || 50, 1), MAX_PAGE_SIZE);
}

// Payer sources the TEAM / FIAT badges filter by (issue #159). Resolved server-side from
// config rather than letting the client post an address list -- the client naming its own
// addresses would turn this into an arbitrary from_address query.
const TRANSACTION_SOURCES = {
    team: FLUX_TEAM_ADDRESSES,
    fiat: FLUX_FIAT_ADDRESSES
};

/**
 * Map a `source` query param ("team", "fiat", or "team,fiat") to the addresses to filter
 * on. Multiple sources are a union: selecting both badges shows team OR fiat payments.
 * Unknown names are ignored rather than erroring -- a stale bookmark should degrade to
 * showing more rows, not to a 400.
 * @returns {string[]|null} addresses, or null for "no filter"
 */
export function resolveSourceAddresses(sourceParam) {
    if (!sourceParam) return null;

    const names = String(sourceParam).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const addresses = names.flatMap(name => TRANSACTION_SOURCES[name] || []);

    // Deduped: an address listed under two sources must not double-count in the IN clause.
    const unique = [...new Set(addresses)];
    return unique.length > 0 ? unique : null;
}

/**
 * GET /api/revenue/:period
 * Returns revenue for the specified period with comparison to previous period
 * Periods: daily, weekly, monthly, quarterly, yearly
 */
router.get('/revenue/:period', async (req, res) => {
    const period = req.params.period.toLowerCase();

    // Validated before anything touches the database: an unknown period is the caller's
    // mistake, not a failed read, and it should not cost a query.
    if (!TIMEFRAMES.includes(period)) {
        return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly, quarterly, or yearly' });
    }

    return withDbFallback(periodCache, `period:${period}`, res, async () => {
        // Boundaries come from periods.js, which is pure, UTC throughout and unit-tested
        // (issue #224). They were built here with local-time constructors and serialized
        // with toISOString(), so on a host outside UTC "this month" started on the last
        // day of the previous one and a day was counted in both periods at once --
        // silently wrong for the change percentage and the self-funded share too.
        //
        // getToDateRanges is the period TO DATE vs the whole previous period, which is
        // what a live dashboard shows. getPeriodRanges (two completed periods) is for KPI
        // reports and deliberately answers something else.
        const { current, previous } = getToDateRanges(period);
        const { start: currentStart, end: currentEnd } = current;
        const { start: previousStart, end: previousEnd } = previous;

        // All six reads together (issue #227). They were sequential, and the self-funded
        // one used to page every matching row to compute a sum the database already
        // computes -- so the slowest period served six round trips end to end.
        const [
            currentMetrics,
            currentRevenue,
            currentPayments,
            previousRevenue,
            previousPayments,
            selfFunded,
            currentUsdRows,
            previousUsdRows
        ] = await Promise.all([
            getCurrentMetrics(),
            getRevenueForDateRange(currentStart, currentEnd),
            getPaymentCountForDateRange(currentStart, currentEnd),
            getRevenueForDateRange(previousStart, previousEnd),
            getPaymentCountForDateRange(previousStart, previousEnd),
            // Self-funded share: revenue paid by Flux team addresses. Reported alongside
            // the headline total, never subtracted from it -- the total stays primary.
            getRevenueFromAddressesForDateRange(currentStart, currentEnd, FLUX_TEAM_ADDRESSES),
            // #266: what was actually paid in USD at the time, both periods -- the demand
            // signal the FLUX change hides whenever the token price moves.
            getDailyRevenueUSDInRange(currentStart, currentEnd),
            getDailyRevenueUSDInRange(previousStart, previousEnd)
        ]);

        const fluxPrice = currentMetrics?.flux_price_usd || 0;

        let changePercent = 0;
        let trend = 'neutral';
        if (previousRevenue > 0) {
            changePercent = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
            trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';
        }

        const currentUsd = currentRevenue * fluxPrice;
        const selfFundedPercent = currentRevenue > 0
            ? (selfFunded.revenue / currentRevenue) * 100
            : 0;

        return {
            period: period,
            current: {
                start: currentStart,
                end: currentEnd,
                revenue: currentRevenue,
                payments: currentPayments,
                usd: currentUsd
            },
            previous: {
                start: previousStart,
                end: previousEnd,
                revenue: previousRevenue,
                payments: previousPayments
            },
            comparison: {
                change: changePercent,
                trend: trend
            },
            // Formatted for frontend
            payments: {
                count: currentPayments,
                previous: previousPayments
            },
            usd: {
                amount: currentUsd
            },
            flux: {
                amount: currentRevenue,
                previous: previousRevenue,
                change: changePercent,
                trend: trend
            },
            // #266: the FLUX change split into demand (USD at the time of payment) and price
            // (average USD paid per FLUX). Null when either period has nothing to compare.
            demand: computeDemandSplit({
                fluxCurrent: currentRevenue,
                fluxPrevious: previousRevenue,
                usdCurrent: sumUsd(currentUsdRows),
                usdPrevious: sumUsd(previousUsdRows)
            }),
            selfFunded: {
                flux: selfFunded.revenue,
                usd: selfFunded.revenue * fluxPrice,
                payments: selfFunded.payments,
                percent: Math.round(selfFundedPercent * 10) / 10
            },
            timestamp: Date.now()
        };
    });
});

// IMPORTANT: Specific routes MUST come BEFORE parameterized routes
// Transaction summary - MUST be before /api/transactions/:date
router.get('/transactions/summary', async (req, res) => {
    try {
        log.info('fetching transaction summary');
        const today = new Date().toISOString().split('T')[0];
        const sevenDays = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
        const thirtyDays = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

        res.json({
            totalTransactions: await getTxidCount(),
            revenue: {
                today: await getRevenueForDateRange(today, today),
                last7Days: await getRevenueForDateRange(sevenDays, today),
                last30Days: await getRevenueForDateRange(thirtyDays, today)
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Paginated transactions with search - MUST be before /api/transactions/:date
router.get('/transactions/paginated', async (req, res) => {
    try {
        log.info('starting transaction pagination');
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        // Cap kept deliberately — the CSV export pages through this endpoint rather than
        // asking for everything at once. It used to request all ~21k rows in one call and
        // silently receive only the first 1000.
        const limit = resolvePageSize(req.query.limit);
        const search = req.query.search || '';
        const appName = req.query.appName || null;
        const fromAddresses = resolveSourceAddresses(req.query.source);

        const result = await getTransactionsPaginated(page, limit, search, appName, fromAddresses);

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
router.get('/transactions/:date', async (req, res) => {
    try {
        log.info('fetching transactions by date');
        const transactions = await getTransactionsByDate(req.params.date);

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

export default router;

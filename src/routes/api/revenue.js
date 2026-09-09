// Revenue-by-period and transaction listing endpoints. Mounted at '/api' in server.js
// ('/revenue/:period' and '/transactions/*' don't share a common sub-prefix).
import express from 'express';

import {
    getCurrentMetrics,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getRevenueFromAddressesForDateRange,
    getTxidCount,
    getTransactionsByDate,
    getTransactionsPaginated
} from '../../lib/db/database.js';

import { FLUX_TEAM_ADDRESSES } from '../../lib/config.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('server');
const router = express.Router();

// Largest page /api/transactions/paginated will serve. The CSV export pages at this size.
const MAX_PAGE_SIZE = 5000;

/**
 * GET /api/revenue/:period
 * Returns revenue for the specified period with comparison to previous period
 * Periods: daily, weekly, monthly, quarterly, yearly
 */
router.get('/revenue/:period', async (req, res) => {
    try {
        const period = req.params.period.toLowerCase();
        const currentMetrics = await getCurrentMetrics();
        const fluxPrice = currentMetrics?.flux_price_usd || 0;

        let currentRevenue, currentPayments, previousRevenue, previousPayments;
        let currentStart, currentEnd, previousStart, previousEnd;

        const now = new Date();

        switch(period) {
            case 'daily':
                // Today
                currentStart = currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Yesterday
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                previousStart = previousEnd = yesterday.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'weekly':
                // This week (Monday to Sunday)
                const currentWeekStart = new Date(now);
                const dayOfWeek = currentWeekStart.getDay();
                const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust Sunday (0) to be 6 days from Monday
                currentWeekStart.setDate(currentWeekStart.getDate() - daysToMonday);
                currentStart = currentWeekStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last week (Monday to Sunday)
                const lastWeekStart = new Date(currentWeekStart);
                lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                previousStart = lastWeekStart.toISOString().split('T')[0];
                const lastWeekEnd = new Date(lastWeekStart);
                lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
                previousEnd = lastWeekEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'monthly':
                // This month
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                currentStart = firstDayOfMonth.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last month
                const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                previousStart = firstDayOfLastMonth.toISOString().split('T')[0];
                const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
                previousEnd = lastDayOfLastMonth.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'quarterly':
                // This quarter
                const currentQuarter = Math.floor(now.getMonth() / 3);
                const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1);
                currentStart = quarterStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last quarter
                const lastQuarterStart = new Date(now.getFullYear(), (currentQuarter - 1) * 3, 1);
                if (currentQuarter === 0) {
                    // If Q1, go to Q4 of last year
                    lastQuarterStart.setFullYear(now.getFullYear() - 1);
                    lastQuarterStart.setMonth(9); // October (Q4 starts)
                }
                previousStart = lastQuarterStart.toISOString().split('T')[0];
                const lastQuarterEnd = new Date(lastQuarterStart.getFullYear(), lastQuarterStart.getMonth() + 3, 0);
                previousEnd = lastQuarterEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            case 'yearly':
                // This year
                const yearStart = new Date(now.getFullYear(), 0, 1);
                currentStart = yearStart.toISOString().split('T')[0];
                currentEnd = now.toISOString().split('T')[0];
                currentRevenue = await getRevenueForDateRange(currentStart, currentEnd);
                currentPayments = await getPaymentCountForDateRange(currentStart, currentEnd);

                // Last year
                const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
                previousStart = lastYearStart.toISOString().split('T')[0];
                const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31);
                previousEnd = lastYearEnd.toISOString().split('T')[0];
                previousRevenue = await getRevenueForDateRange(previousStart, previousEnd);
                previousPayments = await getPaymentCountForDateRange(previousStart, previousEnd);
                break;

            default:
                return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly, quarterly, or yearly' });
        }

        // Calculate change percentage
        let changePercent = 0;
        let trend = 'neutral';

        if (previousRevenue > 0) {
            changePercent = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
            trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';
        }

        const currentUsd = currentRevenue * fluxPrice;

        // Self-funded share: revenue paid by Flux team addresses. Reported alongside the
        // headline total, never subtracted from it — the total stays the primary number.
        const selfFunded = await getRevenueFromAddressesForDateRange(
            currentStart, currentEnd, FLUX_TEAM_ADDRESSES
        );
        const selfFundedPercent = currentRevenue > 0
            ? (selfFunded.revenue / currentRevenue) * 100
            : 0;

        res.json({
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
            selfFunded: {
                flux: selfFunded.revenue,
                usd: selfFunded.revenue * fluxPrice,
                payments: selfFunded.payments,
                percent: Math.round(selfFundedPercent * 10) / 10
            },
            timestamp: Date.now()
        });

    } catch (error) {
        log.error({ err: error, period: req.params.period }, 'revenue endpoint error');
        res.status(500).json({
            error: 'Failed to fetch revenue',
            details: error.message
        });
    }
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
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), MAX_PAGE_SIZE);
        const search = req.query.search || '';
        const appName = req.query.appName || null;

        const result = await getTransactionsPaginated(page, limit, search, appName);

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

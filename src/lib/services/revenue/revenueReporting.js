import { createLogger } from '../../logger.js';
import {
    updateCurrentMetrics,
    updateSyncStatus,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    countTxidsWithoutAppName
} from '../../db/database.js';
import { setRevenueSyncRunning, setRevenueSyncError } from './revenueSyncState.js';
import { fetchFluxPrice } from '../fluxNetworkData.js';
import { progressiveSync } from './transactionSync.js';
import { backfillAppTypes, backfillAppNames } from './revenueBackfill.js';

const log = createLogger('revenueService');

// ============================================
// REVENUE CALCULATION
// ============================================

/**
 * Calculate today's revenue from database
 */
async function calculateDailyRevenue() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const revenue = await getRevenueForDateRange(today, today);

        log.info({ date: today, revenue: revenue.toFixed(2) }, 'Today\'s revenue (%s): %s FLUX', today, revenue.toFixed(2));

        await updateCurrentMetrics({
            last_update: Date.now(),
            current_revenue: revenue
        });

        return revenue;

    } catch (error) {
        log.error({ err: error }, 'Error calculating daily revenue');
        throw error;
    }
}

/**
 * Calculate revenue for a specific timeframe
 */
async function calculateRevenueByTimeframe(timeframe = 'day') {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        let daysAgo;
        switch (timeframe.toLowerCase()) {
            case 'day':
                daysAgo = 1;
                break;
            case 'week':
                daysAgo = 7;
                break;
            case 'month':
                daysAgo = 30;
                break;
            case 'quarter':
                daysAgo = 90;
                break;
            case 'year':
                daysAgo = 365;
                break;
            default:
                daysAgo = 1;
        }

        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - daysAgo);
        const startDateStr = startDate.toISOString().split('T')[0];

        const revenue = await getRevenueForDateRange(startDateStr, today);

        log.info({ timeframe: timeframe.toUpperCase(), startDate: startDateStr, endDate: today, revenue: revenue.toFixed(2) }, '%s revenue (%s to %s): %s FLUX', timeframe.toUpperCase(), startDateStr, today, revenue.toFixed(2));

        return revenue;

    } catch (error) {
        log.error({ err: error, timeframe }, 'Error calculating %s revenue', timeframe);
        return 0;
    }
}

/**
 * Get revenue breakdown by timeframe
 */
export async function getRevenueBreakdown() {
    try {
        return {
            day: await calculateRevenueByTimeframe('day'),
            week: await calculateRevenueByTimeframe('week'),
            month: await calculateRevenueByTimeframe('month'),
            quarter: await calculateRevenueByTimeframe('quarter'),
            year: await calculateRevenueByTimeframe('year')
        };
    } catch (error) {
        log.error({ err: error }, 'Error getting revenue breakdown');
        return {
            day: 0,
            week: 0,
            month: 0,
            quarter: 0,
            year: 0
        };
    }
}

/**
 * Fetch all revenue metrics (price + revenue)
 * MAIN ENTRY POINT - Called every 5 minutes by scheduler
 */
export async function fetchRevenueStats() {
    setRevenueSyncRunning(true);

    try {
        log.info('Fetching complete revenue statistics');

        // Fetch price
        const price = await fetchFluxPrice();

        // Run progressive sync to import new transactions
        await progressiveSync();

        // Auto-backfill transactions that are still missing app_name.
        // Only looks at the last 30 days — old NULL rows are almost certainly direct
        // payments with no OP_RETURN hash that will never resolve. Use the manual
        // admin endpoint (/api/admin/backfill-app-names) to process all NULLs.
        const AUTO_BACKFILL_DAYS = 30;
        const nullAppNames = await countTxidsWithoutAppName(AUTO_BACKFILL_DAYS);
        if (nullAppNames > 0) {
            log.info({ nullAppNames }, 'Auto-backfilling %d recent transactions missing app_name', nullAppNames);
            await backfillAppNames(500, AUTO_BACKFILL_DAYS, true);
        }

        // Auto-backfill missing app_type (git/docker) for transactions that have app_name
        await backfillAppTypes();

        // Calculate daily revenue
        const dailyRevenue = await calculateDailyRevenue();

        const revenueData = {
            current_revenue: dailyRevenue,
            flux_price_usd: price
        };

        log.info({ revenueData }, 'Revenue stats updated');

        setRevenueSyncRunning(false);
        return revenueData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching revenue stats');
        setRevenueSyncError(error);
        setRevenueSyncRunning(false);
        await updateSyncStatus('revenue', 'failed', error.message, null);
        throw error;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format revenue stats for display
 */
export function formatRevenueStats(revenueData, fluxPrice) {
    const revenue = revenueData.current_revenue || 0;
    const price = fluxPrice || revenueData.flux_price_usd || 0;
    const usdValue = revenue * price;

    return {
        flux: revenue.toFixed(2) + ' FLUX',
        usd: price > 0 ? '$' + usdValue.toFixed(2) : 'N/A',
        price: price > 0 ? '$' + price.toFixed(4) : 'N/A'
    };
}

// ============================================
// MONTHLY REVENUE FUNCTIONS
// ============================================

/**
 * Calculate revenue for the current month (month-to-date)
 */
export async function calculateMonthlyRevenue() {
    try {
        const now = new Date();

        // Get first day of current month
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = firstDayOfMonth.toISOString().split('T')[0];

        // Get today
        const today = now.toISOString().split('T')[0];

        // Calculate revenue for current month
        const revenue = await getRevenueForDateRange(startDate, today);

        log.info({ startDate, endDate: today, revenue: revenue.toFixed(2) }, 'Monthly revenue (%s to %s): %s FLUX', startDate, today, revenue.toFixed(2));

        return revenue;

    } catch (error) {
        log.error({ err: error }, 'Error calculating monthly revenue');
        throw error;
    }
}

/**
 * Calculate revenue for the previous month (for comparison)
 */
export async function calculatePreviousMonthRevenue() {
    try {
        const now = new Date();

        // Get first day of previous month
        const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startDate = firstDayOfPrevMonth.toISOString().split('T')[0];

        // Get last day of previous month
        const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const endDate = lastDayOfPrevMonth.toISOString().split('T')[0];

        // Calculate revenue for previous month
        const revenue = await getRevenueForDateRange(startDate, endDate);

        log.info({ startDate, endDate, revenue: revenue.toFixed(2) }, 'Previous month revenue (%s to %s): %s FLUX', startDate, endDate, revenue.toFixed(2));

        return revenue;

    } catch (error) {
        log.error({ err: error }, 'Error calculating previous month revenue');
        throw error;
    }
}

/**
 * Get payment count for the current month
 */
export async function getMonthlyPaymentCount() {
    try {
        const now = new Date();

        // Get first day of current month
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = firstDayOfMonth.toISOString().split('T')[0];

        // Get today
        const today = now.toISOString().split('T')[0];

        // Get payment count for current month
        const count = await getPaymentCountForDateRange(startDate, today);

        log.info({ startDate, endDate: today, count }, 'Monthly payment count (%s to %s): %d', startDate, today, count);

        return count;

    } catch (error) {
        log.error({ err: error }, 'Error getting monthly payment count');
        throw error;
    }
}

/**
 * Get payment count for the previous month
 */
export async function getPreviousMonthPaymentCount() {
    try {
        const now = new Date();

        // Get first day of previous month
        const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startDate = firstDayOfPrevMonth.toISOString().split('T')[0];

        // Get last day of previous month
        const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const endDate = lastDayOfPrevMonth.toISOString().split('T')[0];

        // Get payment count for previous month
        const count = await getPaymentCountForDateRange(startDate, endDate);

        log.info({ startDate, endDate, count }, 'Previous month payment count (%s to %s): %d', startDate, endDate, count);

        return count;

    } catch (error) {
        log.error({ err: error }, 'Error getting previous month payment count');
        throw error;
    }
}

/**
 * Calculate yesterday's revenue (for daily comparison)
 */
export async function calculateYesterdayRevenue() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const revenue = await getRevenueForDateRange(yesterdayStr, yesterdayStr);

        log.info({ date: yesterdayStr, revenue: revenue.toFixed(2) }, 'Yesterday revenue (%s): %s FLUX', yesterdayStr, revenue.toFixed(2));

        return revenue;

    } catch (error) {
        log.error({ err: error }, 'Error calculating yesterday revenue');
        throw error;
    }
}

/**
 * Get payment count for yesterday
 */
export async function getYesterdayPaymentCount() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const count = await getPaymentCountForDateRange(yesterdayStr, yesterdayStr);

        log.info({ date: yesterdayStr, count }, 'Yesterday payment count (%s): %d', yesterdayStr, count);

        return count;

    } catch (error) {
        log.error({ err: error }, 'Error getting yesterday payment count');
        throw error;
    }
}

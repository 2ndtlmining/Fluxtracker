import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate,
    getRevenueFromAddressesForDateRange
} from '../db/database.js';
import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES } from '../config.js';
import { getPeriodRanges, formatPeriod, dayCount } from '../kpi/periods.js';
import { buildKpiDataset, sumDaily } from '../kpi/metrics.js';
import { buildDiscordPayload, isValidDiscordWebhook } from '../kpi/discord.js';
import { createLogger } from '../logger.js';

const log = createLogger('kpiService');

const WEBHOOK_TIMEOUT_MS = 10000;

/**
 * Revenue for a period, from the same source the dashboard's revenue card uses so the
 * numbers can't drift apart.
 */
async function getPeriodRevenue({ start, end }) {
    const [flux, usdRows, selfFunded, fiat] = await Promise.all([
        getRevenueForDateRange(start, end),
        getDailyRevenueUSDInRange(start, end),
        getRevenueFromAddressesForDateRange(start, end, FLUX_TEAM_ADDRESSES),
        getRevenueFromAddressesForDateRange(start, end, FLUX_FIAT_ADDRESSES)
    ]);

    const total = flux || 0;
    // Shares are of total FLUX revenue for the same period, so they always add up against
    // the Flux row directly above them in the report.
    const share = (part) => (total > 0 ? (part / total) * 100 : 0);

    return {
        flux: total,
        usd: sumDaily(usdRows, 'daily_revenue_usd'),
        selfFunded: selfFunded.revenue,
        selfFundedShare: share(selfFunded.revenue),
        fiat: fiat.revenue,
        fiatShare: share(fiat.revenue),
        days: dayCount(start, end)
    };
}

/**
 * Compute a full KPI report for a timeframe. Pure data — delivery is separate.
 *
 * @param {'weekly'|'monthly'|'quarterly'|'yearly'} timeframe
 * @param {Date} [now] injectable for tests
 */
export async function buildKpiReport(timeframe, now = new Date()) {
    const { current, comparison, label } = getPeriodRanges(timeframe, now);

    const [currentSnapshots, comparisonSnapshots, currentRevenue, comparisonRevenue, earliestRevenueDate] =
        await Promise.all([
            getSnapshotsInRange(current.start, current.end),
            getSnapshotsInRange(comparison.start, comparison.end),
            getPeriodRevenue(current),
            getPeriodRevenue(comparison),
            getOldestTransactionDate()
        ]);

    const dataset = buildKpiDataset({
        current,
        comparison,
        currentSnapshots,
        comparisonSnapshots,
        currentRevenue,
        comparisonRevenue,
        earliestRevenueDate: earliestRevenueDate ? String(earliestRevenueDate).slice(0, 10) : null
    });

    return {
        timeframe,
        label,
        current,
        comparison,
        currentLabel: formatPeriod(timeframe, current),
        comparisonLabel: formatPeriod(timeframe, comparison),
        dataset,
        generatedAt: new Date(now).toISOString()
    };
}

/**
 * POST the report to a Discord webhook.
 *
 * The URL is re-validated here, not just at the API boundary — this is the function that
 * actually makes the outbound request, so it is the last place the SSRF guard can live.
 */
export async function sendToDiscord(webhookUrl, report) {
    if (!isValidDiscordWebhook(webhookUrl)) {
        throw new Error('Not a valid Discord webhook URL');
    }

    const payload = buildDiscordPayload(report);

    try {
        await axios.post(webhookUrl, payload, {
            timeout: WEBHOOK_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
            maxRedirects: 0,          // a redirect could leave the discord.com allowlist
            validateStatus: s => s >= 200 && s < 300
        });
        return { delivered: true };
    } catch (error) {
        const status = error.response?.status;

        // Map Discord's failures to something a user can act on
        if (status === 404) throw new Error('That Discord webhook no longer exists. Check the URL or create a new one.');
        if (status === 401 || status === 403) throw new Error('Discord rejected the webhook. Check the URL is correct and still active.');
        if (status === 429) throw new Error('Discord is rate-limiting this webhook. Wait a minute and try again.');
        if (status === 400) throw new Error('Discord rejected the report payload.');
        if (error.code === 'ECONNABORTED') throw new Error('Discord did not respond in time. Try again.');

        log.error({ err: error, status }, 'Discord webhook delivery failed');
        throw new Error('Could not deliver the report to Discord.');
    }
}

/**
 * Plain-text rendering, used by the modal's preview so a user can see the numbers before
 * (or without) sending anything.
 */
export { buildDiscordPayload, isValidDiscordWebhook };

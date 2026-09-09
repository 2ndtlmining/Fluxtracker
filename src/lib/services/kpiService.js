import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate,
    getRevenueFromAddressesForDateRange,
    getDecentralizationSnapshotHistory
} from '../db/database.js';
import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES } from '../config.js';
import { getPeriodRanges, formatPeriod, dayCount } from '../kpi/periods.js';
import { buildKpiDataset, sumDaily, computeTopDatacentersForPeriod } from '../kpi/metrics.js';
import { buildDiscordPayload, buildFluxCloudActivityPayload, buildSchedulerFailurePayload, isValidDiscordWebhook } from '../kpi/discord.js';
import { getFluxCloudActivity } from './carouselService.js';
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
 * Live Flux Cloud state for the daily report: the two instant metrics the main
 * report shows, plus the per-app detail the Flux Cloud Activity message lists.
 * The report's figures ARE the activity message's totals — `Deployed (24h)` is the
 * deduped length of the deployments list, `Expiring (24h)` of the expiring list —
 * so the section and its detail can never disagree. Sourced from
 * carouselService.getFluxCloudActivity(), the same function the live dashboard card
 * and the daily snapshot collector use, so none of the three can disagree either.
 * `cached === false` means the on-demand fetch failed with nothing ever stored —
 * an absent reading, never a fake zero.
 */
async function getFluxCloudData() {
    try {
        const activity = await getFluxCloudActivity();

        return {
            instant: {
                fluxCloud: {
                    appsDeployed: activity.deployedToday.cached ? activity.deployedToday.apps.length : null,
                    appsExpiring24h: activity.expiring24h.cached ? activity.expiring24h.apps.length : null
                }
            },
            activity
        };
    } catch (error) {
        log.warn({ err: error }, 'Flux Cloud data unavailable for the daily KPI report');
        // The section still renders — with "Not available at report time" rows — so a
        // failed read is visible, not silently missing from the report.
        return {
            instant: { fluxCloud: { appsDeployed: null, appsExpiring24h: null } },
            activity: null
        };
    }
}

/**
 * Compute a full KPI report for a timeframe. Pure data — delivery is separate.
 *
 * @param {'daily'|'weekly'|'monthly'|'quarterly'|'yearly'} timeframe
 * @param {Date} [now] injectable for tests
 */
export async function buildKpiReport(timeframe, now = new Date()) {
    const { current, comparison, label } = getPeriodRanges(timeframe, now);

    const [currentSnapshots, comparisonSnapshots, currentRevenue, comparisonRevenue, earliestRevenueDate, decentralizationHistory] =
        await Promise.all([
            getSnapshotsInRange(current.start, current.end),
            getSnapshotsInRange(comparison.start, comparison.end),
            getPeriodRevenue(current),
            getPeriodRevenue(comparison),
            getOldestTransactionDate(),
            getDecentralizationSnapshotHistory(current.start, current.end).catch(() => [])
        ]);

    // The Flux Cloud reading only exists "now", so it rides on the daily report,
    // where the whole point is the state of the network today.
    const fluxCloud = timeframe === 'daily' ? await getFluxCloudData() : null;

    const dataset = buildKpiDataset({
        current,
        comparison,
        currentSnapshots,
        comparisonSnapshots,
        currentRevenue,
        comparisonRevenue,
        earliestRevenueDate: earliestRevenueDate ? String(earliestRevenueDate).slice(0, 10) : null,
        instant: fluxCloud?.instant
    });

    const topDatacenters = computeTopDatacentersForPeriod(decentralizationHistory);

    return {
        timeframe,
        label,
        current,
        comparison,
        currentLabel: formatPeriod(timeframe, current),
        comparisonLabel: formatPeriod(timeframe, comparison),
        dataset,
        // Per-app Flux Cloud detail, present only on daily. Discord renders it as a
        // second "Flux Cloud Activity" message; other consumers can ignore it.
        fluxCloud: fluxCloud?.activity ?? null,
        topDatacenters,
        generatedAt: new Date(now).toISOString()
    };
}

/**
 * POST one payload to a Discord webhook. The URL must already be validated; this is
 * the function that actually makes the outbound request, so the redirect guard lives here.
 */
async function postWebhook(webhookUrl, payload) {
    try {
        await axios.post(webhookUrl, payload, {
            timeout: WEBHOOK_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
            maxRedirects: 0,          // a redirect could leave the discord.com allowlist
            validateStatus: s => s >= 200 && s < 300
        });
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
 * Validated single-payload poster for non-report senders (the scheduler's failure
 * notice). Re-validates the URL here — the last place the SSRF guard can live.
 */
export async function postToDiscordWebhook(webhookUrl, payload) {
    if (!isValidDiscordWebhook(webhookUrl)) {
        throw new Error('Not a valid Discord webhook URL');
    }
    await postWebhook(webhookUrl, payload);
}

/**
 * POST the report to a Discord webhook. On the daily timeframe a second message —
 * "Flux Cloud Activity", the per-app detail behind the report's Flux Cloud section —
 * follows the main one. Both go to the same webhook.
 *
 * The URL is re-validated here, not just at the API boundary — this is the function that
 * actually makes the outbound requests, so it is the last place the SSRF guard can live.
 *
 * @returns {{delivered: boolean, activityDelivered?: boolean, activityError?: string}}
 *   `activityDelivered: false` means the main report arrived but the follow-up message
 *   failed — the caller surfaces that instead of failing the whole submission (and
 *   prompting a retry that would duplicate the main report).
 */
export async function sendToDiscord(webhookUrl, report) {
    if (!isValidDiscordWebhook(webhookUrl)) {
        throw new Error('Not a valid Discord webhook URL');
    }

    await postWebhook(webhookUrl, buildDiscordPayload(report));

    const activityPayload = buildFluxCloudActivityPayload(report);
    if (!activityPayload) {
        return { delivered: true };
    }

    try {
        await postWebhook(webhookUrl, activityPayload);
        return { delivered: true, activityDelivered: true };
    } catch (error) {
        log.error({ err: error }, 'Flux Cloud Activity message failed after the main report was delivered');
        return { delivered: true, activityDelivered: false, activityError: error.message };
    }
}

/**
 * Failure notice for the scheduler: one embed saying the scheduled report failed and
 * will be retried. Same webhook the reports go to; same SSRF guard.
 */
export async function sendSchedulerFailureNotice(webhookUrl, timeframe, errorMessage) {
    await postToDiscordWebhook(webhookUrl, buildSchedulerFailurePayload(timeframe, errorMessage));
}

/**
 * Plain-text rendering, used by the modal's preview so a user can see the numbers before
 * (or without) sending anything.
 */
export { buildDiscordPayload, isValidDiscordWebhook };

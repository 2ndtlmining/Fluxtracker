import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate,
    getRevenueFromAddressesForDateRange,
    getDecentralizationSnapshotHistory,
    getDailyGameRevenueInRange,
    getDailyRevenueMixInRange
} from '../db/database.js';
import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES, GAME_APP_NAME_PATTERN, resolveGameFromAppName } from '../config.js';
import { summarizeGameRevenue } from '../utils/gameRevenue.js';
import { revenueTrend, mostDeployedLine, buildScorecardPayload } from '../kpi/scorecard.js';
import { getPeriodRanges, formatPeriod, dayCount } from '../kpi/periods.js';
import { buildKpiDataset, sumDaily, computeTopDatacentersForPeriod } from '../kpi/metrics.js';
import { buildSchedulerFailurePayload, isValidDiscordWebhook } from '../kpi/discord.js';
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
 * The executive scorecard's figures beyond the metric dataset (owner redesign,
 * 2026-09-26): game-server revenue, the new-vs-renewal split, median time left,
 * deployed/expiring, the revenue trend line and the "Most deployed" line. Each piece is
 * read independently and falls back to null -- a missing migration or a failed read
 * renders as "n/a" on its tile, never as a fake zero, and never fails the report.
 */
async function getExecutiveExtras(timeframe, current, comparison, currentSnapshots, comparisonSnapshots, fluxCloud) {
    const safe = promise => promise.catch(error => {
        log.warn({ err: error }, 'KPI scorecard figure unavailable');
        return null;
    });
    const [gameCur, gameCmp, mixRows, usdRows] = await Promise.all([
        safe(getDailyGameRevenueInRange(current.start, current.end, GAME_APP_NAME_PATTERN)),
        safe(getDailyGameRevenueInRange(comparison.start, comparison.end, GAME_APP_NAME_PATTERN)),
        safe(getDailyRevenueMixInRange(current.start, current.end)),
        safe(getDailyRevenueUSDInRange(current.start, current.end))
    ]);

    const game = gameCur ? { current: summarizeGameRevenue(gameCur), comparison: gameCmp ? summarizeGameRevenue(gameCmp) : null } : null;

    let mix = null;
    if (mixRows?.length) {
        const sum = key => mixRows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
        const total = sum('total_flux');
        if (total > 0) mix = { newPercent: (100 * sum('new_flux')) / total, renewalPercent: (100 * sum('update_flux')) / total };
    }

    // Median time left is a point-in-time reading: the last recorded day of each period.
    const lastReading = rows => [...(rows ?? [])].reverse().map(r => r.median_days_left).find(v => v != null);
    const medianCur = lastReading(currentSnapshots);
    const medianDaysLeft = medianCur != null ? { current: Number(medianCur), comparison: lastReading(comparisonSnapshots) != null ? Number(lastReading(comparisonSnapshots)) : null } : null;

    // Deployed / expiring: live 24h counts on the daily report; summed daily snapshot counts
    // otherwise, and only when every day of the period has a reading.
    let activity = null;
    if (timeframe === 'daily') {
        const f = fluxCloud?.instant?.fluxCloud;
        if (f && f.appsDeployed != null && f.appsExpiring24h != null) activity = { deployed: f.appsDeployed, expiring: f.appsExpiring24h };
    } else if (currentSnapshots?.length && currentSnapshots.every(s => s.apps_deployed_today != null && s.apps_expiring_today != null)) {
        activity = {
            deployed: currentSnapshots.reduce((a, s) => a + Number(s.apps_deployed_today), 0),
            expiring: currentSnapshots.reduce((a, s) => a + Number(s.apps_expiring_today), 0)
        };
    }

    const deployedNames = fluxCloud?.activity?.deployedToday?.cached ? fluxCloud.activity.deployedToday.apps.map(a => a.name) : null;

    return {
        gameRevenue: game,
        mix,
        medianDaysLeft,
        activity,
        trend: usdRows ? revenueTrend(timeframe, usdRows, current) : null,
        mostDeployed: timeframe === 'daily' && deployedNames ? mostDeployedLine(deployedNames, resolveGameFromAppName) : null
    };
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
    const executive = await getExecutiveExtras(timeframe, current, comparison, currentSnapshots, comparisonSnapshots, fluxCloud);

    return {
        timeframe,
        label,
        current,
        comparison,
        currentLabel: formatPeriod(timeframe, current),
        comparisonLabel: formatPeriod(timeframe, comparison),
        dataset,
        // Per-app Flux Cloud detail, present only on daily (the scorecard reduces it to one
        // "Most deployed" line; the full lists stay here for API consumers).
        fluxCloud: fluxCloud?.activity ?? null,
        topDatacenters,
        // The executive scorecard's extra figures (see getExecutiveExtras).
        executive,
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
 * POST the report to a Discord webhook as the executive scorecard (owner redesign,
 * 2026-09-26): one message. The daily report used to follow it with a second "Flux Cloud
 * Activity" message of per-app tables; that detail is now one "Most deployed" line inside
 * the scorecard.
 *
 * The URL is re-validated here, not just at the API boundary — this is the function that
 * actually makes the outbound request, so it is the last place the SSRF guard can live.
 *
 * @returns {{delivered: boolean}}
 */
export async function sendToDiscord(webhookUrl, report) {
    if (!isValidDiscordWebhook(webhookUrl)) {
        throw new Error('Not a valid Discord webhook URL');
    }
    await postWebhook(webhookUrl, buildScorecardPayload(report));
    return { delivered: true };
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
export { buildScorecardPayload, isValidDiscordWebhook };

// ============================================
// KPI SCHEDULER — env-configured scheduled reports
// ============================================
// Sends the scheduled KPI reports to a Discord webhook without anyone clicking
// anything. Configured entirely via env vars (the operator's .env or docker run -e —
// both npm and Docker runs read process.env identically):
//
//   KPI_WEBHOOK_URL        Discord webhook; unset/invalid = feature off
//   KPI_SCHEDULE           any comma-separated list of KPI timeframes:
//                          daily, weekly, monthly, quarterly, yearly
//   KPI_SCHEDULE_HOUR_UTC  hour of day (UTC) the daily run fires; the other
//                          timeframes go out in the same hour once their period has
//                          completed (monthly on the 1st, quarterly on the 1st of
//                          the quarter's first month, yearly on Jan 1)
//
// Restart-safe dedupe with NO schema change: a success records a receipt in the
// existing sync_status table (`kpi_<timeframe>`), so a restart after the scheduled
// hour cannot double-send, while a server that was down at the scheduled hour
// catches up on the next tick (or at boot). Failures are retried every tick; the
// failure notice goes to the same webhook once per period.
//
// The manual footer button is untouched: the scheduler calls buildKpiReport() +
// sendToDiscord() directly, bypassing the POST endpoint and its rate limiter.

import {
    buildKpiReport,
    sendToDiscord,
    sendSchedulerFailureNotice,
    isValidDiscordWebhook
} from './kpiService.js';
import { getSyncStatus, updateSyncStatus } from '../db/database.js';
import { TIMEFRAMES } from '../kpi/periods.js';
import { isDue, periodKey, isoUtc } from '../kpi/schedulerTime.js';
import { createLogger } from '../logger.js';

const log = createLogger('kpiScheduler');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const RECEIPT_PREFIX = 'kpi_';

let timer = null;
let schedulerState = {
    configured: false,
    schedule: [],
    hourUtc: 2,
    webhookUrl: null,
    lastRuns: {},
    running: false
};

/**
 * Pure env parsing — invalid values degrade to the documented defaults instead of
 * crashing the server. Schedule entries must be real KPI timeframes (daily..yearly);
 * anything else is dropped with the rest of the validation.
 */
export function parseKpiSchedulerConfig(env = process.env) {
    const webhookUrl = (env.KPI_WEBHOOK_URL || '').trim() || null;
    const schedule = (env.KPI_SCHEDULE || '')
        .split(',')
        .map(tf => tf.trim().toLowerCase())
        .filter(tf => TIMEFRAMES.includes(tf));
    const parsedHour = Number.parseInt(env.KPI_SCHEDULE_HOUR_UTC ?? '2', 10);
    const hourUtc = Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 2;
    return { webhookUrl, schedule, hourUtc };
}

export function getKpiSchedulerState() {
    return {
        configured: schedulerState.configured,
        reason: schedulerState.reason ?? null,
        schedule: schedulerState.schedule,
        hourUtc: schedulerState.hourUtc,
        lastRuns: schedulerState.lastRuns
    };
}

/**
 * Start the scheduler (or leave it disabled). An immediate tick runs at boot: the
 * sync_status receipt makes boot-time catch-up safe (a server that was down at the
 * scheduled hour sends the report on boot; one that already sent does not re-send).
 */
export function startKpiScheduler({ runImmediately = true } = {}) {
    // Idempotent: both DB-ready paths in server.js call this (initial boot + the
    // late-connection retry), and startSchedulers() itself can run more than once.
    if (timer) return getKpiSchedulerState();

    const config = parseKpiSchedulerConfig(process.env);
    const webhookValid = Boolean(config.webhookUrl) && isValidDiscordWebhook(config.webhookUrl);

    if (!webhookValid || config.schedule.length === 0) {
        // Say exactly why in /api/health — a disabled scheduler with no reason is how
        // this misconfiguration hid from a user checking /api/health.
        const reason = !config.webhookUrl
            ? 'missing_webhook'
            : !webhookValid
                ? 'invalid_webhook'
                : 'no_valid_schedule';
        schedulerState = {
            configured: false,
            reason,
            schedule: [],
            hourUtc: config.hourUtc,
            webhookUrl: null,
            lastRuns: {},
            running: false
        };
        if (config.webhookUrl || config.schedule.length > 0) {
            log.warn(
                { hasWebhook: Boolean(config.webhookUrl), schedule: config.schedule, reason },
                'KPI scheduler disabled: KPI_WEBHOOK_URL must be a valid Discord webhook URL and KPI_SCHEDULE must contain valid timeframes (daily, weekly, monthly, quarterly, yearly)'
            );
        } else {
            log.info({ reason }, 'KPI scheduler disabled: KPI_WEBHOOK_URL / KPI_SCHEDULE not set');
        }
        return getKpiSchedulerState();
    }

    schedulerState = {
        configured: true,
        reason: null,
        schedule: config.schedule,
        hourUtc: config.hourUtc,
        webhookUrl: config.webhookUrl,
        lastRuns: {},
        running: false
    };
    timer = setInterval(() => { tick(); }, CHECK_INTERVAL_MS);
    timer.unref?.(); // never hold the process open for a report
    log.info({ schedule: config.schedule, hourUtc: config.hourUtc }, 'KPI scheduler started');
    // Immediate check: the sync_status receipt makes boot-time catch-up safe (a server
    // that was down at the scheduled hour sends on boot; one that already sent does not
    // re-send).
    if (runImmediately) tick();
    return getKpiSchedulerState();
}

/** One scheduler pass — also the test hook for driving ticks deterministically. */
export function runSchedulerTick() {
    return tick();
}

export function stopKpiScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}

async function tick() {
    if (schedulerState.running) return; // a slow send must never overlap the next tick
    schedulerState.running = true;
    try {
        for (const timeframe of schedulerState.schedule) {
            await runForTimeframe(timeframe);
        }
    } catch (error) {
        log.error({ err: error }, 'KPI scheduler tick failed');
    } finally {
        schedulerState.running = false;
    }
}

/**
 * Receipt timestamps are epoch millis in both adapters (sqlite INTEGER, supabase
 * BIGINT). Number() handles that; Date.parse() only handles strings and would return
 * NaN for a number, which used to poison every period-key comparison after the
 * upsert fix made receipts actually persist.
 */
function receiptToMs(value) {
    if (value == null) return null;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One timeframe attempt: due-check against the success receipt, then deliver and
 * record. Failures are retried on later ticks (the success receipt is untouched by
 * a failed attempt, so the report stays due).
 */
async function runForTimeframe(timeframe) {
    const receiptType = `${RECEIPT_PREFIX}${timeframe}`;
    const receipt = await getSyncStatus(receiptType).catch(() => null);
    const lastSyncMs = receiptToMs(receipt?.last_sync);

    if (!isDue(timeframe, Date.now(), schedulerState.hourUtc, lastSyncMs)) {
        return { sent: false, reason: 'not due' };
    }

    try {
        const report = await buildKpiReport(timeframe);

        if (report.dataset.empty) {
            throw new Error(
                `Not enough historical data for a ${timeframe} report ` +
                `(${report.currentLabel} vs ${report.comparisonLabel})`
            );
        }

        await sendToDiscord(schedulerState.webhookUrl, report);
        await updateSyncStatus(receiptType, 'completed');
        schedulerState.lastRuns[timeframe] = { at: isoUtc(Date.now()), ok: true };
        log.info({ timeframe }, 'Scheduled KPI report delivered');
        return { sent: true };
    } catch (error) {
        await recordFailureAndNotice(timeframe, error);
        return { sent: false, error: error.message };
    }
}

/**
 * Records the failure (always) and posts a failure notice to the configured webhook
 * (once per period — a dead webhook must not be spammed every tick; /api/health is
 * the backstop when the notice itself cannot be delivered). A failed attempt never
 * touches the success receipt, so the report stays due and is retried next tick.
 */
async function recordFailureAndNotice(timeframe, error) {
    const failureType = `${RECEIPT_PREFIX}${timeframe}_failed`;
    // Date.now() (number), not new Date(): keeps the period-key comparison on a plain
    // epoch value in both backends and test environments.
    const nowMs = Date.now();
    const failureReceipt = await getSyncStatus(failureType).catch(() => null);
    const lastFailureMs = receiptToMs(failureReceipt?.last_sync);
    const noticedThisPeriod = lastFailureMs !== null
        && periodKey(timeframe, lastFailureMs) === periodKey(timeframe, nowMs);

    if (!noticedThisPeriod) {
        try {
            await sendSchedulerFailureNotice(schedulerState.webhookUrl, timeframe, error.message);
        } catch (noticeError) {
            log.warn({ err: noticeError, timeframe }, 'KPI scheduler failure notice could not be delivered');
        }
    }

    await updateSyncStatus(failureType, 'notified', error.message);
    schedulerState.lastRuns[timeframe] = { at: isoUtc(nowMs), ok: false, error: error.message };
    log.error({ timeframe, err: error }, 'Scheduled KPI report failed');
}

// ============================================
// ANOMALY ALERTS (issue #269) -- Discord, on the KPI report's webhook
// ============================================
// Two alerts, chosen by the owner (2026-09-26):
//   - sync outage: no payment synced for ANOMALY_OUTAGE_HOURS (default 6). One message when
//     it starts, one when payments arrive again -- never repeated in between.
//   - unusual revenue day: once a UTC day is complete, its USD revenue compared with the 28
//     days before it (see utils/anomalies.js); one message per unusual day, naming the
//     biggest payment's app and whether the team, a card or FLUX paid it.
//
// Off unless ANOMALY_ALERTS=on, and it needs a valid KPI_WEBHOOK_URL (the same webhook and
// the same SSRF guard as the KPI reports). Restart-safe through sync_status receipts, like
// kpiScheduler.js: `alert_outage` (status open/closed) and `alert_spike` (last day checked).

import { postToDiscordWebhook, isValidDiscordWebhook } from './kpiService.js';
import {
    getSyncStatus,
    updateSyncStatus,
    getTransactionsPaginated,
    getTransactionsByDate,
    getDailyRevenueUSDInRange
} from '../db/database.js';
import { isFluxTeamAddress, isFluxFiatAddress } from '../config.js';
import {
    revenueSpike,
    largestPayment,
    hoursSinceLastPayment,
    buildSpikePayload,
    buildOutagePayload,
    buildRecoveryPayload,
    SPIKE_LOOKBACK_DAYS
} from '../utils/anomalies.js';
import { createLogger } from '../logger.js';

const log = createLogger('anomalyAlerts');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
// A day is judged at 01:00 UTC the next day, so late-syncing payments have landed.
const SPIKE_CHECK_HOUR_UTC = 1;
const OUTAGE_RECEIPT = 'alert_outage';
const SPIKE_RECEIPT = 'alert_spike';

let timer = null;
let state = { configured: false, reason: 'not_started', outageHours: 6, running: false, lastCheck: null, lastAlert: null };

/** Pure env parsing; bad values fall back to the defaults instead of crashing. */
export function parseAnomalyConfig(env = process.env) {
    const enabled = String(env.ANOMALY_ALERTS || '').trim().toLowerCase();
    const hours = Number.parseInt(env.ANOMALY_OUTAGE_HOURS ?? '6', 10);
    return {
        enabled: ['on', 'true', '1', 'yes'].includes(enabled),
        webhookUrl: (env.KPI_WEBHOOK_URL || '').trim() || null,
        outageHours: Number.isInteger(hours) && hours >= 1 && hours <= 72 ? hours : 6
    };
}

export function getAnomalyAlertsState() {
    const { configured, reason, outageHours, lastCheck, lastAlert } = state;
    return { configured, reason, outageHours, lastCheck, lastAlert };
}

export function startAnomalyAlerts({ runImmediately = true } = {}) {
    if (timer) return getAnomalyAlertsState(); // idempotent, like startKpiScheduler()

    const config = parseAnomalyConfig(process.env);
    if (!config.enabled) {
        state = { ...state, configured: false, reason: 'disabled' };
        log.info('Anomaly alerts off (set ANOMALY_ALERTS=on to enable)');
        return getAnomalyAlertsState();
    }
    if (!config.webhookUrl || !isValidDiscordWebhook(config.webhookUrl)) {
        state = { ...state, configured: false, reason: config.webhookUrl ? 'invalid_webhook' : 'missing_webhook' };
        log.warn({ reason: state.reason }, 'Anomaly alerts need a valid KPI_WEBHOOK_URL');
        return getAnomalyAlertsState();
    }

    state = { configured: true, reason: null, outageHours: config.outageHours, webhookUrl: config.webhookUrl, running: false, lastCheck: null, lastAlert: null };
    timer = setInterval(() => { tick(); }, CHECK_INTERVAL_MS);
    timer.unref?.();
    log.info({ outageHours: config.outageHours }, 'Anomaly alerts started');
    if (runImmediately) tick();
    return getAnomalyAlertsState();
}

export function stopAnomalyAlerts() {
    if (timer) clearInterval(timer);
    timer = null;
}

/** One pass -- also the test hook. */
export function runAnomalyTick(nowMs = Date.now()) {
    return tick(nowMs);
}

async function tick(nowMs = Date.now()) {
    if (state.running) return;
    state.running = true;
    try {
        await checkOutage(nowMs);
        await checkSpike(nowMs);
        state.lastCheck = new Date(nowMs).toISOString();
    } catch (error) {
        log.error({ err: error }, 'Anomaly check failed');
    } finally {
        state.running = false;
    }
}

async function send(kind, payload) {
    await postToDiscordWebhook(state.webhookUrl, payload);
    state.lastAlert = { kind, at: new Date().toISOString() };
    log.info({ kind }, 'Anomaly alert delivered');
}

async function checkOutage(nowMs) {
    const newest = (await getTransactionsPaginated(1, 1))?.transactions?.[0];
    const hours = hoursSinceLastPayment(newest?.timestamp, nowMs);
    if (hours === null) return; // nothing synced yet (fresh install): nothing to judge
    const receipt = await getSyncStatus(OUTAGE_RECEIPT).catch(() => null);
    const open = receipt?.status === 'open';

    if (hours >= state.outageHours && !open) {
        await send('outage', buildOutagePayload(hours, newest.timestamp));
        await updateSyncStatus(OUTAGE_RECEIPT, 'open');
    } else if (hours < state.outageHours && open) {
        const openedMs = Number(receipt.last_sync);
        await send('recovery', buildRecoveryPayload(Number.isFinite(openedMs) ? (nowMs - openedMs) / 3_600_000 + state.outageHours : null));
        await updateSyncStatus(OUTAGE_RECEIPT, 'closed');
    }
}

async function checkSpike(nowMs) {
    const now = new Date(nowMs);
    if (now.getUTCHours() < SPIKE_CHECK_HOUR_UTC) return;
    const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);

    // One check per completed day: the receipt's message holds the last day judged.
    const receipt = await getSyncStatus(SPIKE_RECEIPT).catch(() => null);
    if (receipt?.error_message === yesterday) return;

    const from = new Date(Date.parse(`${yesterday}T00:00:00Z`) - SPIKE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = await getDailyRevenueUSDInRange(from, yesterday);
    const spike = revenueSpike(rows, yesterday);
    if (spike) {
        const biggest = largestPayment(await getTransactionsByDate(yesterday), { isTeam: isFluxTeamAddress, isFiat: isFluxFiatAddress });
        await send('spike', buildSpikePayload(yesterday, spike, biggest));
    }
    // Recorded only after a successful check (and send): a failure retries next tick.
    await updateSyncStatus(SPIKE_RECEIPT, spike ? 'alerted' : 'checked', yesterday);
}

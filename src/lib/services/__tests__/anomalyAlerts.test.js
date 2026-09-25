import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #269: anomaly alerts. The database and the Discord POST are mocked -- this checks
 * WHEN a message goes out (once per outage, once per unusual day, never when disabled),
 * which is the part that would spam a channel if it were wrong.
 */

const receipts = new Map();
let newestTimestampSec = null;
let dailyRows = [];

vi.mock('../kpiService.js', () => ({
    postToDiscordWebhook: vi.fn(() => Promise.resolve()),
    isValidDiscordWebhook: vi.fn(url => typeof url === 'string' && url.startsWith('https://discord.com/api/webhooks/'))
}));
vi.mock('../../db/database.js', () => ({
    getSyncStatus: vi.fn(async type => receipts.get(type) ?? null),
    updateSyncStatus: vi.fn(async (type, status, message = null) => {
        receipts.set(type, { sync_type: type, status, error_message: message, last_sync: Date.now() });
    }),
    getTransactionsPaginated: vi.fn(async () => ({ transactions: newestTimestampSec ? [{ timestamp: newestTimestampSec }] : [] })),
    getTransactionsByDate: vi.fn(async () => [{ app_name: 'kagura', amount_usd: 2100, amount: 30000, from_address: 't1wallet' }]),
    getDailyRevenueUSDInRange: vi.fn(async () => dailyRows)
}));

const { postToDiscordWebhook } = await import('../kpiService.js');
const alerts = await import('../anomalyAlerts.js');

const WEBHOOK = 'https://discord.com/api/webhooks/1/abc';
const NOW = Date.parse('2026-09-29T03:00:00Z');   // after the 01:00 UTC spike check hour
const hoursAgo = h => Math.floor((NOW - h * 3_600_000) / 1000);

function normalHistory(yesterdayUsd) {
    const rows = [];
    for (let i = 1; i <= 29; i++) {
        const day = new Date(Date.parse('2026-09-28T00:00:00Z') - (i - 1) * 86_400_000).toISOString().slice(0, 10);
        rows.push({ date: day, daily_revenue_usd: i === 1 ? yesterdayUsd : 300 + (i % 5) * 20 });
    }
    return rows;
}

function start(env) {
    alerts.stopAnomalyAlerts();
    process.env.ANOMALY_ALERTS = env.ANOMALY_ALERTS ?? '';
    process.env.KPI_WEBHOOK_URL = env.KPI_WEBHOOK_URL ?? '';
    process.env.ANOMALY_OUTAGE_HOURS = env.ANOMALY_OUTAGE_HOURS ?? '';
    return alerts.startAnomalyAlerts({ runImmediately: false });
}

beforeEach(() => {
    receipts.clear();
    postToDiscordWebhook.mockClear();
    newestTimestampSec = hoursAgo(1);
    dailyRows = normalHistory(340);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});

afterEach(() => {
    alerts.stopAnomalyAlerts();
    vi.useRealTimers();
});

describe('configuration', () => {
    it('is off unless ANOMALY_ALERTS=on', () => {
        expect(start({ KPI_WEBHOOK_URL: WEBHOOK })).toMatchObject({ configured: false, reason: 'disabled' });
    });

    it('needs a valid Discord webhook', () => {
        expect(start({ ANOMALY_ALERTS: 'on' })).toMatchObject({ configured: false, reason: 'missing_webhook' });
        expect(start({ ANOMALY_ALERTS: 'on', KPI_WEBHOOK_URL: 'https://example.com/hook' })).toMatchObject({ reason: 'invalid_webhook' });
        expect(start({ ANOMALY_ALERTS: 'on', KPI_WEBHOOK_URL: WEBHOOK })).toMatchObject({ configured: true, outageHours: 6 });
    });

    it('reads ANOMALY_OUTAGE_HOURS and falls back to 6 on nonsense', () => {
        expect(alerts.parseAnomalyConfig({ ANOMALY_OUTAGE_HOURS: '12' }).outageHours).toBe(12);
        expect(alerts.parseAnomalyConfig({ ANOMALY_OUTAGE_HOURS: 'soon' }).outageHours).toBe(6);
    });
});

describe('sync outage', () => {
    beforeEach(() => { start({ ANOMALY_ALERTS: 'on', KPI_WEBHOOK_URL: WEBHOOK }); });

    it('alerts once when payments stop, then once when they resume', async () => {
        newestTimestampSec = hoursAgo(7);
        await alerts.runAnomalyTick(NOW);
        await alerts.runAnomalyTick(NOW + 600_000);        // still down: no repeat
        const outage = postToDiscordWebhook.mock.calls.filter(c => JSON.stringify(c[1]).includes('No new payments synced'));
        expect(outage).toHaveLength(1);

        newestTimestampSec = hoursAgo(0);
        await alerts.runAnomalyTick(NOW + 1_200_000);
        await alerts.runAnomalyTick(NOW + 1_800_000);      // recovered: no repeat either
        const recovered = postToDiscordWebhook.mock.calls.filter(c => JSON.stringify(c[1]).includes('Payments syncing again'));
        expect(recovered).toHaveLength(1);
    });

    it('stays quiet while payments keep arriving', async () => {
        await alerts.runAnomalyTick(NOW);
        expect(postToDiscordWebhook.mock.calls.filter(c => JSON.stringify(c[1]).includes('synced'))).toHaveLength(0);
    });
});

describe('unusual revenue day', () => {
    beforeEach(() => { start({ ANOMALY_ALERTS: 'on', KPI_WEBHOOK_URL: WEBHOOK }); });

    it('alerts once for a spike day, naming the biggest payment', async () => {
        dailyRows = normalHistory(3200);
        await alerts.runAnomalyTick(NOW);
        await alerts.runAnomalyTick(NOW + 600_000);
        const spikes = postToDiscordWebhook.mock.calls.filter(c => JSON.stringify(c[1]).includes('Unusual revenue day: 2026-09-28'));
        expect(spikes).toHaveLength(1);
        expect(JSON.stringify(spikes[0][1])).toContain('kagura: $2,100, paid by FLUX');
    });

    it('checks each day once and sends nothing on an ordinary day', async () => {
        await alerts.runAnomalyTick(NOW);
        expect(postToDiscordWebhook).not.toHaveBeenCalled();
        expect(receipts.get('alert_spike')).toMatchObject({ status: 'checked', error_message: '2026-09-28' });
    });

    it('waits until 01:00 UTC so late payments have synced', async () => {
        dailyRows = normalHistory(3200);
        const early = Date.parse('2026-09-29T00:30:00Z');
        vi.setSystemTime(early);
        await alerts.runAnomalyTick(early);
        expect(postToDiscordWebhook).not.toHaveBeenCalled();
    });

    it('retries on the next tick when the send fails', async () => {
        dailyRows = normalHistory(3200);
        postToDiscordWebhook.mockRejectedValueOnce(new Error('Discord down'));
        await alerts.runAnomalyTick(NOW);
        expect(receipts.has('alert_spike')).toBe(false);
        await alerts.runAnomalyTick(NOW + 600_000);
        expect(receipts.get('alert_spike')).toMatchObject({ status: 'alerted' });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * kpiScheduler — env-configured scheduled KPI reports.
 *
 * Dependencies are mocked: kpiService (build/send/notice/webhook validation) and the
 * database (sync_status receipts). Time is faked so due-ness is deterministic; ticks
 * are driven explicitly via runSchedulerTick() (the interval never fires in tests).
 *
 * IMPORTANT: the receipt mock is STATEFUL — getSyncStatus reads a map that
 * updateSyncStatus writes, mimicking real persistence. A stateless mock here is what
 * let the 10-minute re-send bug ship: the mocked receipt "persisted" only because the
 * test fed it, while the real adapter silently no-oped.
 */

vi.mock('../kpiService.js', () => ({
    buildKpiReport: vi.fn(),
    sendToDiscord: vi.fn(),
    sendSchedulerFailureNotice: vi.fn(),
    isValidDiscordWebhook: vi.fn()
}));
vi.mock('../../db/database.js', () => ({
    getSyncStatus: vi.fn(),
    updateSyncStatus: vi.fn()
}));

import {
    parseKpiSchedulerConfig,
    startKpiScheduler,
    stopKpiScheduler,
    runSchedulerTick,
    getKpiSchedulerState
} from '../kpiScheduler.js';
import {
    buildKpiReport,
    sendToDiscord,
    sendSchedulerFailureNotice,
    isValidDiscordWebhook
} from '../kpiService.js';
import { getSyncStatus, updateSyncStatus } from '../../db/database.js';

const VALID_URL = 'https://discord.com/api/webhooks/123456789/token';
const REPORT = {
    timeframe: 'daily',
    dataset: { empty: false },
    currentLabel: 'Sep 4, 2026',
    comparisonLabel: 'Sep 3, 2026'
};

// Stateful receipt store: updateSyncStatus WRITES here, getSyncStatus READS here.
const receipts = new Map();

beforeEach(() => {
    vi.clearAllMocks();
    // Spy on Date.now() (a static) instead of using fake timers: @sinonjs's fake
    // Date is corrupted by setSystemTime jumps (toISOString/getUTC* intermittently
    // break), while a static spy leaves every real Date constructor untouched.
    // Time jumps below are just Date.now.mockReturnValue(...). The scheduler's
    // 10-min interval is real but unref'd and cleared in afterEach.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-05T03:00:00Z')); // after the default 02:00 hour

    receipts.clear();
    getSyncStatus.mockImplementation(async type => receipts.get(type) ?? null);
    updateSyncStatus.mockImplementation(async (type, status, errorMessage = null) => {
        receipts.set(type, {
            ...(receipts.get(type) || {}),
            last_sync: Date.now(),   // faked clock — same value isDue() compares
            status,
            error_message: errorMessage
        });
    });

    isValidDiscordWebhook.mockReturnValue(true);
    buildKpiReport.mockResolvedValue({ ...REPORT });
    sendToDiscord.mockResolvedValue({ delivered: true });
    sendSchedulerFailureNotice.mockResolvedValue();

    process.env.KPI_WEBHOOK_URL = VALID_URL;
    process.env.KPI_SCHEDULE = 'daily';
    delete process.env.KPI_SCHEDULE_HOUR_UTC;
});

afterEach(() => {
    stopKpiScheduler();
    vi.restoreAllMocks();
    delete process.env.KPI_WEBHOOK_URL;
    delete process.env.KPI_SCHEDULE;
    delete process.env.KPI_SCHEDULE_HOUR_UTC;
});

function boot(envOverrides = {}) {
    Object.assign(process.env, envOverrides);
    return startKpiScheduler({ runImmediately: false });
}

describe('parseKpiSchedulerConfig', () => {
    it('defaults to off with hour 2', () => {
        expect(parseKpiSchedulerConfig({})).toEqual({ webhookUrl: null, schedule: [], hourUtc: 2 });
    });

    it('parses a comma-separated schedule case-insensitively and trims the webhook', () => {
        const config = parseKpiSchedulerConfig({
            KPI_WEBHOOK_URL: '  https://discord.com/api/webhooks/1/t  ',
            KPI_SCHEDULE: ' Daily , weekly , fortnightly ',
            KPI_SCHEDULE_HOUR_UTC: '14'
        });
        expect(config).toEqual({
            webhookUrl: 'https://discord.com/api/webhooks/1/t',
            schedule: ['daily', 'weekly'],
            hourUtc: 14
        });
    });

    it('accepts every KPI timeframe in the schedule', () => {
        const config = parseKpiSchedulerConfig({
            KPI_SCHEDULE: 'daily, weekly, monthly, quarterly, yearly'
        });
        expect(config.schedule).toEqual(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
    });

    it('an out-of-range hour falls back to 2', () => {
        expect(parseKpiSchedulerConfig({ KPI_SCHEDULE_HOUR_UTC: '25' }).hourUtc).toBe(2);
        expect(parseKpiSchedulerConfig({ KPI_SCHEDULE_HOUR_UTC: 'abc' }).hourUtc).toBe(2);
    });
});

describe('graceful without configuration', () => {
    it('no webhook: scheduler disabled with reason missing_webhook, nothing sent', async () => {
        delete process.env.KPI_WEBHOOK_URL;
        const state = boot();

        expect(state.configured).toBe(false);
        expect(state.reason).toBe('missing_webhook');
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
        expect(sendToDiscord).not.toHaveBeenCalled();
    });

    it('no schedule: scheduler disabled with reason no_valid_schedule', async () => {
        delete process.env.KPI_SCHEDULE;
        const state = boot();

        expect(state.configured).toBe(false);
        expect(state.reason).toBe('no_valid_schedule');
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
    });

    it('an invalid webhook disables the scheduler with reason invalid_webhook', async () => {
        process.env.KPI_WEBHOOK_URL = 'https://evil.com/api/webhooks/1/a';
        isValidDiscordWebhook.mockReturnValue(false);
        const state = boot();

        expect(state.configured).toBe(false);
        expect(state.reason).toBe('invalid_webhook');
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
    });

    it('a configured scheduler reports reason null', async () => {
        const state = boot();
        expect(state.configured).toBe(true);
        expect(state.reason).toBeNull();
    });
});

describe('scheduled delivery', () => {
    it('sends the due daily report and persists the receipt', async () => {
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).toHaveBeenCalledWith('daily');
        expect(sendToDiscord).toHaveBeenCalledWith(VALID_URL, expect.objectContaining({ timeframe: 'daily' }));
        // The receipt must actually persist — this is the stateful-mock regression
        // guard for the 10-minute re-send bug
        expect(receipts.get('kpi_daily').status).toBe('completed');
        expect(getKpiSchedulerState().lastRuns.daily.ok).toBe(true);
    });

    it('does not send before the configured hour', async () => {
        Date.now.mockReturnValue(Date.parse('2026-09-05T01:30:00Z'));
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).not.toHaveBeenCalled();
    });

    it('does not re-send when the receipt is from the same UTC day', async () => {
        receipts.set('kpi_daily', { last_sync: Date.parse('2026-09-05T02:00:00Z') });
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).not.toHaveBeenCalled();
        expect(updateSyncStatus).not.toHaveBeenCalled();
    });

    it('catches up when the server was down at the scheduled hour', async () => {
        // Receipt from yesterday 02:00 (last successful send), now it is today 03:00
        receipts.set('kpi_daily', { last_sync: Date.parse('2026-09-04T02:00:00Z') });
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).toHaveBeenCalledTimes(1);
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
    });

    it('weekly skips within the same ISO week and catches up across weeks', async () => {
        process.env.KPI_SCHEDULE = 'weekly';

        receipts.set('kpi_weekly', { last_sync: Date.parse('2026-09-04T02:00:00Z') }); // Friday, same ISO week
        boot();
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();

        receipts.set('kpi_weekly', { last_sync: Date.parse('2026-08-28T02:00:00Z') }); // previous ISO week
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledWith('weekly');
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
    });

    it('monthly fires on month rollover and settles after its once-per-month send', async () => {
        process.env.KPI_SCHEDULE = 'monthly';
        Date.now.mockReturnValue(Date.parse('2026-09-01T03:00:00Z'));  // August completed
        receipts.set('kpi_monthly', { last_sync: Date.parse('2026-08-25T02:00:00Z') });

        boot();
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledWith('monthly');
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
        // The stateful mock persisted the receipt with the faked "now"
        expect(receipts.get('kpi_monthly').last_sync).toBe(Date.now());

        // Sent this month: never again until the next rollover
        Date.now.mockReturnValue(Date.parse('2026-09-20T03:00:00Z'));
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledTimes(1);
    });

    it('fires every scheduled timeframe in one rollover tick', async () => {
        process.env.KPI_SCHEDULE = 'daily,weekly,monthly,quarterly,yearly';
        // Oct 1: all five periods completed at midnight
        Date.now.mockReturnValue(Date.parse('2026-10-01T03:00:00Z'));
        boot();
        await runSchedulerTick();

        for (const tf of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
            expect(buildKpiReport).toHaveBeenCalledWith(tf);
            expect(receipts.get(`kpi_${tf}`).status).toBe('completed');
        }
        expect(sendToDiscord).toHaveBeenCalledTimes(5);
    });
});

describe('failures', () => {
    it('an empty dataset is treated as a failure: notice sent, nothing delivered', async () => {
        buildKpiReport.mockResolvedValue({ ...REPORT, dataset: { empty: true } });
        boot();
        await runSchedulerTick();

        expect(sendToDiscord).not.toHaveBeenCalled();
        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(1);
        expect(sendSchedulerFailureNotice).toHaveBeenCalledWith(VALID_URL, 'daily', expect.stringContaining('Not enough historical data'));
        expect(receipts.get('kpi_daily_failed').status).toBe('notified');
        expect(getKpiSchedulerState().lastRuns.daily.ok).toBe(false);
    });

    it('a delivery failure notices once per period and never touches the success receipt', async () => {
        sendToDiscord.mockRejectedValue(new Error('Discord rejected the webhook. Check the URL is correct and still active.'));
        boot();
        await runSchedulerTick();

        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(1);
        expect(receipts.get('kpi_daily_failed').status).toBe('notified');
        // The success receipt was NOT recorded — the report stays due and is retried
        expect(receipts.get('kpi_daily')).toBeUndefined();
    });

    it('retries a failed report on later ticks without re-noticing in the same period', async () => {
        sendToDiscord.mockRejectedValue(new Error('down'));
        boot();
        await runSchedulerTick();   // first attempt: notice sent, failure receipt persisted

        Date.now.mockReturnValue(Date.parse('2026-09-05T03:10:00Z'));   // next tick, same period
        await runSchedulerTick();

        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(1);  // still once
        expect(receipts.get('kpi_daily_failed').status).toBe('notified');
        expect(sendToDiscord).toHaveBeenCalledTimes(2);               // but the send is retried
    });

    it('re-notices in a NEW period after a previously failed period', async () => {
        sendToDiscord.mockRejectedValue(new Error('down'));
        boot();
        await runSchedulerTick();   // daily fails on Sep 5, notice #1, receipt persisted

        // Next day: the daily report is due again (different period) — a fresh failure
        // must notice again
        Date.now.mockReturnValue(Date.parse('2026-09-06T03:00:00Z'));
        await runSchedulerTick();

        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(2);
    });

    it('starts idempotently — a second start does not double the schedule', async () => {
        boot();
        const second = startKpiScheduler({ runImmediately: false });

        expect(second.configured).toBe(true);
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledTimes(1);  // one tick = one attempt
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * kpiScheduler — env-configured scheduled KPI reports.
 *
 * Dependencies are mocked: kpiService (build/send/notice/webhook validation) and the
 * database (sync_status receipts). Time is faked so due-ness is deterministic; ticks
 * are driven explicitly via runSchedulerTick() (the interval never fires in tests).
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

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T03:00:00Z')); // after the default 02:00 hour

    isValidDiscordWebhook.mockReturnValue(true);
    getSyncStatus.mockResolvedValue(null);              // never sent
    buildKpiReport.mockResolvedValue({ ...REPORT });
    sendToDiscord.mockResolvedValue({ delivered: true });
    sendSchedulerFailureNotice.mockResolvedValue();

    process.env.KPI_WEBHOOK_URL = VALID_URL;
    process.env.KPI_SCHEDULE = 'daily';
    delete process.env.KPI_SCHEDULE_HOUR_UTC;
});

afterEach(() => {
    stopKpiScheduler();
    vi.useRealTimers();
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
    it('no webhook: scheduler disabled, nothing sent', async () => {
        delete process.env.KPI_WEBHOOK_URL;
        const state = boot();

        expect(state.configured).toBe(false);
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
        expect(sendToDiscord).not.toHaveBeenCalled();
    });

    it('no schedule: scheduler disabled', async () => {
        delete process.env.KPI_SCHEDULE;
        const state = boot();

        expect(state.configured).toBe(false);
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
    });

    it('an invalid webhook disables the scheduler', async () => {
        process.env.KPI_WEBHOOK_URL = 'https://evil.com/api/webhooks/1/a';
        isValidDiscordWebhook.mockReturnValue(false);
        const state = boot();

        expect(state.configured).toBe(false);
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();
    });
});

describe('scheduled delivery', () => {
    it('sends the due daily report and records the receipt', async () => {
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).toHaveBeenCalledWith('daily');
        expect(sendToDiscord).toHaveBeenCalledWith(VALID_URL, expect.objectContaining({ timeframe: 'daily' }));
        expect(updateSyncStatus).toHaveBeenCalledWith('kpi_daily', 'completed');
        expect(getKpiSchedulerState().lastRuns.daily.ok).toBe(true);
    });

    it('does not send before the configured hour', async () => {
        vi.setSystemTime(new Date('2026-09-05T01:30:00Z'));
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).not.toHaveBeenCalled();
    });

    it('does not re-send when the receipt is from the same UTC day', async () => {
        getSyncStatus.mockResolvedValue({ last_sync: '2026-09-05T02:00:00.000Z' });
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).not.toHaveBeenCalled();
        expect(updateSyncStatus).not.toHaveBeenCalled();
    });

    it('catches up when the server was down at the scheduled hour', async () => {
        // Receipt from yesterday 02:00 (last successful send), now it is today 03:00
        getSyncStatus.mockResolvedValue({ last_sync: '2026-09-04T02:00:00.000Z' });
        boot();
        await runSchedulerTick();

        expect(buildKpiReport).toHaveBeenCalledTimes(1);
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
    });

    it('weekly skips within the same ISO week and catches up across weeks', async () => {
        process.env.KPI_SCHEDULE = 'weekly';

        getSyncStatus.mockResolvedValue({ last_sync: '2026-09-04T02:00:00.000Z' }); // Friday, same ISO week
        boot();
        await runSchedulerTick();
        expect(buildKpiReport).not.toHaveBeenCalled();

        getSyncStatus.mockResolvedValue({ last_sync: '2026-08-28T02:00:00.000Z' }); // previous ISO week
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledWith('weekly');
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
    });

    it('monthly fires on month rollover and settles after its once-per-month send', async () => {
        process.env.KPI_SCHEDULE = 'monthly';
        vi.setSystemTime(new Date('2026-09-01T03:00:00Z'));  // August completed
        let monthlyReceipt = { last_sync: '2026-08-25T02:00:00.000Z' };
        getSyncStatus.mockImplementation(async type => (type === 'kpi_monthly' ? monthlyReceipt : null));

        boot();
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledWith('monthly');
        expect(sendToDiscord).toHaveBeenCalledTimes(1);
        expect(updateSyncStatus).toHaveBeenCalledWith('kpi_monthly', 'completed');

        // The persisted receipt now points at this month's send
        monthlyReceipt = { last_sync: '2026-09-01T03:00:00.000Z' };
        vi.setSystemTime(new Date('2026-09-20T03:00:00Z'));
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledTimes(1);
    });

    it('fires every scheduled timeframe in one rollover tick', async () => {
        process.env.KPI_SCHEDULE = 'daily,weekly,monthly,quarterly,yearly';
        // Oct 1: all five periods completed at midnight
        vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
        boot();
        await runSchedulerTick();

        for (const tf of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
            expect(buildKpiReport).toHaveBeenCalledWith(tf);
            expect(updateSyncStatus).toHaveBeenCalledWith(`kpi_${tf}`, 'completed');
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
        expect(updateSyncStatus).toHaveBeenCalledWith('kpi_daily_failed', 'notified', expect.any(String));
        expect(getKpiSchedulerState().lastRuns.daily.ok).toBe(false);
    });

    it('a delivery failure notices once per period and never touches the success receipt', async () => {
        sendToDiscord.mockRejectedValue(new Error('Discord rejected the webhook. Check the URL is correct and still active.'));
        boot();
        await runSchedulerTick();

        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(1);
        expect(updateSyncStatus).toHaveBeenCalledWith('kpi_daily_failed', 'notified', expect.stringContaining('rejected'));
        // The success receipt was NOT recorded — the report stays due and is retried
        expect(updateSyncStatus).not.toHaveBeenCalledWith('kpi_daily', 'completed');
    });

    it('retries a failed report on later ticks without re-noticing in the same period', async () => {
        sendToDiscord.mockRejectedValue(new Error('down'));
        boot();
        await runSchedulerTick();   // first attempt: notice sent

        // The failure receipt now points at this period
        getSyncStatus.mockImplementation(async type => (
            type === 'kpi_daily_failed' ? { last_sync: '2026-09-05T03:00:00.000Z' } : null
        ));

        vi.setSystemTime(new Date('2026-09-05T03:10:00Z'));   // next tick, same period
        await runSchedulerTick();

        expect(sendSchedulerFailureNotice).toHaveBeenCalledTimes(1);  // still once
        expect(updateSyncStatus).toHaveBeenCalledWith('kpi_daily_failed', 'notified', expect.any(String));
        expect(sendToDiscord).toHaveBeenCalledTimes(2);               // but the send is retried
    });

    it('starts idempotently — a second start does not double the schedule', async () => {
        boot();
        const second = startKpiScheduler({ runImmediately: false });

        expect(second.configured).toBe(true);
        await runSchedulerTick();
        expect(buildKpiReport).toHaveBeenCalledTimes(1);  // one tick = one attempt
    });
});

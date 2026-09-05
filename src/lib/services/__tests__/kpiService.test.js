import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../db/database.js', () => ({
    getSnapshotsInRange: vi.fn(),
    getRevenueForDateRange: vi.fn(),
    getDailyRevenueUSDInRange: vi.fn(),
    getOldestTransactionDate: vi.fn(),
    getRevenueFromAddressesForDateRange: vi.fn()
}));
vi.mock('../carouselService.js', () => ({
    getCachedExpiringApps: vi.fn()
}));

import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate,
    getRevenueFromAddressesForDateRange
} from '../../db/database.js';
import { getCachedExpiringApps } from '../carouselService.js';
import { buildKpiReport, sendToDiscord } from '../kpiService.js';

const NOW = new Date('2026-08-21T12:00:00Z');

function snapshotsFor(start, days, overrides = {}) {
    const base = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: days }, (_, i) => ({
        snapshot_date: new Date(base + i * 86400000).toISOString().split('T')[0],
        node_total: 6000, node_cumulus: 2800, node_nimbus: 1500, node_stratus: 1700,
        used_cpu_cores: 8800, used_ram_gb: 17, used_storage_gb: 250,
        cpu_utilization_percent: 42.5, ram_utilization_percent: 38.1, storage_utilization_percent: 29.7,
        flux_price_usd: 0.4213,
        total_apps: 6400, dockerapps_count: 6200, gitapps_count: 170, gaming_apps_total: 320,
        ...overrides
    }));
}

beforeEach(() => {
    vi.clearAllMocks();
    getOldestTransactionDate.mockResolvedValue('2024-05-13');
    getSnapshotsInRange.mockImplementation(async (start) => snapshotsFor(start, 7));
    getRevenueForDateRange.mockResolvedValue(1000);
    getDailyRevenueUSDInRange.mockResolvedValue([{ daily_revenue_usd: 20 }, { daily_revenue_usd: 22 }]);
    getRevenueFromAddressesForDateRange.mockResolvedValue({ revenue: 250, payments: 5 });
    getCachedExpiringApps.mockResolvedValue({ stats: [{ name: 'app-a' }, { name: 'app-b' }], cached: true });
});

describe('buildKpiReport', () => {
    it('reads exactly the two completed periods', async () => {
        const report = await buildKpiReport('weekly', NOW);

        expect(report.current).toEqual({ start: '2026-08-10', end: '2026-08-16' });
        expect(report.comparison).toEqual({ start: '2026-08-03', end: '2026-08-09' });
        expect(getSnapshotsInRange).toHaveBeenCalledWith('2026-08-10', '2026-08-16');
        expect(getSnapshotsInRange).toHaveBeenCalledWith('2026-08-03', '2026-08-09');
    });

    it('sources revenue from the same queries the dashboard uses', async () => {
        const report = await buildKpiReport('weekly', NOW);

        // getRevenueForDateRange also backs /api/revenue/:period and the daily chart
        expect(getRevenueForDateRange).toHaveBeenCalledWith('2026-08-10', '2026-08-16');
        const flux = report.dataset.sections[0].metrics.find(m => m.key === 'flux');
        expect(flux.current).toBe(1000);

        const usd = report.dataset.sections[0].metrics.find(m => m.key === 'usd');
        expect(usd.current).toBe(42); // 20 + 22
    });

    it('splits self-funded and fiat revenue out as value and share of total', () => {
        return buildKpiReport('weekly', NOW).then(report => {
            const byKey = Object.fromEntries(report.dataset.sections[0].metrics.map(m => [m.key, m]));
            expect(byKey.selfFunded.current).toBe(250);
            expect(byKey.fiat.current).toBe(250);
            // 250 of 1000 total FLUX
            expect(byKey.selfFundedShare.current).toBe(25);
            expect(byKey.fiatShare.current).toBe(25);
        });
    });

    it('queries the team and fiat address lists separately', async () => {
        await buildKpiReport('weekly', NOW);
        const addressArgs = getRevenueFromAddressesForDateRange.mock.calls.map(c => c[2]);
        expect(addressArgs.some(a => a.includes('t1gjUUxBpBeVC1sWwAFrtSsVCbSaFdZx8UY'))).toBe(true);
        expect(addressArgs.some(a => a.includes('t1XktDZ9Z1QiefMYE5nMFohe8VG2c2BD5A5'))).toBe(true);
    });

    it('labels both periods for the report heading', async () => {
        const report = await buildKpiReport('monthly', NOW);
        expect(report.currentLabel).toBe('Jul 2026');
        expect(report.comparisonLabel).toBe('Jun 2026');
    });

    it('marks the report empty when nothing can be computed', async () => {
        getSnapshotsInRange.mockResolvedValue([]);
        getOldestTransactionDate.mockResolvedValue('2026-01-01'); // after the compared years

        const report = await buildKpiReport('yearly', NOW);
        expect(report.dataset.empty).toBe(true);
    });
});

describe('buildKpiReport — daily', () => {
    it('compares yesterday against the day before it, never today', async () => {
        const report = await buildKpiReport('daily', NOW);

        expect(report.timeframe).toBe('daily');
        expect(report.current).toEqual({ start: '2026-08-20', end: '2026-08-20' });
        expect(report.comparison).toEqual({ start: '2026-08-19', end: '2026-08-19' });
        expect(report.currentLabel).toBe('Aug 20, 2026');
        expect(report.comparisonLabel).toBe('Aug 19, 2026');
        expect(getSnapshotsInRange).toHaveBeenCalledWith('2026-08-20', '2026-08-20');
        expect(getSnapshotsInRange).toHaveBeenCalledWith('2026-08-19', '2026-08-19');
    });

    it('carries the live expiring-apps count as a point-in-time section', async () => {
        const report = await buildKpiReport('daily', NOW);

        const section = report.dataset.sections.find(s => s.key === 'expiring');
        expect(section).toBeDefined();
        expect(section.metrics[0].available).toBe(true);
        expect(section.metrics[0].current).toBe(2);
        expect(section.metrics[0].comparison).toBeNull();
        expect(section.metrics[0].change.note).toBe('Point-in-time');
    });

    it('does not include the expiring section for other timeframes', async () => {
        const report = await buildKpiReport('weekly', NOW);
        expect(report.dataset.sections.map(s => s.key)).not.toContain('expiring');
    });

    it('an expiring-apps fetch failure leaves the metric unavailable, not zero', async () => {
        getCachedExpiringApps.mockResolvedValue({ stats: [], cached: false });

        const report = await buildKpiReport('daily', NOW);
        const metric = report.dataset.sections.find(s => s.key === 'expiring').metrics[0];
        expect(metric.available).toBe(false);
        expect(metric.current).toBeNull();
        // The rest of the report still computes
        expect(report.dataset.empty).toBe(false);
    });
});

describe('sendToDiscord', () => {
    const report = {
        timeframe: 'weekly',
        current: { start: '2026-08-10', end: '2026-08-16' },
        comparison: { start: '2026-08-03', end: '2026-08-09' },
        generatedAt: '2026-08-21T00:00:00.000Z',
        dataset: { sections: [], availableMetrics: 0, totalMetrics: 0, empty: false }
    };

    const VALID = 'https://discord.com/api/webhooks/123456789/token';

    it('posts the embed to the webhook', async () => {
        axios.post.mockResolvedValue({ status: 204 });

        await sendToDiscord(VALID, report);

        expect(axios.post).toHaveBeenCalledWith(
            VALID,
            expect.objectContaining({ embeds: expect.any(Array) }),
            expect.objectContaining({ maxRedirects: 0 })
        );
    });

    it('refuses a non-Discord URL without making any request', async () => {
        await expect(sendToDiscord('https://evil.com/api/webhooks/1/a', report))
            .rejects.toThrow('Not a valid Discord webhook URL');
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('blocks redirects, which could otherwise leave the allowlisted host', async () => {
        axios.post.mockResolvedValue({ status: 204 });
        await sendToDiscord(VALID, report);
        expect(axios.post.mock.calls[0][2].maxRedirects).toBe(0);
    });

    it('turns Discord failures into messages a user can act on', async () => {
        const cases = [
            [404, /no longer exists/],
            [401, /Check the URL/],
            [403, /Check the URL/],
            [429, /rate-limiting/],
            [400, /rejected the report/]
        ];

        for (const [status, pattern] of cases) {
            axios.post.mockRejectedValueOnce({ response: { status } });
            await expect(sendToDiscord(VALID, report), `status ${status}`).rejects.toThrow(pattern);
        }
    });

    it('reports a timeout plainly', async () => {
        axios.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
        await expect(sendToDiscord(VALID, report)).rejects.toThrow(/did not respond in time/);
    });

    it('does not leak internal errors to the user', async () => {
        axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.5:443'));
        await expect(sendToDiscord(VALID, report)).rejects.toThrow('Could not deliver the report to Discord.');
    });
});

/**
 * A KPI report must never present a failed query as a real reading.
 *
 * These queries used to swallow their errors and return 0 / []. Because revenue coverage is
 * judged only on whether the period predates our transaction history, a database failure came
 * back "covered" with a value of zero and rendered as a genuine collapse -- "Flux 0.00,
 * -12,400.00, -100.0%" -- which was then posted to Discord as fact. The adapters now throw,
 * buildKpiReport rejects, and the endpoint returns an error instead of a lie.
 */
describe('a failed query is refused, not reported as zero', () => {
    it('propagates a FLUX revenue failure instead of reporting 0.00', async () => {
        getRevenueForDateRange.mockRejectedValue(new Error('getRevenueForDateRange failed: timeout'));
        await expect(buildKpiReport('weekly', NOW)).rejects.toThrow(/getRevenueForDateRange failed/);
    });

    it('propagates a USD revenue failure', async () => {
        getDailyRevenueUSDInRange.mockRejectedValue(new Error('getDailyRevenueUSDInRange failed: timeout'));
        await expect(buildKpiReport('weekly', NOW)).rejects.toThrow(/getDailyRevenueUSDInRange failed/);
    });

    it('propagates a self-funded / fiat failure rather than reporting a 0% share', async () => {
        // The most quietly wrong case: a zero here also zeroes the share column, so the report
        // would claim the Flux team funded 0% of a period it may have funded most of.
        getRevenueFromAddressesForDateRange.mockRejectedValue(
            new Error('getRevenueFromAddressesForDateRange failed: timeout')
        );
        await expect(buildKpiReport('weekly', NOW)).rejects.toThrow(/getRevenueFromAddressesForDateRange failed/);
    });

    it('propagates a snapshot failure rather than blaming missing days', async () => {
        // Returning [] was less dangerous but still misleading: every node, resource and app
        // metric would read "Insufficient data (7 days missing)" when the days were present
        // and it was the query that failed.
        getSnapshotsInRange.mockRejectedValue(new Error('getSnapshotsInRange failed: timeout'));
        await expect(buildKpiReport('weekly', NOW)).rejects.toThrow(/getSnapshotsInRange failed/);
    });

    it('still reports a genuinely zero-revenue period as real data', async () => {
        // Only a *failure* may refuse the report — a period that truly earned nothing is valid
        getRevenueForDateRange.mockResolvedValue(0);
        getDailyRevenueUSDInRange.mockResolvedValue([]);
        getRevenueFromAddressesForDateRange.mockResolvedValue({ revenue: 0, payments: 0 });

        const report = await buildKpiReport('weekly', NOW);
        const flux = report.dataset.sections[0].metrics.find(m => m.key === 'flux');

        expect(flux.available).toBe(true);
        expect(flux.current).toBe(0);
        expect(report.dataset.empty).toBe(false);
    });
});

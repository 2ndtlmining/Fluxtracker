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
    getFluxCloudSnapshot: vi.fn()
}));

import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate,
    getRevenueFromAddressesForDateRange
} from '../../db/database.js';
import { getFluxCloudSnapshot } from '../carouselService.js';
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
    getFluxCloudSnapshot.mockResolvedValue({
        appsDeployedToday: { cached: true, apps: [{ name: 'app-a', repo: 'runonflux/app-a:latest', instances: 2, cpu: 1, ram: 1024, hdd: 10 }] },
        appsExpiring24h: { cached: true, apps: [{ name: 'app-b', repo: 'runonflux/app-b:latest', instances: 1, cpu: 0.5, ram: 512, hdd: 5 }] }
    });
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

    it('carries the live Flux Cloud counts as a point-in-time section', async () => {
        const report = await buildKpiReport('daily', NOW);

        const section = report.dataset.sections.find(s => s.key === 'fluxCloud');
        expect(section).toBeDefined();
        const deployed = section.metrics.find(m => m.key === 'appsDeployed');
        const expiring = section.metrics.find(m => m.key === 'appsExpiring24h');
        expect(deployed.available).toBe(true);
        expect(deployed.current).toBe(1);   // the deduped length of the deployments list
        expect(deployed.comparison).toBeNull();
        expect(expiring.available).toBe(true);
        expect(expiring.current).toBe(1);
    });

    it('attaches the per-app Flux Cloud detail for the activity message', async () => {
        const report = await buildKpiReport('daily', NOW);

        expect(report.fluxCloud).toBeDefined();
        expect(report.fluxCloud.deployedToday.apps[0].name).toBe('app-a');
        expect(report.fluxCloud.deployedToday.apps[0].repo).toBe('runonflux/app-a:latest');
        expect(report.fluxCloud.expiring24h.apps[0].name).toBe('app-b');
    });

    it('lists one row per app in the activity detail, matching the report counts', async () => {
        // A re-deployment leaves the old spec in the registry next to the new one: the
        // same app must appear once, keeping the newest registration (deployments) and
        // the most urgent expiry (expiring).
        getFluxCloudSnapshot.mockResolvedValue({
            appsDeployedToday: { cached: true, apps: [
                { name: 'redeployed', repo: 'runonflux/old:latest', instances: 1, cpu: 1, ram: 1024, hdd: 10, blockAge: 2800 },
                { name: 'redeployed', repo: 'runonflux/new:latest', instances: 2, cpu: 2, ram: 2048, hdd: 20, blockAge: 100 },
                { name: 'solo', repo: 'runonflux/solo:latest', instances: 1, cpu: 1, ram: 512, hdd: 5, blockAge: 50 }
            ] },
            appsExpiring24h: { cached: true, apps: [
                { name: 'dup', repo: 'runonflux/old:latest', instances: 1, cpu: 1, ram: 1024, hdd: 10, blocksUntilExpiry: 500 },
                { name: 'dup', repo: 'runonflux/new:latest', instances: 1, cpu: 1, ram: 1024, hdd: 10, blocksUntilExpiry: 100 }
            ] }
        });

        const report = await buildKpiReport('daily', NOW);

        const deployed = report.fluxCloud.deployedToday.apps;
        expect(deployed.map(a => a.name)).toEqual(['redeployed', 'solo']);
        expect(deployed[0].repo).toBe('runonflux/new:latest'); // newest registration wins

        const expiring = report.fluxCloud.expiring24h.apps;
        expect(expiring.map(a => a.name)).toEqual(['dup']);
        expect(expiring[0].repo).toBe('runonflux/new:latest'); // most urgent expiry wins

        // The main report's instant counts match the activity table totals exactly
        const section = report.dataset.sections.find(s => s.key === 'fluxCloud');
        expect(section.metrics.find(m => m.key === 'appsDeployed').current).toBe(2);
        expect(section.metrics.find(m => m.key === 'appsExpiring24h').current).toBe(1);
    });

    it('a Flux Cloud read failure renders the section as unavailable, not missing or zero', async () => {
        getFluxCloudSnapshot.mockRejectedValue(new Error('down'));

        const report = await buildKpiReport('daily', NOW);
        const section = report.dataset.sections.find(s => s.key === 'fluxCloud');
        expect(section).toBeDefined();
        expect(section.metrics.every(m => !m.available)).toBe(true);
        // The rest of the report still computes
        expect(report.dataset.empty).toBe(false);
        // Nothing to detail in the activity message
        expect(report.fluxCloud).toBeNull();
    });

    it('does not include the Flux Cloud section for other timeframes', async () => {
        const report = await buildKpiReport('weekly', NOW);
        expect(report.dataset.sections.map(s => s.key)).not.toContain('fluxCloud');
        expect(report.fluxCloud).toBeNull();
    });
});

describe('sendToDiscord — Flux Cloud Activity (daily second message)', () => {
    const VALID = 'https://discord.com/api/webhooks/123456789/token';

    function dailyReport() {
        return {
            timeframe: 'daily',
            current: { start: '2026-09-04', end: '2026-09-04' },
            comparison: { start: '2026-09-03', end: '2026-09-03' },
            currentLabel: 'Sep 4, 2026',
            comparisonLabel: 'Sep 3, 2026',
            dataset: { sections: [], availableMetrics: 0, totalMetrics: 0, empty: false },
            fluxCloud: {
                appsDeployed: 7149,
                deployedToday: { cached: true, apps: [{ name: 'app-a', repo: 'runonflux/app-a:latest', instances: 2, cpu: 1, ram: 1024, hdd: 10 }] },
                expiring24h: { cached: true, apps: [] }
            },
            generatedAt: '2026-09-05T00:00:00.000Z'
        };
    }

    it('sends both messages to the same webhook', async () => {
        axios.post.mockResolvedValue({ status: 204 });

        const result = await sendToDiscord(VALID, dailyReport());

        expect(axios.post).toHaveBeenCalledTimes(2);
        expect(axios.post.mock.calls[0][1].embeds[0].title).toBe('FluxTracker KPI Report - Daily');
        expect(axios.post.mock.calls[1][1].embeds[0].title).toBe('FluxTracker Flux Cloud Activity');
        expect(result).toEqual({ delivered: true, activityDelivered: true });
    });

    it('a failed activity message does not fail the delivered main report', async () => {
        axios.post.mockResolvedValueOnce({ status: 204 }).mockRejectedValueOnce({ response: { status: 400 } });

        const result = await sendToDiscord(VALID, dailyReport());

        expect(result.delivered).toBe(true);
        expect(result.activityDelivered).toBe(false);
        expect(result.activityError).toMatch(/rejected the report payload/);
    });

    it('non-daily reports send only the main message', async () => {
        axios.post.mockResolvedValue({ status: 204 });

        const weekly = {
            timeframe: 'weekly',
            current: { start: '2026-08-10', end: '2026-08-16' },
            comparison: { start: '2026-08-03', end: '2026-08-09' },
            dataset: { sections: [], availableMetrics: 0, totalMetrics: 0, empty: false },
            fluxCloud: null,
            generatedAt: '2026-08-21T00:00:00.000Z'
        };
        const result = await sendToDiscord(VALID, weekly);

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ delivered: true });
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('../../db/database.js', () => ({
    getSnapshotsInRange: vi.fn(),
    getRevenueForDateRange: vi.fn(),
    getDailyRevenueUSDInRange: vi.fn(),
    getOldestTransactionDate: vi.fn()
}));

import axios from 'axios';
import {
    getSnapshotsInRange,
    getRevenueForDateRange,
    getDailyRevenueUSDInRange,
    getOldestTransactionDate
} from '../../db/database.js';
import { buildKpiReport, sendToDiscord } from '../kpiService.js';

const NOW = new Date('2026-08-21T12:00:00Z');

function snapshotsFor(start, days, overrides = {}) {
    const base = Date.parse(`${start}T00:00:00Z`);
    return Array.from({ length: days }, (_, i) => ({
        snapshot_date: new Date(base + i * 86400000).toISOString().split('T')[0],
        node_total: 6000, node_cumulus: 2800, node_nimbus: 1500, node_stratus: 1700,
        used_cpu_cores: 8800, used_ram_gb: 17, used_storage_gb: 250,
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

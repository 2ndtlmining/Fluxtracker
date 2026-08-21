import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Service cycle orchestration (issue #51).
 *
 * The previous version awaited all six services sequentially inside one try block, so the
 * first throw silently skipped every service after it for the whole cycle — and the outer
 * catch swallowed it, leaving the scheduler reporting success.
 */

vi.mock('../nodeService.js', () => ({ fetchNodeStats: vi.fn() }));
vi.mock('../cloudService.js', () => ({ fetchCloudStats: vi.fn() }));
vi.mock('../gamingService.js', () => ({ fetchGamingStats: vi.fn() }));
vi.mock('../cryptoService.js', () => ({ fetchCryptoStats: vi.fn() }));
vi.mock('../wordpressService.js', () => ({ fetchWordPressStats: vi.fn() }));
vi.mock('../revenueService.js', () => ({ fetchRevenueStats: vi.fn() }));
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: vi.fn(),
    toRepoCounts: vi.fn()
}));
vi.mock('../../db/database.js', () => ({
    getCurrentMetrics: vi.fn(),
    createRepoSnapshots: vi.fn()
}));

import { fetchNodeStats } from '../nodeService.js';
import { fetchCloudStats } from '../cloudService.js';
import { fetchGamingStats } from '../gamingService.js';
import { fetchCryptoStats } from '../cryptoService.js';
import { fetchWordPressStats } from '../wordpressService.js';
import { fetchRevenueStats } from '../revenueService.js';
import { getRunningApps, toRepoCounts } from '../runningAppsProvider.js';
import { getCurrentMetrics, createRepoSnapshots } from '../../db/database.js';
import { testAllServices } from '../test-allServices.js';

/** 15 images clears the MIN_REPO_KEYS partial-data guard. */
function repoCounts(n) {
    return Object.fromEntries(Array.from({ length: n }, (_, i) => [`img/${i}:latest`, i + 1]));
}

beforeEach(() => {
    vi.clearAllMocks();

    fetchNodeStats.mockResolvedValue({});
    fetchCloudStats.mockResolvedValue({});
    fetchGamingStats.mockResolvedValue({});
    fetchCryptoStats.mockResolvedValue({});
    fetchWordPressStats.mockResolvedValue({});
    fetchRevenueStats.mockResolvedValue({});
    getRunningApps.mockResolvedValue({ imageCounts: new Map() });
    toRepoCounts.mockReturnValue(repoCounts(15));
    createRepoSnapshots.mockResolvedValue(15);
    getCurrentMetrics.mockResolvedValue({});
});

describe('testAllServices', () => {
    it('reports every service when all succeed', async () => {
        const result = await testAllServices();

        expect(result.allSucceeded).toBe(true);
        expect(result.failed).toEqual([]);
        expect(result.succeeded).toEqual([
            'nodes', 'cloud', 'gaming', 'crypto', 'wordpress', 'revenue', 'repoSnapshot'
        ]);
    });

    it('runs every remaining service when the first one throws', async () => {
        fetchNodeStats.mockRejectedValue(new Error('nodes API down'));

        const result = await testAllServices();

        // The whole point of #51: one failure must not cost the cycle
        expect(fetchCloudStats).toHaveBeenCalled();
        expect(fetchGamingStats).toHaveBeenCalled();
        expect(fetchCryptoStats).toHaveBeenCalled();
        expect(fetchWordPressStats).toHaveBeenCalled();
        expect(fetchRevenueStats).toHaveBeenCalled();

        expect(result.allSucceeded).toBe(false);
        expect(result.failed).toEqual([{ name: 'nodes', error: 'nodes API down' }]);
        expect(result.succeeded).not.toContain('nodes');
    });

    it('names every failure when several services fail', async () => {
        fetchGamingStats.mockRejectedValue(new Error('gaming boom'));
        fetchRevenueStats.mockRejectedValue(new Error('revenue boom'));

        const result = await testAllServices();

        expect(result.failed.map(f => f.name)).toEqual(['gaming', 'revenue']);
        expect(result.succeeded).toContain('cloud');
        expect(result.succeeded).toContain('repoSnapshot');
    });

    it('refreshes today\'s repo snapshot so category cards match the metric cards', async () => {
        await testAllServices();

        const today = new Date().toISOString().split('T')[0];
        expect(createRepoSnapshots).toHaveBeenCalledWith(today, repoCounts(15));
    });

    it('refuses to overwrite the snapshot from a suspiciously small payload', async () => {
        toRepoCounts.mockReturnValue(repoCounts(3));

        const result = await testAllServices();

        expect(createRepoSnapshots).not.toHaveBeenCalled();
        expect(result.failed.map(f => f.name)).toEqual(['repoSnapshot']);
        // The metric services still ran
        expect(result.succeeded).toContain('gaming');
    });

    it('runs services sequentially — concurrent writes would clobber current_metrics', async () => {
        const order = [];
        let active = 0;

        const track = (name) => vi.fn(async () => {
            active++;
            expect(active).toBe(1); // never more than one service in flight
            await Promise.resolve();
            order.push(name);
            active--;
        });

        fetchNodeStats.mockImplementation(track('nodes'));
        fetchCloudStats.mockImplementation(track('cloud'));
        fetchGamingStats.mockImplementation(track('gaming'));

        await testAllServices();

        expect(order.slice(0, 3)).toEqual(['nodes', 'cloud', 'gaming']);
    });
});

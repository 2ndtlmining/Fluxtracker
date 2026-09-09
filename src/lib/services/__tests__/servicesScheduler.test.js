import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * servicesScheduler's carousel cycle — issue #126's proactive-refresh fix.
 *
 * runCarouselUpdate() used to only call fetchCarouselData() (benchmarks). The
 * deployed/expiring apps caches (carouselService's getCachedDeployedApps()/
 * getCachedExpiringApps()) were never refreshed on a schedule, only on-demand by
 * whichever client request happened to land on a stale cache -- which is what made
 * the header's client-side poll intermittently race a ~15s upstream refetch. This
 * cycle now also calls fetchLatestDeployedApps()/fetchExpiringApps() directly, each
 * independently try/caught so one failing doesn't block the other or the benchmark
 * fetch.
 */

vi.mock('../carouselService.js', () => ({
    fetchCarouselData: vi.fn(),
    fetchLatestDeployedApps: vi.fn(),
    fetchExpiringApps: vi.fn()
}));
vi.mock('../decentralizationService.js', () => ({
    runDecentralizationCycle: vi.fn()
}));
vi.mock('../test-allServices.js', () => ({
    testAllServices: vi.fn()
}));

import { runCarouselUpdate } from '../servicesScheduler.js';
import { fetchCarouselData, fetchLatestDeployedApps, fetchExpiringApps } from '../carouselService.js';

beforeEach(() => {
    vi.clearAllMocks();
    fetchCarouselData.mockResolvedValue([]);
    fetchLatestDeployedApps.mockResolvedValue([]);
    fetchExpiringApps.mockResolvedValue([]);
});

describe('runCarouselUpdate', () => {
    it('proactively refreshes both the deployed and expiring apps caches', async () => {
        await runCarouselUpdate();

        expect(fetchLatestDeployedApps).toHaveBeenCalledTimes(1);
        expect(fetchExpiringApps).toHaveBeenCalledTimes(1);
    });

    it('still refreshes expiring apps and completes when the deployed-apps refresh fails', async () => {
        fetchLatestDeployedApps.mockRejectedValue(new Error('upstream down'));

        await expect(runCarouselUpdate()).resolves.toBeUndefined();

        expect(fetchExpiringApps).toHaveBeenCalledTimes(1);
        expect(fetchCarouselData).toHaveBeenCalledTimes(1);
    });

    it('still refreshes deployed apps when the expiring-apps refresh fails', async () => {
        fetchExpiringApps.mockRejectedValue(new Error('upstream down'));

        await expect(runCarouselUpdate()).resolves.toBeUndefined();

        expect(fetchLatestDeployedApps).toHaveBeenCalledTimes(1);
    });

    it('does not let a deployed/expiring failure prevent the main benchmark fetch', async () => {
        fetchLatestDeployedApps.mockRejectedValue(new Error('upstream down'));
        fetchExpiringApps.mockRejectedValue(new Error('upstream down'));

        await runCarouselUpdate();

        expect(fetchCarouselData).toHaveBeenCalledTimes(1);
    });
});

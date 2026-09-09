import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================
// Mock all imported modules BEFORE importing snapshotManager
// ============================================

vi.mock('../database.js', () => ({
    createDailySnapshot: vi.fn(),
    createRepoSnapshots: vi.fn(() => 50),
    getRepoSnapshotCountByDate: vi.fn(() => 0),
    getCurrentMetrics: vi.fn(),
    getSnapshotByDate: vi.fn(),
    getRevenueForDateRange: vi.fn(() => 123.45),
    createDecentralizationSnapshots: vi.fn(),
}));

vi.mock('../../services/decentralizationService.js', () => ({
    getDecentralizationStats: vi.fn(),
    getFullDatacenterBreakdown: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../services/cloudService.js', () => ({
    getLatestRepoCounts: vi.fn(() => null),
}));

vi.mock('../../services/carouselService.js', () => ({
    getFluxCloudActivity: vi.fn(),
}));

vi.mock('../circuitBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
}));

vi.mock('../../services/backupService.js', () => ({
    isBackupEnabled: vi.fn(() => false),
    performBackup: vi.fn(() => Promise.resolve({ success: true })),
}));

// ============================================
// Import the module under test + mocked deps
// ============================================

import {
    getSnapshotState,
    getSnapshotSystemStatus,
    takeManualSnapshot,
    takeRepoSnapshot,
} from '../snapshotManager.js';

import {
    createDailySnapshot,
    createRepoSnapshots,
    getCurrentMetrics,
    getSnapshotByDate,
    getRevenueForDateRange,
    createDecentralizationSnapshots,
} from '../database.js';

import { getLatestRepoCounts } from '../../services/cloudService.js';
import { getDecentralizationStats, getFullDatacenterBreakdown } from '../../services/decentralizationService.js';
import { getFluxCloudActivity } from '../../services/carouselService.js';

// ============================================
// Helpers
// ============================================

function makeValidMetrics(overrides = {}) {
    return {
        last_update: Date.now(),
        node_total: 100,
        total_apps: 50,
        total_cpu_cores: 1000,
        used_cpu_cores: 400,
        cpu_utilization_percent: 40,
        total_ram_gb: 500,
        used_ram_gb: 200,
        ram_utilization_percent: 40,
        total_storage_gb: 2000,
        used_storage_gb: 800,
        storage_utilization_percent: 40,
        flux_price_usd: 0.5,
        watchtower_count: 10,
        gitapps_count: 20,
        dockerapps_count: 30,
        gitapps_percent: 40,
        dockerapps_percent: 60,
        gaming_apps_total: 0,
        gaming_palworld: 0,
        gaming_enshrouded: 0,
        gaming_minecraft: 0,
        gaming_valheim: 0,
        gaming_satisfactory: 0,
        crypto_presearch: 0,
        crypto_streamr: 0,
        crypto_ravencoin: 0,
        crypto_kadena: 0,
        crypto_alephium: 0,
        crypto_bittensor: 0,
        crypto_timpi_collector: 0,
        crypto_timpi_geocore: 0,
        crypto_kaspa: 0,
        crypto_nodes_total: 0,
        wordpress_count: 0,
        node_cumulus: 40,
        node_nimbus: 30,
        node_stratus: 30,
        ...overrides,
    };
}

function makeRepoCounts(count = 15) {
    const obj = {};
    for (let i = 0; i < count; i++) {
        obj[`repo/image-${i}`] = Math.floor(Math.random() * 100) + 1;
    }
    return obj;
}

// ============================================
// Tests
// ============================================

describe('snapshotManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Set time well past the grace period (10:00 UTC)
        vi.setSystemTime(new Date('2026-03-19T10:00:00.000Z'));
        vi.resetAllMocks();

        // Re-apply defaults after resetAllMocks
        getSnapshotByDate.mockResolvedValue(null);
        getCurrentMetrics.mockResolvedValue(null);
        getRevenueForDateRange.mockResolvedValue(123.45);
        createRepoSnapshots.mockResolvedValue(50);
        getLatestRepoCounts.mockReturnValue(null);
        getDecentralizationStats.mockResolvedValue({ datacenterCount: 40, classifiedCount: 100, datacenterPercent: 40 });
        getFullDatacenterBreakdown.mockResolvedValue([]);
        getFluxCloudActivity.mockResolvedValue({
            deployedToday: { cached: true, apps: [{ name: 'app-a' }, { name: 'app-b' }] },
            expiring24h: { cached: true, apps: [{ name: 'app-c' }] },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ------------------------------------------
    // 1. getSnapshotState returns expected shape
    // ------------------------------------------
    describe('getSnapshotState', () => {
        it('returns an object with the expected keys', () => {
            const state = getSnapshotState();
            expect(state).toHaveProperty('isRunning');
            expect(state).toHaveProperty('lastCheck');
            expect(state).toHaveProperty('lastSuccess');
            expect(state).toHaveProperty('consecutiveFailures');
            expect(state).toHaveProperty('repoRetryPending');
            // Internal timer handle should NOT be exposed
            expect(state).not.toHaveProperty('repoRetryId');
        });
    });

    // ------------------------------------------
    // 2. getSnapshotSystemStatus
    // ------------------------------------------
    describe('getSnapshotSystemStatus', () => {
        it('returns config, state, and todaySnapshotExists', async () => {
            getSnapshotByDate.mockResolvedValue(null);

            const status = await getSnapshotSystemStatus();
            expect(status).toHaveProperty('config');
            expect(status).toHaveProperty('state');
            expect(status).toHaveProperty('todaySnapshotExists', false);
            expect(status).toHaveProperty('isHealthy');
        });

        it('reports todaySnapshotExists=true when snapshot exists', async () => {
            getSnapshotByDate.mockResolvedValue({ snapshot_date: '2026-03-19' });

            const status = await getSnapshotSystemStatus();
            expect(status.todaySnapshotExists).toBe(true);
            expect(status.todaySnapshotDate).toBe('2026-03-19');
        });
    });

    // ------------------------------------------
    // 3. takeManualSnapshot — snapshot already exists
    // ------------------------------------------
    describe('takeManualSnapshot', () => {
        it('returns skipped when snapshot already exists for today', async () => {
            getSnapshotByDate.mockResolvedValue({ snapshot_date: '2026-03-19' });

            const result = await takeManualSnapshot();
            expect(result.success).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.reason).toMatch(/already exists/i);
        });

        // ------------------------------------------
        // 4. takeManualSnapshot — metrics not ready
        // ------------------------------------------
        it('returns skipped when metrics are not available', async () => {
            getSnapshotByDate.mockResolvedValue(null);
            getCurrentMetrics.mockResolvedValue(null);

            const result = await takeManualSnapshot();
            expect(result.success).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.reason).toMatch(/metrics/i);
        });

        // ------------------------------------------
        // 5. takeManualSnapshot — success
        // ------------------------------------------
        it('creates a snapshot when conditions are met', async () => {
            getSnapshotByDate.mockResolvedValue(null);
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getRevenueForDateRange.mockResolvedValue(123.45);
            getLatestRepoCounts.mockReturnValue(makeRepoCounts(15));

            const result = await takeManualSnapshot();
            expect(result.success).toBe(true);
            expect(result.snapshotDate).toBe('2026-03-19');
            expect(result.data).toBeDefined();
            expect(result.data.daily_revenue).toBe(123.45);
            expect(createDailySnapshot).toHaveBeenCalledTimes(1);
            expect(createRepoSnapshots).toHaveBeenCalledTimes(1);
        });

        // ------------------------------------------
        // 6. takeManualSnapshot — metrics too old
        // ------------------------------------------
        it('returns skipped when metrics are older than 24 hours', async () => {
            getSnapshotByDate.mockResolvedValue(null);

            const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
            getCurrentMetrics.mockResolvedValue(
                makeValidMetrics({ last_update: twentyFiveHoursAgo })
            );

            const result = await takeManualSnapshot();
            expect(result.success).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.reason).toMatch(/metrics/i);
        });

        // ------------------------------------------
        // Grace period test
        // ------------------------------------------
        it('returns skipped during the grace period after midnight', async () => {
            // Set time to 00:02 UTC — within the 5-minute grace period
            vi.setSystemTime(new Date('2026-03-19T00:02:00.000Z'));
            getSnapshotByDate.mockResolvedValue(null);
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());

            const result = await takeManualSnapshot();
            expect(result.success).toBe(false);
            expect(result.skipped).toBe(true);
            expect(result.reason).toMatch(/grace period/i);
        });

        it('does not create repo snapshots when repo counts have fewer than 10 keys', async () => {
            getSnapshotByDate.mockResolvedValue(null);
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getRevenueForDateRange.mockResolvedValue(50);
            getLatestRepoCounts.mockReturnValue(makeRepoCounts(5));

            const result = await takeManualSnapshot();
            expect(result.success).toBe(true);
            // Repo snapshots should NOT be created when < 10 images
            expect(createRepoSnapshots).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------
    // 7. takeRepoSnapshot — no data available
    // ------------------------------------------
    describe('takeRepoSnapshot', () => {
        it('returns failure when no repo count data is available', async () => {
            getLatestRepoCounts.mockReturnValue(null);

            const result = await takeRepoSnapshot();
            expect(result.success).toBe(false);
            expect(result.reason).toMatch(/no repo count data/i);
        });

        // ------------------------------------------
        // 8. takeRepoSnapshot — insufficient data
        // ------------------------------------------
        it('returns failure when repo counts have fewer than 10 keys', async () => {
            getLatestRepoCounts.mockReturnValue(makeRepoCounts(5));

            const result = await takeRepoSnapshot();
            expect(result.success).toBe(false);
            expect(result.reason).toMatch(/only 5 images/i);
        });

        // ------------------------------------------
        // 9. takeRepoSnapshot — success
        // ------------------------------------------
        it('creates repo snapshots when sufficient data is available', async () => {
            const repoCounts = makeRepoCounts(15);
            getLatestRepoCounts.mockReturnValue(repoCounts);
            createRepoSnapshots.mockResolvedValue(15);

            const result = await takeRepoSnapshot();
            expect(result.success).toBe(true);
            expect(result.snapshotDate).toBe('2026-03-19');
            expect(result.repoCount).toBe(15);
            expect(createRepoSnapshots).toHaveBeenCalledWith('2026-03-19', repoCounts);
        });
    });

    describe('decentralization snapshot collection', () => {
        it('writes the headline decentralization columns onto the daily snapshot', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getDecentralizationStats.mockResolvedValue({ datacenterCount: 45, classifiedCount: 100, datacenterPercent: 45 });
            getFullDatacenterBreakdown.mockResolvedValue([{ org: 'Hetzner', count: 45 }, { org: '(independent)', count: 55 }]);

            await takeManualSnapshot();

            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.decentralization_datacenter_count).toBe(45);
            expect(snapshotData.decentralization_independent_count).toBe(55);
            expect(snapshotData.decentralization_datacenter_percent).toBe(45);
        });

        it('writes null (not 0) for the headline columns when nothing is classified yet', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getDecentralizationStats.mockResolvedValue({ datacenterCount: 0, classifiedCount: 0, datacenterPercent: null });
            getFullDatacenterBreakdown.mockResolvedValue([]);

            await takeManualSnapshot();

            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.decentralization_datacenter_count).toBeNull();
            expect(snapshotData.decentralization_independent_count).toBeNull();
            expect(snapshotData.decentralization_datacenter_percent).toBeNull();
        });

        it('calls createDecentralizationSnapshots with the full breakdown for the snapshot date', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getDecentralizationStats.mockResolvedValue({ datacenterCount: 45, classifiedCount: 100, datacenterPercent: 45 });
            const breakdown = [{ org: 'Hetzner', count: 45 }, { org: '(independent)', count: 55 }];
            getFullDatacenterBreakdown.mockResolvedValue(breakdown);

            const result = await takeManualSnapshot();

            expect(createDecentralizationSnapshots).toHaveBeenCalledWith(result.snapshotDate, breakdown);
        });

        it('skips createDecentralizationSnapshots when the breakdown is empty, without failing the snapshot', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getDecentralizationStats.mockResolvedValue({ datacenterCount: 0, classifiedCount: 0, datacenterPercent: null });
            getFullDatacenterBreakdown.mockResolvedValue([]);

            const result = await takeManualSnapshot();

            expect(result.success).toBe(true);
            expect(createDecentralizationSnapshots).not.toHaveBeenCalled();
        });

        it('a decentralizationService failure does not block the daily_snapshots row from being written', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getDecentralizationStats.mockRejectedValue(new Error('decentralization cache unavailable'));
            getFullDatacenterBreakdown.mockResolvedValue([]);

            const result = await takeManualSnapshot();

            expect(result.success).toBe(true);
            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.decentralization_datacenter_percent).toBeNull();
        });
    });

    describe('Flux Cloud activity snapshot collection', () => {
        it('writes the deduped app counts onto the daily snapshot', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getFluxCloudActivity.mockResolvedValue({
                deployedToday: { cached: true, apps: [{ name: 'app-a' }, { name: 'app-b' }] },
                expiring24h: { cached: true, apps: [{ name: 'app-c' }] },
            });

            await takeManualSnapshot();

            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.apps_deployed_today).toBe(2);
            expect(snapshotData.apps_expiring_today).toBe(1);
        });

        it('writes null (not 0) when the on-demand fetch failed with nothing cached', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getFluxCloudActivity.mockResolvedValue({
                deployedToday: { cached: false, apps: [] },
                expiring24h: { cached: false, apps: [] },
            });

            await takeManualSnapshot();

            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.apps_deployed_today).toBeNull();
            expect(snapshotData.apps_expiring_today).toBeNull();
        });

        it('a getFluxCloudActivity failure does not block the daily_snapshots row from being written', async () => {
            getCurrentMetrics.mockResolvedValue(makeValidMetrics());
            getFluxCloudActivity.mockRejectedValue(new Error('Flux Cloud API unavailable'));

            const result = await takeManualSnapshot();

            expect(result.success).toBe(true);
            const [snapshotData] = createDailySnapshot.mock.calls[0];
            expect(snapshotData.apps_deployed_today).toBeNull();
            expect(snapshotData.apps_expiring_today).toBeNull();
        });
    });
});

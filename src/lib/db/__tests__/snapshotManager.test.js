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
}));

vi.mock('../../services/cloudService.js', () => ({
    getLatestRepoCounts: vi.fn(() => null),
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
} from '../database.js';

import { getLatestRepoCounts } from '../../services/cloudService.js';

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
});

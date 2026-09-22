import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * fetchCloudStats() is 265 lines with no direct coverage (issue #225). Two things in it are
 * worth pinning mechanically:
 *
 * 1. The unit conversions are deliberately ASYMMETRIC -- capacity comes from fluxbench in GB
 *    and is divided by 1000, while locked RAM comes from app specs in MB and is divided by
 *    1000000. The percentages stay right whichever way it is done, so a "tidy-up" that makes
 *    the two divisors match moves the absolute figures 1000x while the dashboard still looks
 *    plausible -- and those figures are written to current_metrics -> daily_snapshots, so the
 *    error is baked into history, the KPI averages and the R2 backup.
 * 2. Every failure path returns the PREVIOUS metrics rather than failing. That is the design,
 *    but it means a prolonged outage records yesterday's numbers as today's reading, so the
 *    `_cached: true` marker that lets callers tell the two apart has to keep working.
 */

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: (...args) => mockGetRunningApps(...args)
}));

const mockResilientFetch = vi.fn();
vi.mock('../resilientFetch.js', () => ({
    resilientFetch: (...args) => mockResilientFetch(...args)
}));

const mockUpdateCurrentMetrics = vi.fn();
const mockUpdateSyncStatus = vi.fn();
const mockGetCurrentMetrics = vi.fn();
vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: (...args) => mockUpdateCurrentMetrics(...args),
    updateSyncStatus: (...args) => mockUpdateSyncStatus(...args),
    getCurrentMetrics: (...args) => mockGetCurrentMetrics(...args)
}));

import { fetchCloudStats } from '../cloudService.js';
import { API_ENDPOINTS } from '../../config.js';

/**
 * Two benchmark nodes: 64,000 GB RAM, 4,000 GB SSD, 16 cores between them.
 * Locked by apps: 16,000,000 MB RAM, 2,000 GB SSD, 8 cores.
 * So the network is 64 TB RAM / 4 TB SSD, with 16 TB / 2 TB / 8 cores in use.
 */
const BENCHMARKS = [
    { benchmark: { bench: { ram: 32000, ssd: 2000, cores: 8 } } },
    { benchmark: { bench: { ram: 32000, ssd: 2000, cores: 8 } } }
];

const NETWORK_UTILS = [
    { apps: { resources: { appsRamLocked: 8000000, appsHddLocked: 1000, appsCpusLocked: 4 } } },
    { apps: { resources: { appsRamLocked: 8000000, appsHddLocked: 1000, appsCpusLocked: 4 } } }
];

/** Route each mocked fetch by endpoint, so swapping the two calls cannot pass unnoticed. */
function serve({ utils = NETWORK_UTILS, benchmarks = BENCHMARKS } = {}) {
    mockResilientFetch.mockImplementation(async (url) => {
        if (url === API_ENDPOINTS.API_FLUX_NETWORK_UTILISATION) return utils;
        if (url === API_ENDPOINTS.API_NODE_BENCHMARKS) return benchmarks;
        throw new Error('unexpected endpoint: ' + url);
    });
}

const CACHED_METRICS = {
    total_cpu_cores: 11, used_cpu_cores: 3, cpu_utilization_percent: 27.27,
    total_ram_gb: 22, used_ram_gb: 5, ram_utilization_percent: 22.73,
    total_storage_gb: 33, used_storage_gb: 7, storage_utilization_percent: 21.21,
    total_apps: 44, watchtower_count: 2,
    gitapps_count: 4, dockerapps_count: 40, gitapps_percent: 9.09, dockerapps_percent: 90.91
};

beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunningApps.mockResolvedValue({
        imageCounts: new Map([['presearch/node:latest', 100]]),
        totalInstances: 120,
        watchtowerCount: 20,
        unresolvedCount: 0
    });
    mockGetCurrentMetrics.mockResolvedValue(null);
    serve();
});

describe('fetchCloudStats unit conversions', () => {
    it('divides benchmark capacity by 1000 and locked RAM by 1000000 (not the same divisor)', async () => {
        const stats = await fetchCloudStats();

        expect(stats.total_ram_gb).toBe(64);   // 64,000 GB reported -> 64 TB
        expect(stats.used_ram_gb).toBe(16);    // 16,000,000 MB locked -> 16 TB
    });

    it('divides both SSD figures by 1000, unlike RAM', async () => {
        const stats = await fetchCloudStats();

        expect(stats.total_storage_gb).toBe(4);
        expect(stats.used_storage_gb).toBe(2);
    });

    it('leaves core counts unscaled', async () => {
        const stats = await fetchCloudStats();

        expect(stats.total_cpu_cores).toBe(16);
        expect(stats.used_cpu_cores).toBe(8);
    });

    it('derives each utilization percentage from the scaled pair', async () => {
        const stats = await fetchCloudStats();

        expect(stats.ram_utilization_percent).toBe(25);      // 16 / 64
        expect(stats.storage_utilization_percent).toBe(50);  // 2 / 4
        expect(stats.cpu_utilization_percent).toBe(50);      // 8 / 16
    });

    it('marks a freshly computed reading as not cached, and persists it', async () => {
        const stats = await fetchCloudStats();

        expect(stats._cached).toBe(false);
        expect(mockUpdateCurrentMetrics).toHaveBeenCalledWith(expect.objectContaining({
            total_ram_gb: 64, used_ram_gb: 16, total_cpu_cores: 16
        }));
        expect(mockUpdateSyncStatus).toHaveBeenCalledWith('cloud', 'completed', null, null);
    });

    it('carries the app counts through from fetchAppCount', async () => {
        const stats = await fetchCloudStats();

        expect(stats.total_apps).toBe(100);       // 120 instances - 20 watchtower
        expect(stats.watchtower_count).toBe(20);
    });
});

describe('fetchCloudStats payload shapes', () => {
    it('accepts a bare array from either endpoint', async () => {
        serve();

        const stats = await fetchCloudStats();

        expect(stats.total_ram_gb).toBe(64);
    });

    it('accepts a { data: [...] } envelope from either endpoint', async () => {
        serve({ utils: { data: NETWORK_UTILS }, benchmarks: { data: BENCHMARKS } });

        const stats = await fetchCloudStats();

        expect(stats.total_ram_gb).toBe(64);
        expect(stats.used_ram_gb).toBe(16);
    });

    it('reads a benchmark nested as benchmark.bench, benchmark, or bench alike', async () => {
        serve({
            benchmarks: [
                { benchmark: { bench: { ram: 32000, ssd: 2000, cores: 8 } } },
                { benchmark: { ram: 16000, ssd: 1000, cores: 4 } },
                { bench: { ram: 16000, ssd: 1000, cores: 4 } }
            ]
        });

        const stats = await fetchCloudStats();

        expect(stats.total_ram_gb).toBe(64);      // 32000 + 16000 + 16000
        expect(stats.total_cpu_cores).toBe(16);   // 8 + 4 + 4
    });

    it('falls back when the payload is an unrecognised shape rather than reporting zeros', async () => {
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        serve({ utils: { unexpected: 'shape' } });

        const stats = await fetchCloudStats();

        expect(stats._cached).toBe(true);
        expect(stats.total_ram_gb).toBe(22);
    });
});

describe('fetchCloudStats fallbacks', () => {
    /**
     * Both the exact reason AND the call count matter, because the outer catch is itself a
     * fallback that serves the same cached object. If a branch stops returning its cached
     * reading, the throw below it lands in that catch, which records a SECOND status —
     * "Error: <the branch's own message> - using cached". The returned value is identical
     * and even a substring match on the reason still passes, so the only thing that tells
     * "the branch handled it" from "the safety net caught it" is that exactly one status
     * was written, with exactly the branch's wording.
     */
    const expectCachedReading = (stats, reason) => {
        expect(stats._cached).toBe(true);
        expect(stats.total_ram_gb).toBe(CACHED_METRICS.total_ram_gb);
        expect(mockUpdateCurrentMetrics).not.toHaveBeenCalled();
        expect(mockUpdateSyncStatus).toHaveBeenCalledTimes(1);
        expect(mockUpdateSyncStatus).toHaveBeenCalledWith('cloud', 'failed', reason, null);
    };

    it('serves the previous metrics when the APIs are unreachable', async () => {
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        mockResilientFetch.mockRejectedValue(new Error('upstream down'));

        expectCachedReading(await fetchCloudStats(), 'API error - using cached data: upstream down');
    });

    it('serves the previous metrics when the APIs answer empty', async () => {
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        serve({ utils: [], benchmarks: [] });

        expectCachedReading(await fetchCloudStats(), 'API returned empty data - using cached');
    });

    it('serves the previous metrics when no node reports usable resources', async () => {
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        serve({ utils: [{ apps: {} }, { apps: { resources: { appsRamLocked: 'not a number' } } }] });

        expectCachedReading(await fetchCloudStats(), 'No valid resource data - using cached');
    });

    it('serves the previous metrics when the benchmark totals are unusable', async () => {
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        serve({ benchmarks: [{ benchmark: { bench: { ram: 0, ssd: 0, cores: 0 } } }] });

        expectCachedReading(await fetchCloudStats(), 'Invalid benchmark data - using cached');
    });

    it('serves the previous metrics when the RAM total is implausibly small', async () => {
        // 5,000 GB -> 5 TB, under the sanity floor: a plausible-looking number that is really
        // a partial answer from the benchmark API.
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        serve({ benchmarks: [{ benchmark: { bench: { ram: 5000, ssd: 2000, cores: 8 } } }] });

        expectCachedReading(await fetchCloudStats(), 'Suspicious RAM value: 5 GB - using cached');
    });

    it('throws when the APIs fail and there is no previous reading to fall back on', async () => {
        mockGetCurrentMetrics.mockResolvedValue(null);
        mockResilientFetch.mockRejectedValue(new Error('upstream down'));

        await expect(fetchCloudStats()).rejects.toThrow(/no cached data available/i);
        expect(mockUpdateCurrentMetrics).not.toHaveBeenCalled();
    });

    it('treats a partial cache row as no cache at all', async () => {
        // A row with a zero in it is a failed collection, not a reading -- serving it would
        // publish a 0 as though the network had no RAM.
        mockGetCurrentMetrics.mockResolvedValue({ ...CACHED_METRICS, total_ram_gb: 0 });
        mockResilientFetch.mockRejectedValue(new Error('upstream down'));

        await expect(fetchCloudStats()).rejects.toThrow(/no cached data available/i);
    });

    it('keeps fresh resource figures but reuses the last app counts when the census fails', async () => {
        // The two halves fail independently: fetchAppCount has a fallback of its own, so a
        // running-apps outage must not throw away resource numbers that were fetched fine.
        mockGetCurrentMetrics.mockResolvedValue(CACHED_METRICS);
        mockGetRunningApps.mockRejectedValue(new Error('running-apps unavailable'));

        const stats = await fetchCloudStats();

        expect(stats._cached).toBe(false);
        expect(stats.total_ram_gb).toBe(64);                 // fresh
        expect(stats.total_apps).toBe(CACHED_METRICS.total_apps);        // last known
        expect(stats.watchtower_count).toBe(CACHED_METRICS.watchtower_count);
    });

    it('records a zero app count when the census fails with no previous count to reuse', async () => {
        // Documents a real gap rather than endorsing it: the final zero-check covers cores,
        // RAM and storage but not total_apps, so a first-run census failure persists 0 apps
        // alongside valid resource figures. KPI treats a 0 column as missing, but the
        // dashboard renders it as a reading.
        mockGetCurrentMetrics.mockResolvedValue(null);

        mockGetRunningApps.mockRejectedValue(new Error('running-apps unavailable'));

        const stats = await fetchCloudStats();

        expect(stats.total_apps).toBe(0);
        expect(stats.total_ram_gb).toBe(64);
        expect(mockUpdateCurrentMetrics).toHaveBeenCalledWith(expect.objectContaining({ total_apps: 0 }));
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #249. The daily snapshot's decentralization columns came out null on any day whose
 * snapshot was taken by a freshly restarted process, and one null day disqualifies the KPI
 * decentralization metric for every window containing it (KPI requires 100% day coverage) --
 * which is why "% Datacenter" read "Insufficient data" in every timeframe on an instance
 * whose live card and chart were both fine.
 *
 * The candidate node-IP list lives in busiestNodeService's in-memory cache.
 * `getCachedNetworkNodeIps()` returns [] until that service's first successful fetch and
 * deliberately never triggers one. `runDecentralizationCycle()` knows this and calls
 * `getBusiestNode()` first; `loadClassificationContext()` -- the path the snapshot uses --
 * did not. Cold process -> empty candidate set -> nothing "relevant" -> classifiedCount 0 ->
 * null columns, silently, for the whole day.
 *
 * `startSnapshotChecker()` runs a check immediately on boot, so a deploy at any time of day
 * when today's snapshot is still missing hits exactly this.
 */

const mockGetAllNodeIpClassifications = vi.fn();
const mockGetCurrentMetrics = vi.fn();
const mockCreateDailySnapshot = vi.fn();
vi.mock('../database.js', () => ({
    createDailySnapshot: (...a) => mockCreateDailySnapshot(...a),
    createRepoSnapshots: vi.fn(() => 50),
    getRepoSnapshotCountByDate: vi.fn(() => 0),
    getCurrentMetrics: (...a) => mockGetCurrentMetrics(...a),
    getSnapshotByDate: vi.fn(),
    getRevenueForDateRange: vi.fn(() => 123.45),
    createDecentralizationSnapshots: vi.fn(),
    createDecentralizationCountrySnapshots: vi.fn(),
    createDecentralizationContinentSnapshots: vi.fn(),
    getAllNodeIpClassifications: (...a) => mockGetAllNodeIpClassifications(...a),
    upsertNodeIpClassifications: vi.fn()
}));

/**
 * Stands in for busiestNodeService the way the real one behaves: the IP list is empty until
 * a fetch lands, and reading it never triggers one.
 */
let warmed = false;
let warmFails = false;
const NODE_IPS = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'];
const mockGetBusiestNode = vi.fn(async () => {
    if (warmFails) throw new Error('stats.runonflux.io unreachable');
    warmed = true;
    return { ip: '1.1.1.1' };
});
vi.mock('../../services/busiestNodeService.js', () => ({
    getBusiestNode: (...a) => mockGetBusiestNode(...a),
    getCachedNetworkNodeIps: () => (warmed ? NODE_IPS : [])
}));

vi.mock('../../services/cloudService.js', () => ({ getLatestRepoCounts: vi.fn(() => null) }));
vi.mock('../../services/carouselService.js', () => ({ getFluxCloudActivity: vi.fn() }));
vi.mock('../../services/gamingService.js', () => ({ getLiveGameBreakdown: vi.fn(() => ({ games: [], total: 0 })) }));
vi.mock('../circuitBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
}));
vi.mock('../../services/backupService.js', () => ({
    isBackupEnabled: vi.fn(() => false),
    performBackup: vi.fn(() => Promise.resolve({ success: true }))
}));

import { takeManualSnapshot } from '../snapshotManager.js';
import {
    loadClassificationContext,
    getDecentralizationStats,
    clearDecentralizationStatsCache
} from '../../services/decentralizationService.js';

const CLASSIFICATIONS = [
    { ip: '1.1.1.1', org: 'Hetzner', isDatacenter: true, country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' },
    { ip: '2.2.2.2', org: 'Hetzner', isDatacenter: true, country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' },
    { ip: '3.3.3.3', org: 'Comcast', isDatacenter: false, country: 'United States', countryCode: 'US', continent: 'North America', continentCode: 'NA' },
    { ip: '4.4.4.4', org: 'Comcast', isDatacenter: false, country: 'United States', countryCode: 'US', continent: 'North America', continentCode: 'NA' }
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Midday UTC: takeSnapshot() refuses to run inside the after-midnight grace period.
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    // A cold process: nothing has fetched the node list yet.
    warmed = false;
    warmFails = false;
    clearDecentralizationStatsCache();
    mockGetAllNodeIpClassifications.mockResolvedValue(CLASSIFICATIONS);
    mockGetCurrentMetrics.mockResolvedValue({
        last_update: Date.now(),
        node_total: 12800,
        total_apps: 4200,
        total_cpu_cores: 30000,
        total_ram_gb: 64,
        total_storage_gb: 4
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('loadClassificationContext on a cold process', () => {
    it('warms the node list instead of reading an empty cache', async () => {
        const context = await loadClassificationContext();

        expect(mockGetBusiestNode).toHaveBeenCalled();
        expect(context.candidateIps).toEqual(NODE_IPS);
        expect(context.relevant).toHaveLength(4);
    });

    it('still returns a usable context when the warm-up fails', async () => {
        // An upstream outage must not throw here -- the snapshot's own try/catch would then
        // lose the whole decentralization section rather than just this input.
        warmFails = true;

        const context = await loadClassificationContext();

        expect(context.candidateIps).toEqual([]);
        expect(context.relevant).toEqual([]);
        expect(context.allClassifications).toHaveLength(4);
    });

    it('does not refetch the list once it is warm', async () => {
        await loadClassificationContext();
        await loadClassificationContext();

        // getBusiestNode is itself TTL-cached, so calling it twice is a no-op -- but the
        // context must not be doing its own extra work on top.
        expect(mockGetAllNodeIpClassifications).toHaveBeenCalledTimes(2);
    });
});

describe('getDecentralizationStats on a cold process', () => {
    it('counts the classified nodes rather than reporting nothing classified', async () => {
        const stats = await getDecentralizationStats();

        expect(stats.classifiedCount).toBe(4);
        expect(stats.datacenterCount).toBe(2);
        expect(stats.datacenterPercent).toBe(50);
    });
});

describe('the daily snapshot taken by a freshly restarted process', () => {
    it('writes real decentralization columns, not nulls', async () => {
        // The bug this file exists for: before the fix every one of these was null, and one
        // null day disqualifies the KPI metric for every window containing it.
        await takeManualSnapshot();

        expect(mockCreateDailySnapshot).toHaveBeenCalledTimes(1);
        const row = mockCreateDailySnapshot.mock.calls[0][0];

        expect(row.decentralization_datacenter_count).toBe(2);
        expect(row.decentralization_independent_count).toBe(2);
        expect(row.decentralization_datacenter_percent).toBe(50);
    });

    it('still writes nulls when the node list genuinely cannot be fetched', async () => {
        // Honest beats fabricated: with no candidate set there is no denominator, and a 0
        // would read as "no datacenters on the network".
        warmFails = true;

        await takeManualSnapshot();

        const row = mockCreateDailySnapshot.mock.calls[0][0];
        expect(row.decentralization_datacenter_count).toBeNull();
        expect(row.decentralization_datacenter_percent).toBeNull();
    });

    it('writes the headline row either way', async () => {
        warmFails = true;

        await takeManualSnapshot();

        expect(mockCreateDailySnapshot).toHaveBeenCalledTimes(1);
        expect(mockCreateDailySnapshot.mock.calls[0][0].node_total).toBe(12800);
    });
});

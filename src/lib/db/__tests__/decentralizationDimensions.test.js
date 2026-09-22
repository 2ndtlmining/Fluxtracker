import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #151. Two claims to hold onto:
 *
 * 1. One snapshot cycle reads node_ip_classification ONCE. It used to read the whole table up
 *    to four times -- once per breakdown plus once for the cold-start stats -- because each
 *    consumer fetched for itself.
 * 2. Country and continent are one implementation, not two copies, and a new dimension is one
 *    entry in the registry.
 */

const mockGetAllNodeIpClassifications = vi.fn();
const mockGetCurrentMetrics = vi.fn();
vi.mock('../database.js', () => ({
    createDailySnapshot: vi.fn(),
    createRepoSnapshots: vi.fn(() => 50),
    getRepoSnapshotCountByDate: vi.fn(() => 0),
    getCurrentMetrics: (...args) => mockGetCurrentMetrics(...args),
    getSnapshotByDate: vi.fn(),
    getRevenueForDateRange: vi.fn(() => 123.45),
    createDecentralizationSnapshots: vi.fn(),
    createDecentralizationCountrySnapshots: vi.fn(),
    createDecentralizationContinentSnapshots: vi.fn(),
    getAllNodeIpClassifications: (...args) => mockGetAllNodeIpClassifications(...args),
    upsertNodeIpClassifications: vi.fn()
}));

const mockGetCachedNetworkNodeIps = vi.fn();
vi.mock('../../services/busiestNodeService.js', () => ({
    getBusiestNode: vi.fn(),
    getCachedNetworkNodeIps: (...args) => mockGetCachedNetworkNodeIps(...args)
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

// The decentralization service is deliberately NOT mocked here: the point is to count what
// the real one asks the database for during one real snapshot cycle.
import { takeManualSnapshot } from '../snapshotManager.js';
import {
    loadClassificationContext,
    getFullDatacenterBreakdown,
    getFullCountryBreakdown,
    getFullContinentBreakdown,
    clearDecentralizationStatsCache
} from '../../services/decentralizationService.js';
import { BREAKDOWN_DIMENSIONS, resolveDimension } from '../../decentralizationDimensions.js';

const CLASSIFICATIONS = [
    { ip: '1.1.1.1', org: 'Hetzner', isDatacenter: true, country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' },
    { ip: '2.2.2.2', org: 'Hetzner', isDatacenter: true, country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' },
    { ip: '3.3.3.3', org: 'OVH', isDatacenter: true, country: 'France', countryCode: 'FR', continent: 'Europe', continentCode: 'EU' },
    { ip: '4.4.4.4', org: 'Comcast', isDatacenter: false, country: 'United States', countryCode: 'US', continent: 'North America', continentCode: 'NA' },
    // Classified, but neither provider returned a location.
    { ip: '5.5.5.5', org: 'Unknown ISP', isDatacenter: false, country: null, countryCode: null, continent: null, continentCode: null },
    // Not a candidate node: must be filtered out of every breakdown.
    { ip: '9.9.9.9', org: 'Hetzner', isDatacenter: true, country: 'Germany', countryCode: 'DE', continent: 'Europe', continentCode: 'EU' }
];

const CANDIDATE_IPS = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5'];

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Midday UTC: takeSnapshot() refuses to run inside the after-midnight grace period.
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    clearDecentralizationStatsCache();
    mockGetAllNodeIpClassifications.mockResolvedValue(CLASSIFICATIONS);
    mockGetCachedNetworkNodeIps.mockReturnValue(CANDIDATE_IPS);
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

describe('one snapshot cycle, one classification read', () => {
    it('reads node_ip_classification exactly once per snapshot', async () => {
        // Before #151 this was four: the stats cold start, then one per breakdown.
        await takeManualSnapshot();

        expect(mockGetAllNodeIpClassifications).toHaveBeenCalledTimes(1);
    });

    it('still produces every breakdown from that single read', async () => {
        const { createDecentralizationSnapshots, createDecentralizationCountrySnapshots, createDecentralizationContinentSnapshots } =
            await import('../database.js');

        await takeManualSnapshot();

        expect(createDecentralizationSnapshots).toHaveBeenCalledTimes(1);
        expect(createDecentralizationCountrySnapshots).toHaveBeenCalledTimes(1);
        expect(createDecentralizationContinentSnapshots).toHaveBeenCalledTimes(1);
    });

    it('falls back to loading for itself when called without a context', async () => {
        // The getters stay usable standalone, which is what let the refactor land without
        // touching their other callers.
        await getFullCountryBreakdown();

        expect(mockGetAllNodeIpClassifications).toHaveBeenCalledTimes(1);
    });

    it('does not read again for each breakdown when a context is shared', async () => {
        const context = await loadClassificationContext();
        await getFullDatacenterBreakdown(context);
        await getFullCountryBreakdown(context);
        await getFullContinentBreakdown(context);

        expect(mockGetAllNodeIpClassifications).toHaveBeenCalledTimes(1);
    });
});

describe('breakdowns are unchanged by the refactor', () => {
    it('groups countries with their codes, counting only candidate nodes', async () => {
        const context = await loadClassificationContext();

        expect(await getFullCountryBreakdown(context)).toEqual([
            { country: 'Germany', countryCode: 'DE', count: 2 },   // 9.9.9.9 is not a candidate
            { country: 'France', countryCode: 'FR', count: 1 },
            { country: 'United States', countryCode: 'US', count: 1 },
            { country: '(unknown)', countryCode: null, count: 1 }
        ]);
    });

    it('groups continents the same way, from the same context', async () => {
        const context = await loadClassificationContext();

        expect(await getFullContinentBreakdown(context)).toEqual([
            { continent: 'Europe', continentCode: 'EU', count: 3 },
            { continent: 'North America', continentCode: 'NA', count: 1 },
            { continent: '(unknown)', continentCode: null, count: 1 }
        ]);
    });

    it('keeps an unlocated node in the totals under the sentinel, with a null code', async () => {
        // Dropping it would make the breakdown stop summing to the classified count.
        const context = await loadClassificationContext();
        const countries = await getFullCountryBreakdown(context);

        const total = countries.reduce((sum, row) => sum + row.count, 0);
        expect(total).toBe(CANDIDATE_IPS.length);
        expect(countries.find(row => row.country === '(unknown)').countryCode).toBeNull();
    });

    it('still splits datacenter from independent rather than grouping by org alone', async () => {
        const context = await loadClassificationContext();

        expect(await getFullDatacenterBreakdown(context)).toEqual([
            { org: 'Hetzner', count: 2 },
            { org: 'OVH', count: 1 },
            { org: '(independent)', count: 2 }   // Comcast + Unknown ISP
        ]);
    });
});

describe('the dimension registry', () => {
    it('describes each dimension once, for both the group-by and the storage', () => {
        for (const key of Object.keys(BREAKDOWN_DIMENSIONS)) {
            const dimension = resolveDimension(key);
            expect(dimension.key).toBe(key);
            expect(dimension.nameField).toBeTruthy();
            expect(dimension.table).toMatch(/^decentralization_/);
            expect(dimension.nameColumn).toBeTruthy();
            expect(dimension.conflict).toContain('snapshot_date');
        }
    });

    it('refuses an unknown dimension instead of building a query from it', () => {
        // SQL identifiers cannot be bound as parameters, so this whitelist is the control
        // that keeps a table or column name from ever coming out of a caller's string.
        expect(() => resolveDimension('country; DROP TABLE daily_snapshots')).toThrow(/Unknown decentralization dimension/);
        expect(() => resolveDimension('asn')).toThrow(/Unknown decentralization dimension/);
        expect(() => resolveDimension(undefined)).toThrow(/Unknown decentralization dimension/);
    });

    it('pairs every dimension with a distinct table', () => {
        const tables = Object.values(BREAKDOWN_DIMENSIONS).map(d => d.table);
        expect(new Set(tables).size).toBe(tables.length);
    });
});

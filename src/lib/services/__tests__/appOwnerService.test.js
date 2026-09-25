import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #209 — unique app owners.
 *
 * Every spec in globalappsspecifications carries the deploying ZelID in `owner`, so the
 * count of DISTINCT owners is the count of distinct app operators. Measured 2026-09-21:
 * 1,710 specs, 1,659 of them unexpired, run by 1,143 owners.
 *
 * Two things make this a DISTINCT count over a FILTERED list rather than a length:
 *   - one owner routinely runs several apps, so specs != owners
 *   - the registry keeps specs past their expiry block, so an unfiltered count includes
 *     operators whose apps stopped running days ago
 */

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn()
}));
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn(),
    getAllAppSpecs: vi.fn()
}));

import axios from 'axios';
import { updateCurrentMetrics, updateSyncStatus } from '../../db/database.js';
import { ensureGlobalSpecsCache, getAllAppSpecs } from '../appSpecsCache.js';
import {
    fetchUniqueAppOwners,
    refreshUniqueAppOwnersIfStale,
    __resetAppOwnerCacheForTests
} from '../appOwnerService.js';

const BLOCK = 3_000_000;

/** getblockcount's shape: the height is in `data`. */
const blockHeightResponse = { data: { status: 'success', data: BLOCK } };

/**
 * Three owners across five unexpired specs — one owner runs three apps. A sixth spec is
 * expired and belongs to a fourth owner who must NOT be counted.
 */
const SPECS = [
    { name: 'alpha1', owner: 'zelAlpha', height: BLOCK - 100, expire: 5000 },
    { name: 'alpha2', owner: 'zelAlpha', height: BLOCK - 200, expire: 5000 },
    { name: 'alpha3', owner: 'zelAlpha', height: BLOCK - 300, expire: 5000 },
    { name: 'beta1', owner: 'zelBeta', height: BLOCK - 400, expire: 5000 },
    { name: 'gamma1', owner: 'zelGamma', height: BLOCK - 500, expire: 5000 },
    { name: 'delta1', owner: 'zelDelta', height: BLOCK - 9000, expire: 5000 }
];

beforeEach(() => {
    vi.clearAllMocks();
    __resetAppOwnerCacheForTests();
    ensureGlobalSpecsCache.mockResolvedValue(undefined);
    getAllAppSpecs.mockReturnValue(SPECS);
    axios.get.mockResolvedValue(blockHeightResponse);
});

describe('fetchUniqueAppOwners', () => {
    it('counts distinct owners, not specs', async () => {
        const result = await fetchUniqueAppOwners();

        // Median days left over the same five running specs: 4,700 blocks / 2,880 = 1.6.
        expect(result).toEqual({ unique_app_owners: 3, median_days_left: 1.6 });
        expect(updateCurrentMetrics).toHaveBeenCalledWith({ unique_app_owners: 3, median_days_left: 1.6 });
        expect(updateSyncStatus).toHaveBeenCalledWith('app-owners', 'completed');
    });

    it('excludes owners whose every spec has passed its expiry block', async () => {
        // zelDelta's only spec expired at BLOCK - 4000. The registry still serves it --
        // it lags pruning -- so without the filter the figure counts operators whose apps
        // are no longer running, which is a different metric from the one on the card.
        const result = await fetchUniqueAppOwners();

        expect(result.unique_app_owners).toBe(3);
    });

    it('still counts an owner whose other spec is expired', async () => {
        // The filter is per-spec, but the metric is per-owner: one live app is enough.
        getAllAppSpecs.mockReturnValue([
            { name: 'a', owner: 'zelAlpha', height: BLOCK - 9000, expire: 5000 },
            { name: 'b', owner: 'zelAlpha', height: BLOCK - 100, expire: 5000 }
        ]);

        const result = await fetchUniqueAppOwners();

        expect(result.unique_app_owners).toBe(1);
    });

    it('treats a spec expiring on exactly the current block as expired', async () => {
        // height + expire == currentBlock means the lease has run out this block.
        getAllAppSpecs.mockReturnValue([
            { name: 'a', owner: 'zelAlpha', height: BLOCK - 5000, expire: 5000 }
        ]);

        await expect(fetchUniqueAppOwners()).rejects.toThrow();
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
    });

    it('ignores specs with no owner rather than counting them as one owner', async () => {
        // A missing owner is absence of information. Letting undefined/'' into the Set
        // would add exactly one phantom owner, however many such specs there are.
        getAllAppSpecs.mockReturnValue([
            { name: 'a', owner: 'zelAlpha', height: BLOCK - 10, expire: 5000 },
            { name: 'b', owner: '', height: BLOCK - 10, expire: 5000 },
            { name: 'c', owner: null, height: BLOCK - 10, expire: 5000 },
            { name: 'd', height: BLOCK - 10, expire: 5000 },
            { name: 'e', owner: 'zelBeta', height: BLOCK - 10, expire: 5000 }
        ]);

        const result = await fetchUniqueAppOwners();

        // Owner-less specs are still running apps: they count toward time left.
        expect(result).toEqual({ unique_app_owners: 2, median_days_left: 1.7 });
    });

    it('marks the sync failed and rethrows rather than writing 0', async () => {
        // A 0 here would read as "nobody was running an app that day" and, because daily
        // snapshots are averaged into the KPI report, would be averaged in as a real
        // reading. Failure must stay absent, not become a number.
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('down'));

        const pending = expect(fetchUniqueAppOwners()).rejects.toThrow('down');
        await vi.runAllTimersAsync();
        await pending;

        expect(updateSyncStatus).toHaveBeenCalledWith('app-owners', 'failed', 'down');
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('rejects an empty spec list instead of recording zero owners', async () => {
        // appSpecsCache swallows its own fetch errors and leaves the cache empty, so an
        // empty list here is indistinguishable from an upstream fault. Never persist the 0.
        getAllAppSpecs.mockReturnValue([]);

        await expect(fetchUniqueAppOwners()).rejects.toThrow();
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
    });

    it('rejects a zero block height instead of expiring every spec', async () => {
        // carouselService coerces a failed height to 0. If that value reached the filter,
        // every spec would compare as unexpired-in-the-future and the count would be
        // silently wrong rather than absent.
        vi.useFakeTimers();
        axios.get.mockResolvedValue({ data: { status: 'success', data: 0 } });

        const pending = expect(fetchUniqueAppOwners()).rejects.toThrow();
        await vi.runAllTimersAsync();
        await pending;

        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe('refreshUniqueAppOwnersIfStale', () => {
    it('fetches on a cold cache', async () => {
        const result = await refreshUniqueAppOwnersIfStale();

        expect(result).toEqual({ unique_app_owners: 3, median_days_left: 1.6 });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('skips the work while the previous count is still fresh', async () => {
        await refreshUniqueAppOwnersIfStale();
        const second = await refreshUniqueAppOwnersIfStale();

        expect(second).toEqual({ skipped: true });
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
    });

    it('retries on the next cycle after a failure rather than waiting out the interval', async () => {
        // Only successes arm the freshness gate. If failures armed it too, one bad hour
        // would suppress retries for a full interval.
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('down'));
        const failing = expect(refreshUniqueAppOwnersIfStale()).rejects.toThrow('down');
        await vi.runAllTimersAsync();
        await failing;
        vi.useRealTimers();

        axios.get.mockResolvedValue(blockHeightResponse);
        const result = await refreshUniqueAppOwnersIfStale();

        expect(result).toEqual({ unique_app_owners: 3, median_days_left: 1.6 });
    });
});

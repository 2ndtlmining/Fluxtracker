import { describe, it, expect, vi } from 'vitest';

/**
 * Issue #400: of the apps deployed in the last 24h, which are brand new and which are
 * renewals/updates of apps already running. The rule is the app's most recent REGISTER
 * message: inside the window = new, even when the app was updated or renewed again later the
 * same day (a first attempt that looked at the latest message type counted those as renewals).
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn().mockResolvedValue(undefined),
    getAppNameByHash: vi.fn(() => null),
    getAppTypeByName: vi.fn(() => null),
    determineAppType: vi.fn(() => 'docker')
}));
vi.mock('../../db/database.js', () => ({
    updateSyncStatus: vi.fn(),
    getSyncStatus: vi.fn(),
    insertTransactionsBatch: vi.fn(),
    getTxidCount: vi.fn(),
    upsertFailedTxid: vi.fn(),
    getUnresolvedFailedTxids: vi.fn(),
    resolveFailedTxid: vi.fn()
}));
vi.mock('../priceHistoryService.js', () => ({ syncPriceHistory: vi.fn(), buildFullPriceMap: vi.fn(), repairTodaysNullUsd: vi.fn() }));
vi.mock('../fluxNetworkData.js', () => ({ fetchFluxPrice: vi.fn(), fetchCurrentBlockHeight: vi.fn() }));

import { resilientFetch } from '../resilientFetch.js';
import { fetchPermanentMessages, classifyDeployment } from '../revenue/transactionSync.js';

const H = 3_000_000;
const WINDOW_START = H - 2880;
const msg = (type, name, height) => ({ type, height, hash: `${name}-${type}-${height}`, txid: `tx-${name}-${height}`, appSpecifications: { name } });

describe('classifyDeployment (#400)', () => {
    it('is null until the permanent messages have loaded -- never a guess', () => {
        expect(classifyDeployment('anything', WINDOW_START)).toBeNull();
    });

    it('classifies by the most recent registration', async () => {
        resilientFetch.mockResolvedValue({
            status: 'success',
            data: [
                msg('fluxappregister', 'brandnew', H - 100),                  // registered today
                msg('fluxappregister', 'newthenupdated', H - 2000),           // registered today...
                msg('fluxappupdate', 'newthenupdated', H - 50),               // ...then updated today
                msg('fluxappregister', 'renewed', H - 90_000),                // registered long ago
                msg('fluxappupdate', 'renewed', H - 10),                      // renewed today
                msg('fluxappregister', 'Reused', H - 900_000),                // old life, expired
                msg('fluxappregister', 'reused', H - 500)                     // same name, new life today
            ]
        });
        await fetchPermanentMessages();

        expect(classifyDeployment('brandnew', WINDOW_START)).toBe('new');
        expect(classifyDeployment('newthenupdated', WINDOW_START)).toBe('new');
        expect(classifyDeployment('renewed', WINDOW_START)).toBe('updated');
        expect(classifyDeployment('REUSED', WINDOW_START)).toBe('new');
        // Not in the cache at all: the cache holds every message ever, so it is newer than it.
        expect(classifyDeployment('neverseen', WINDOW_START)).toBe('new');
    });
});

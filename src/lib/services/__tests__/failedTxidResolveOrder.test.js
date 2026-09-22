import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TARGET_ADDRESSES } from '../../config.js';

/**
 * Issue #315 — a previously failed txid must only be marked resolved once its payments are
 * actually in the database.
 *
 * The retry pass used to call resolveFailedTxid() as soon as it had re-fetched and parsed the
 * transaction, and wrote the payments later in the final flush. If that write failed, the
 * sync aborted (cursor not advanced) -- but the txid already read as resolved and usually sat
 * older than the 25-block rescan overlap, so the recovered revenue never appeared.
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
    resolveFailedTxid: vi.fn(),
    getFailedTxidCount: vi.fn().mockResolvedValue(0)
}));
vi.mock('../priceHistoryService.js', () => ({
    syncPriceHistory: vi.fn(),
    buildFullPriceMap: vi.fn().mockResolvedValue(new Map()),
    repairTodaysNullUsd: vi.fn()
}));
vi.mock('../fluxNetworkData.js', () => ({
    fetchFluxPrice: vi.fn().mockResolvedValue(0.05),
    fetchCurrentBlockHeight: vi.fn().mockResolvedValue(3_000_000)
}));

import { resilientFetch } from '../resilientFetch.js';
import {
    getSyncStatus,
    insertTransactionsBatch,
    getUnresolvedFailedTxids,
    resolveFailedTxid,
    updateSyncStatus
} from '../../db/database.js';

const FAILED_TXID = 'f'.repeat(64);

/** A confirmed payment from an outside wallet to the first tracked address. */
const rawTx = {
    txid: FAILED_TXID,
    confirmations: 100,
    blocktime: 1_700_000_000,
    height: 2_000_000,
    vin: [{ addresses: ['t1SomePayerAddressxxxxxxxxxxxxxxxx'] }],
    vout: [{ value: 12.5, scriptPubKey: { addresses: [TARGET_ADDRESSES[0]] } }]
};

beforeEach(() => {
    vi.clearAllMocks();
    getSyncStatus.mockResolvedValue({ last_sync_block: 2_999_990 });
    getUnresolvedFailedTxids.mockResolvedValue([{ txid: FAILED_TXID, address: TARGET_ADDRESSES[0] }]);
    resilientFetch.mockImplementation(async (url) => {
        if (String(url).includes('getrawtransaction')) return { status: 'success', data: rawTx };
        return { status: 'success', data: [] }; // no new txids, empty permanentmessages
    });
});

async function runSync() {
    vi.resetModules();
    const { progressiveSync } = await import('../revenue/transactionSync.js');
    return progressiveSync();
}

describe('failed-txid retry resolves only after the write lands (issue #315)', () => {
    it('does NOT resolve the txid when the final write fails', async () => {
        insertTransactionsBatch.mockResolvedValue(false);

        await runSync();

        expect(insertTransactionsBatch).toHaveBeenCalledTimes(1);
        expect(insertTransactionsBatch.mock.calls[0][0][0].txid).toBe(FAILED_TXID);
        expect(resolveFailedTxid).not.toHaveBeenCalled();
        expect(updateSyncStatus).not.toHaveBeenCalledWith('revenue', 'completed', null, expect.anything());
    });

    it('resolves the txid once its payment is written', async () => {
        insertTransactionsBatch.mockResolvedValue(true);

        await runSync();

        expect(resolveFailedTxid).toHaveBeenCalledWith(FAILED_TXID);
        expect(insertTransactionsBatch.mock.invocationCallOrder[0])
            .toBeLessThan(resolveFailedTxid.mock.invocationCallOrder[0]);
    });
});

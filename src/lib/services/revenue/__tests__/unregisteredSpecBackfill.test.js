import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * backfillAppNames and the "Unregistered spec" label (owner-approved 2026-09-26). A hash
 * with no name is labelled only when isUnregisteredSpec() says Flux definitively has no
 * message for it; otherwise the row is left exactly as before, to be retried.
 */

vi.mock('../../../db/database.js', () => ({
    getUndeterminedAppNames: vi.fn(),
    updateAppTypeForAppName: vi.fn(),
    getTxidsWithoutAppName: vi.fn(),
    countTxidsWithoutAppName: vi.fn(),
    updateAppNameForTxid: vi.fn(),
    upsertFailedTxid: vi.fn(),
    isFailedTxid: vi.fn(),
    updateTransactionMetadataBatch: vi.fn(),
    updateTransactionGameBatch: vi.fn()
}));
vi.mock('../transactionSync.js', () => ({
    ensurePermanentMessagesCache: vi.fn(),
    classifyOpReturn: vi.fn(() => ({ kind: 'hash', value: 'h'.repeat(64) })),
    resolveAppName: vi.fn(),
    lookupAppType: vi.fn(() => 'docker'),
    fetchRawTransaction: vi.fn(async txid => ({ txid, blocktime: 1_700_000_000 })),
    FLUXDRIVE_APP_TYPE: 'fluxdrive',
    UNREGISTERED_APP_TYPE: 'unregistered',
    isUnregisteredSpec: vi.fn(),
    fetchPermanentMessages: vi.fn(),
    getMessageMetadataIndex: vi.fn()
}));

import * as db from '../../../db/database.js';
import * as sync from '../transactionSync.js';
import { backfillAppNames } from '../revenueBackfill.js';

beforeEach(() => {
    vi.clearAllMocks();
    db.countTxidsWithoutAppName.mockResolvedValue(1);
    db.getTxidsWithoutAppName.mockResolvedValue(['tx1']);
    sync.resolveAppName.mockResolvedValue(null);
});

describe('backfillAppNames: unregistered specs', () => {
    it('labels the row and parks it when Flux definitively has no message', async () => {
        sync.isUnregisteredSpec.mockReturnValue(true);

        const result = await backfillAppNames(10);

        // app_name stays NULL so a late resolution can still name the row.
        expect(db.updateAppNameForTxid).toHaveBeenCalledWith('tx1', null, 'unregistered');
        expect(db.upsertFailedTxid).toHaveBeenCalledWith('tx1', '', 'unregistered');
        expect(result).toMatchObject({ unregistered: 1, noName: 0, remaining: 0 });
    });

    it('leaves a merely unresolved row untouched, to be retried', async () => {
        sync.isUnregisteredSpec.mockReturnValue(false);

        const result = await backfillAppNames(10);

        expect(db.updateAppNameForTxid).not.toHaveBeenCalled();
        expect(db.upsertFailedTxid).not.toHaveBeenCalled();
        expect(result).toMatchObject({ unregistered: 0, noName: 1 });
    });

    it('a resolved name always wins -- the label is never consulted', async () => {
        sync.resolveAppName.mockResolvedValue('myapp');

        await backfillAppNames(10);

        expect(sync.isUnregisteredSpec).not.toHaveBeenCalled();
        expect(db.updateAppNameForTxid).toHaveBeenCalledWith('tx1', 'myapp', 'docker');
    });
});

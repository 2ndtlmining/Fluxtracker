import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * catchUpMessageMetadata: the automatic form of /api/admin/backfill-message-metadata. Rows
 * stored before their message reached the cache used to keep msg_type NULL until someone
 * ran the endpoint by hand -- a quarter of October's payments, which hid the TRIAL badge.
 * It applies each daily dump once, from the cache, without downloading it again.
 */

vi.mock('../../../db/database.js', () => ({
    getUndeterminedAppNames: vi.fn(),
    updateAppTypeForAppName: vi.fn(),
    getTxidsWithoutAppName: vi.fn(),
    countTxidsWithoutAppName: vi.fn(),
    updateAppNameForTxid: vi.fn(),
    upsertFailedTxid: vi.fn(),
    isFailedTxid: vi.fn(),
    updateTransactionMetadataBatch: vi.fn(async rows => rows.length),
    updateTransactionGameBatch: vi.fn()
}));
vi.mock('../transactionSync.js', () => ({
    ensurePermanentMessagesCache: vi.fn(),
    classifyOpReturn: vi.fn(),
    resolveAppName: vi.fn(),
    lookupAppType: vi.fn(),
    fetchRawTransaction: vi.fn(),
    FLUXDRIVE_APP_TYPE: 'fluxdrive',
    UNREGISTERED_APP_TYPE: 'unregistered',
    isUnregisteredSpec: vi.fn(),
    fetchPermanentMessages: vi.fn(),
    getMessageMetadataIndex: vi.fn(),
    getPermanentMessagesFetchedAt: vi.fn()
}));

import * as db from '../../../db/database.js';
import * as sync from '../transactionSync.js';

const index = new Map([['tx1', { txid: 'tx1', msg_type: 'register' }], ['tx2', { txid: 'tx2', msg_type: 'update' }]]);

async function load() {
    vi.resetModules();
    return await import('../revenueBackfill.js');
}

beforeEach(() => {
    vi.clearAllMocks();
    sync.getMessageMetadataIndex.mockReturnValue(index);
});

describe('catchUpMessageMetadata', () => {
    it('applies a fresh dump from the cache, without downloading it again', async () => {
        sync.getPermanentMessagesFetchedAt.mockReturnValue(1000);
        const { catchUpMessageMetadata } = await load();

        await expect(catchUpMessageMetadata()).resolves.toEqual({ messages: 2, updated: 2 });
        expect(db.updateTransactionMetadataBatch).toHaveBeenCalledWith([...index.values()]);
        expect(sync.fetchPermanentMessages).not.toHaveBeenCalled();
    });

    it('applies each dump once -- every later sync pass is free until the next one', async () => {
        sync.getPermanentMessagesFetchedAt.mockReturnValue(1000);
        const { catchUpMessageMetadata } = await load();

        await catchUpMessageMetadata();
        await expect(catchUpMessageMetadata()).resolves.toBeNull();
        expect(db.updateTransactionMetadataBatch).toHaveBeenCalledTimes(1);

        sync.getPermanentMessagesFetchedAt.mockReturnValue(2000);
        await catchUpMessageMetadata();
        expect(db.updateTransactionMetadataBatch).toHaveBeenCalledTimes(2);
    });

    it('does nothing before any dump has loaded', async () => {
        sync.getPermanentMessagesFetchedAt.mockReturnValue(0);
        const { catchUpMessageMetadata } = await load();

        await expect(catchUpMessageMetadata()).resolves.toBeNull();
        expect(db.updateTransactionMetadataBatch).not.toHaveBeenCalled();
    });

    it('retries the same dump on the next pass when the write failed', async () => {
        sync.getPermanentMessagesFetchedAt.mockReturnValue(1000);
        db.updateTransactionMetadataBatch.mockRejectedValueOnce(new Error('timeout'));
        const { catchUpMessageMetadata } = await load();

        await expect(catchUpMessageMetadata()).rejects.toThrow('timeout');
        await expect(catchUpMessageMetadata()).resolves.toEqual({ messages: 2, updated: 2 });
    });
});

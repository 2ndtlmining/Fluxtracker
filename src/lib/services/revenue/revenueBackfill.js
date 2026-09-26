import { createLogger } from '../../logger.js';
import {
    getUndeterminedAppNames,
    updateAppTypeForAppName,
    getTxidsWithoutAppName,
    countTxidsWithoutAppName,
    updateAppNameForTxid,
    upsertFailedTxid,
    isFailedTxid,
    updateTransactionMetadataBatch,
    updateTransactionGameBatch
} from '../../db/database.js';
import {
    ensurePermanentMessagesCache,
    classifyOpReturn,
    resolveAppName,
    lookupAppType,
    fetchRawTransaction,
    FLUXDRIVE_APP_TYPE,
    fetchPermanentMessages,
    getMessageMetadataIndex
} from './transactionSync.js';

const log = createLogger('revenueService');

// ============================================
// MESSAGE METADATA BACKFILL (issue #262)
// ============================================

/**
 * Fill msg_type / enterprise / expire_blocks / instances on every stored transaction that a
 * permanent message names, from ONE fresh download of /apps/permanentmessages (the sync
 * fetches the same payload hourly). Only rows with no metadata yet are touched, so it is
 * safe to re-run. Needs migration 019 on Supabase.
 *
 * @returns {{messages: number, updated: number}}
 */
export async function backfillMessageMetadata() {
    await fetchPermanentMessages();
    const index = getMessageMetadataIndex();
    if (index.size === 0) {
        throw new Error('No permanent messages loaded -- the API did not answer; nothing was changed');
    }

    const updates = [...index.values()];
    const CHUNK = 5000;
    let updated = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
        updated += await updateTransactionMetadataBatch(updates.slice(i, i + CHUNK));
        log.info({ done: Math.min(i + CHUNK, updates.length), total: updates.length, updated }, 'Message metadata back-fill: %d/%d messages', Math.min(i + CHUNK, updates.length), updates.length);
    }
    log.info({ messages: index.size, updated }, 'Message metadata back-fill complete: %d transactions updated', updated);
    return { messages: index.size, updated };
}

/**
 * Issue #395: record which game each stored payment was for, from one download of
 * /apps/permanentmessages -- the game-site name, or else a game image in the payment's spec.
 * Only rows with no game yet are touched; safe to re-run. Needs migration 026 on Supabase.
 */
export async function backfillGameNames() {
    await fetchPermanentMessages();
    const index = getMessageMetadataIndex();
    if (index.size === 0) {
        throw new Error('No permanent messages loaded -- the API did not answer; nothing was changed');
    }

    const updates = [...index.values()]
        .filter(meta => meta.game_name)
        .map(meta => ({ txid: meta.txid, game_name: meta.game_name }));
    const CHUNK = 5000;
    let updated = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
        updated += await updateTransactionGameBatch(updates.slice(i, i + CHUNK));
    }
    log.info({ messages: index.size, games: updates.length, updated }, 'Game-name back-fill complete: %d transactions updated', updated);
    return { messages: index.size, gameMessages: updates.length, updated };
}

// ============================================
// APP TYPE BACKFILL
// ============================================

/**
 * Backfill app_type for all existing transactions where it is NULL.
 * Uses the permanentMessages cache (fetches if stale) to determine git vs docker.
 * Safe to run multiple times — only updates rows still missing app_type.
 */
export async function backfillAppTypes() {
    await ensurePermanentMessagesCache();

    const appNames = await getUndeterminedAppNames();
    log.info({ count: appNames.length }, 'Backfilling app_type for %d distinct app names', appNames.length);

    let updated = 0;
    let unknown = 0;

    for (const appName of appNames) {
        const type = lookupAppType(appName);
        if (type) {
            await updateAppTypeForAppName(appName, type);
            updated++;
        } else {
            unknown++;
        }
    }

    log.info({ updated, unknown }, 'app_type backfill complete: %d updated, %d unknown (no spec found)', updated, unknown);
    return { total: appNames.length, updated, unknown };
}

/**
 * Backfill app_name (and app_type) for existing transactions where app_name is NULL.
 * Re-fetches raw transactions to extract OP_RETURN hashes, then resolves via cache.
 * Safe to run multiple times — only touches rows still missing app_name.
 * @param {number} batchSize - max transactions to process per call (default 500)
 * @param {number|null} recentDays - if set, only process transactions from the last N days
 * @param {boolean} skipFailed - if true, skip txids already known to have no OP_RETURN hash (auto-backfill only)
 */
export async function backfillAppNames(batchSize = 500, recentDays = null, skipFailed = false) {
    await ensurePermanentMessagesCache();

    const total = await countTxidsWithoutAppName(recentDays);

    // Fetch extra candidates so we still fill the batch after filtering out known-no-hash txids
    const candidates = await getTxidsWithoutAppName(skipFailed ? batchSize * 3 : batchSize, recentDays);
    let txids;
    if (skipFailed) {
        const filtered = [];
        for (const txid of candidates) {
            if (!(await isFailedTxid(txid))) {
                filtered.push(txid);
                if (filtered.length >= batchSize) break;
            }
        }
        txids = filtered;
    } else {
        txids = candidates;
    }

    log.info({ batch: txids.length, total }, 'Backfilling app_name for %d of %d transactions with no app_name', txids.length, total);

    let updated = 0;
    let noHash = 0;
    let noName = 0;
    let fetchErrors = 0;
    let fluxDrive = 0;

    const BATCH = 10;
    for (let i = 0; i < txids.length; i += BATCH) {
        const batch = txids.slice(i, i + BATCH);
        const txResults = await Promise.all(batch.map(txid => fetchRawTransaction(txid)));

        for (let j = 0; j < batch.length; j++) {
            const txid = batch[j];
            const tx = txResults[j];

            if (!tx) { fetchErrors++; continue; }

            const opReturn = classifyOpReturn(tx);

            if (opReturn.kind === 'fluxdrive') {
                // A FluxDrive payment (issue #188). It HAS an OP_RETURN, so calling it
                // no_hash was wrong -- but its reference resolves to nothing in any Flux
                // API, so there is no name to wait for either. Record the type and mark it
                // resolved-as-far-as-it-goes so the retry queue stops carrying it.
                //
                // app_name stays NULL deliberately: updateAppNameForTxid is guarded by
                // app_name IS NULL, so writing a literal name here would freeze the row
                // against any future resolution, and App Analytics groups by app_name --
                // a literal would surface FluxDrive as a synthetic app.
                await updateAppNameForTxid(txid, null, FLUXDRIVE_APP_TYPE);
                await upsertFailedTxid(txid, '', 'fluxdrive');
                fluxDrive++;
                continue;
            }

            if (opReturn.kind !== 'hash') {
                // Direct FLUX payment — no OP_RETURN (or one we cannot classify with
                // confidence), so it will never have an app_name. Mark in DB so
                // auto-backfill (skipFailed=true) skips it next time.
                await upsertFailedTxid(txid, '', 'no_hash');
                noHash++;
                continue;
            }

            // Same targeted fallback as the sync path: a recent registration the cached
            // map has not seen yet is resolved on this pass instead of the next hour's.
            const appName = await resolveAppName(opReturn.value, tx.blocktime);
            if (!appName) { noName++; continue; }

            const appType = lookupAppType(appName);
            await updateAppNameForTxid(txid, appName, appType);
            updated++;
        }

        if (i + BATCH < txids.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    const remaining = total - updated - fluxDrive;
    log.info({ updated, fluxDrive, noHash, noName, fetchErrors, remaining }, 'app_name backfill complete: %d updated, %d FluxDrive, %d no OP_RETURN hash, %d hash not in cache, %d fetch errors, ~%d remaining', updated, fluxDrive, noHash, noName, fetchErrors, remaining);
    return { total, processed: txids.length, updated, fluxDrive, noHash, noName, fetchErrors, remaining };
}

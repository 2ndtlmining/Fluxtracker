import { createLogger } from '../../logger.js';
import {
    getUndeterminedAppNames,
    updateAppTypeForAppName,
    getTxidsWithoutAppName,
    countTxidsWithoutAppName,
    updateAppNameForTxid,
    upsertFailedTxid,
    isFailedTxid
} from '../../db/database.js';
import {
    ensurePermanentMessagesCache,
    extractAppHashFromTx,
    lookupAppName,
    lookupAppType,
    fetchRawTransaction
} from './transactionSync.js';

const log = createLogger('revenueService');

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

    const BATCH = 10;
    for (let i = 0; i < txids.length; i += BATCH) {
        const batch = txids.slice(i, i + BATCH);
        const txResults = await Promise.all(batch.map(txid => fetchRawTransaction(txid)));

        for (let j = 0; j < batch.length; j++) {
            const txid = batch[j];
            const tx = txResults[j];

            if (!tx) { fetchErrors++; continue; }

            const appHash = extractAppHashFromTx(tx);
            if (!appHash) {
                // Direct FLUX payment — no OP_RETURN, will never have an app_name.
                // Mark in DB so auto-backfill (skipFailed=true) skips it next time.
                await upsertFailedTxid(txid, '', 'no_hash');
                noHash++;
                continue;
            }

            const appName = lookupAppName(appHash);
            if (!appName) { noName++; continue; }

            const appType = lookupAppType(appName);
            await updateAppNameForTxid(txid, appName, appType);
            updated++;
        }

        if (i + BATCH < txids.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    const remaining = total - updated;
    log.info({ updated, noHash, noName, fetchErrors, remaining }, 'app_name backfill complete: %d updated, %d no OP_RETURN hash, %d hash not in cache, %d fetch errors, ~%d remaining', updated, noHash, noName, fetchErrors, remaining);
    return { total, processed: txids.length, updated, noHash, noName, fetchErrors, remaining };
}

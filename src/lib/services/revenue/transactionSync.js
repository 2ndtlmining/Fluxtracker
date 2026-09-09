import { API_ENDPOINTS, TARGET_ADDRESSES, EXCLUDED_TRANSACTIONS, REVENUE_SYNC } from '../../config.js';
import { resilientFetch } from '../resilientFetch.js';
import { ensureGlobalSpecsCache, getAppNameByHash, getAppTypeByName, determineAppType } from '../appSpecsCache.js';
import { createLogger } from '../../logger.js';
import {
    updateSyncStatus,
    getSyncStatus,
    insertTransactionsBatch,
    getTxidCount,
    upsertFailedTxid,
    getUnresolvedFailedTxids,
    resolveFailedTxid
} from '../../db/database.js';
import { syncPriceHistory, buildFullPriceMap } from '../priceHistoryService.js';
import { fetchFluxPrice, fetchCurrentBlockHeight } from '../fluxNetworkData.js';
import {
    revenueSyncState,
    setRevenueSyncRunning,
    setRevenueSyncError,
    getFailedTxStats
} from './revenueSyncState.js';

const log = createLogger('revenueService');

const TXID_CHUNK_SIZE = REVENUE_SYNC.TXID_CHUNK_SIZE;

/**
 * Fetch transaction IDs for an address within a block range using Flux daemon API.
 * Automatically chunks large ranges to avoid API timeouts.
 */
export async function fetchAddressTxidsInRange(address, startBlock, endBlock) {
    const allTxids = [];
    const totalBlocks = endBlock - startBlock;

    // Split large ranges into chunks to avoid timeouts on the public API
    const chunks = [];
    if (totalBlocks > TXID_CHUNK_SIZE) {
        for (let from = startBlock; from < endBlock; from += TXID_CHUNK_SIZE) {
            chunks.push([from, Math.min(from + TXID_CHUNK_SIZE - 1, endBlock)]);
        }
    } else {
        chunks.push([startBlock, endBlock]);
    }

    if (chunks.length > 1) {
        log.info({ totalBlocks, chunks: chunks.length, chunkSize: TXID_CHUNK_SIZE }, 'Splitting %s blocks into %d chunks of %s', totalBlocks.toLocaleString(), chunks.length, TXID_CHUNK_SIZE.toLocaleString());
    }

    let failedFromBlock = null;

    for (const [from, to] of chunks) {
        const MAX_RETRIES = 3;
        let chunkSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = `${API_ENDPOINTS.DAEMON}/getaddresstxids/${address}/${from}/${to}`;

                // resilientFetch with no retries: the chunk loop below owns the retry and
                // backoff policy (exponential, partial-failure tolerant). The breaker only
                // guards against hammering a dead daemon across many chunks.
                const body = await resilientFetch(url, {
                    timeout: 60000,
                    breakerKey: 'flux-daemon-getaddresstxids'
                });

                if (body && body.status === 'success' && Array.isArray(body.data)) {
                    const count = body.data.length;
                    if (count > 0) {
                        log.info({ from, to, count }, 'blocks %d-%d: %d txids found', from, to, count);
                    }
                    allTxids.push(...body.data);
                    chunkSuccess = true;
                    break;
                } else {
                    log.warn({ from, to, attempt, maxRetries: MAX_RETRIES, status: body?.status, data: body?.data ?? body }, 'blocks %d-%d: unexpected response (attempt %d/%d)', from, to, attempt, MAX_RETRIES);
                }
            } catch (error) {
                log.error({ err: error, from, to, attempt, maxRetries: MAX_RETRIES }, 'blocks %d-%d: fetch error (attempt %d/%d)', from, to, attempt, MAX_RETRIES);
            }

            // Exponential backoff before retry: 2s, 4s, 8s
            if (attempt < MAX_RETRIES) {
                const backoffMs = Math.pow(2, attempt) * 1000;
                log.info({ backoffSec: backoffMs / 1000 }, 'Retrying in %ds', backoffMs / 1000);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }

        if (!chunkSuccess) {
            log.error({ from, to, maxRetries: MAX_RETRIES }, 'blocks %d-%d: permanently failed after %d attempts -- txids from this range will be missing', from, to, MAX_RETRIES);
            if (failedFromBlock === null || from < failedFromBlock) {
                failedFromBlock = from;
            }
        }

        // Small delay between chunks to be API-friendly
        if (chunks.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    log.info({ address: address.substring(0, 15), count: allTxids.length }, 'Total txids fetched for %s: %d', address.substring(0, 15), allTxids.length);
    return { txids: allTxids, failedFromBlock };
}

/**
 * Fetch raw transaction details from Flux daemon with retry logic
 */
export async function fetchRawTransaction(txid, retries = 3) {
    const url = `${API_ENDPOINTS.DAEMON}/getrawtransaction/${txid}/1`;

    try {
        // Network failures are retried; a daemon ANSWER with a non-success status is not
        // (an unknown txid would stay unknown), matching the old no-retry path for it.
        const body = await resilientFetch(url, {
            timeout: 15000,
            retries: retries - 1,
            delayMs: 1000,
            breakerKey: 'flux-daemon-getrawtransaction'
        });

        if (body?.status === 'success') {
            return body.data;
        }

        return null;
    } catch (error) {
        // A missing/failed transaction is tolerated: sync continues without it.
        log.error({ txid: txid.substring(0, 10), retries }, 'Failed to fetch tx %s after %d attempts', txid.substring(0, 10), retries);
        return null;
    }
}

// ============================================
// APP NAME LOOKUP (via OP_RETURN + permanentmessages)
// ============================================

const permanentMessagesCache = {
    map: new Map(),      // hash -> name
    typeMap: new Map(),  // name (lowercase) -> 'git' | 'docker'
    lastFetched: 0,
    TTL: 60 * 60 * 1000  // 1 hour
};

export async function fetchPermanentMessages() {
    try {
        log.info('Fetching permanent messages for app name lookup');
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/permanentmessages`, {
            timeout: 30000,
            breakerKey: 'permanent-messages'
        });

        if (body && body.status === 'success' && Array.isArray(body.data)) {
            permanentMessagesCache.map.clear();
            permanentMessagesCache.typeMap.clear();
            for (const msg of body.data) {
                const hash = msg.hash;
                const appSpec = msg.zelAppSpecification || msg.appSpecifications;
                const name = appSpec?.name || msg.name;
                if (hash && name) {
                    permanentMessagesCache.map.set(hash, name);
                    permanentMessagesCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            permanentMessagesCache.lastFetched = Date.now();
            log.info({ count: permanentMessagesCache.map.size }, 'Loaded %d app names from permanent messages', permanentMessagesCache.map.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch permanent messages');
    }
}

// The globalappsspecifications half of this cache now lives in appSpecsCache.js, shared
// with runningAppsProvider.js. permanentMessages stays here — it's only needed for
// historical/undeployed-app transaction lookups, not live categorization.
export async function ensurePermanentMessagesCache() {
    const pmAge = Date.now() - permanentMessagesCache.lastFetched;
    const fetches = [ensureGlobalSpecsCache()];
    if (pmAge > permanentMessagesCache.TTL || permanentMessagesCache.map.size === 0) {
        fetches.push(fetchPermanentMessages());
    }
    await Promise.all(fetches);
}

/**
 * Extract app hash from OP_RETURN output of a transaction
 */
export function extractAppHashFromTx(tx) {
    if (!tx.vout) return null;

    for (const vout of tx.vout) {
        if (vout.scriptPubKey && vout.scriptPubKey.type === 'nulldata') {
            const hex = vout.scriptPubKey.hex || '';
            // Skip OP_RETURN opcode (6a) + length byte = 4 hex chars
            if (hex.length > 4 && hex.startsWith('6a')) {
                const dataHex = hex.substring(4);
                try {
                    const decoded = Buffer.from(dataHex, 'hex').toString('utf8');
                    if (/^[0-9a-f]{64}$/i.test(decoded.trim())) {
                        return decoded.trim().toLowerCase();
                    }
                } catch (e) {
                    // ignore parse errors
                }
            }
        }
    }
    return null;
}

/**
 * Look up app name from hash — permanentMessages first, globalSpecs (shared cache) as fallback
 */
export function lookupAppName(hash) {
    if (!hash) return null;
    return permanentMessagesCache.map.get(hash) || getAppNameByHash(hash) || null;
}

/**
 * Look up app type (git/docker) by app name
 */
export function lookupAppType(appName) {
    if (!appName) return null;
    return permanentMessagesCache.typeMap.get(appName.toLowerCase())
        || getAppTypeByName(appName)
        || null;
}

// ============================================
// TRANSACTION PROCESSING
// ============================================

/**
 * Process transaction and extract revenue for our tracked addresses.
 * Expects Flux daemon getrawtransaction format (vout.value already in FLUX).
 */
export function processTransaction(tx, trackedAddresses, fluxPriceUSD = null, appName = null, appType = null, priceMap = null) {
    const transactions = [];

    if (!tx || !tx.vout) {
        return transactions;
    }

    // Flux daemon uses tx.blocktime (not blockTime) and tx.height (not blockHeight)
    const timestamp = tx.blocktime || Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().split('T')[0];
    const blockHeight = tx.height || 0;

    let fromAddress = 'Unknown';
    if (tx.vin && tx.vin.length > 0) {
        fromAddress = tx.vin[0].addresses?.[0] || tx.vin[0].address || 'Unknown';
    }

    for (const vout of tx.vout) {
        // Flux daemon puts addresses inside scriptPubKey.addresses
        const addresses = vout.scriptPubKey?.addresses || vout.addresses || [];

        if (!addresses || addresses.length === 0) continue;

        for (const address of addresses) {
            if (trackedAddresses.includes(address)) {
                // vout.value is already in FLUX (no satoshi conversion needed)
                const amountFlux = parseFloat(vout.value) || 0;

                // Skip excluded transactions (e.g. Flux app spec-change fees)
                const isExcluded = EXCLUDED_TRANSACTIONS.some(
                    ex => ex.from_address === fromAddress && Math.abs(ex.amount - amountFlux) < 0.000001
                );
                if (isExcluded) continue;

                // Skip UTXO change: from_address == receiving address means this is
                // just unspent change returning to the same wallet, not real revenue
                if (trackedAddresses.includes(fromAddress)) continue;

                // USD conversion priority:
                // 1. Recent tx (<24h) + live price available -> use live price
                // 2. Historical price map has the date -> use historical price
                // 3. No data -> NULL
                let amountUSD = null;
                const txAgeSeconds = Math.floor(Date.now() / 1000) - timestamp;
                if (fluxPriceUSD && txAgeSeconds < 86400) {
                    amountUSD = amountFlux * fluxPriceUSD;
                } else if (priceMap && priceMap.has(date)) {
                    amountUSD = amountFlux * priceMap.get(date);
                }

                transactions.push({
                    txid: tx.txid,
                    address,
                    from_address: fromAddress,
                    amount: amountFlux,
                    amount_usd: amountUSD,
                    block_height: blockHeight,
                    timestamp,
                    date,
                    app_name: appName || null,
                    app_type: appType || null
                });
            }
        }
    }

    return transactions;
}

// ============================================
// PROGRESSIVE SYNC LOGIC (NEW)
// ============================================

/**
 * Progressive sync — uses Flux daemon block-range API to find and import new transactions
 */
export async function progressiveSync() {
    log.info('Starting block-range sync');

    const startTime = Date.now();
    const BATCH_SIZE = REVENUE_SYNC.APP_NAME_BATCH_SIZE;

    try {
        // 1. Sync historical price data (fast no-op if already current)
        try {
            await syncPriceHistory();
        } catch (priceErr) {
            log.warn({ err: priceErr }, 'Price history sync failed (non-fatal)');
        }

        // 1b. Fetch live FLUX price
        const fluxPrice = await fetchFluxPrice();
        if (fluxPrice) {
            log.info({ fluxPrice: fluxPrice.toFixed(4) }, 'FLUX price: $%s', fluxPrice.toFixed(4));
        } else {
            log.warn('Could not fetch FLUX price - USD values will be null');
        }

        // 1c. Build historical price map for USD conversion of older transactions
        const priceMap = await buildFullPriceMap();

        // 2. Get current block height
        const currentBlock = await fetchCurrentBlockHeight();
        revenueSyncState.currentBlock = currentBlock;

        // 3. Determine start block.
        // Use last_sync_block from sync_status (the highest block we've SCANNED, not just the
        // highest block we have a transaction for). This prevents re-scanning a growing gap
        // when there are no recent transactions.
        // NOTE: Block 0 is not supported by getaddresstxids API — always start at 1 minimum.
        const syncStatus = await getSyncStatus('revenue');
        const lastSyncedBlock = syncStatus?.last_sync_block || null;
        const startBlock = lastSyncedBlock
            ? Math.max(1, lastSyncedBlock - 25)                              // 25-block overlap catches edge cases
            : 1;                                                             // Initial sync: scan from block 1 (full chain)

        log.info({ startBlock, currentBlock, blocks: currentBlock - startBlock }, 'Block range: %d -> %d (%d blocks)', startBlock, currentBlock, currentBlock - startBlock);

        // 4. Ensure app name cache is fresh
        await ensurePermanentMessagesCache();

        let pendingPayments = [];   // buffer between DB flushes
        let totalNewPayments = 0;
        const DB_FLUSH_SIZE = REVENUE_SYNC.DB_FLUSH_SIZE;
        let syncAborted = false;
        let lowestFailedBlock = null;

        // Helper: flush pending payments to DB so they become visible immediately
        async function flushPending() {
            if (pendingPayments.length === 0) return;
            const writeOk = await insertTransactionsBatch(pendingPayments);
            if (writeOk === false) {
                log.error('Database write error -- aborting sync to avoid data loss');
                syncAborted = true;
                return;
            }
            totalNewPayments += pendingPayments.length;
            log.info({ flushed: pendingPayments.length, totalSoFar: totalNewPayments }, 'Flushed %d payments to DB (total so far: %d)', pendingPayments.length, totalNewPayments);
            pendingPayments = [];
        }

        // 6. Process each tracked address
        for (const address of TARGET_ADDRESSES) {
            if (syncAborted) break;

            log.info({ address: address.substring(0, 20) }, 'Fetching txids for %s', address.substring(0, 20));

            const { txids, failedFromBlock } = await fetchAddressTxidsInRange(address, startBlock, currentBlock);

            // Track the lowest failed block across all addresses
            if (failedFromBlock !== null && (lowestFailedBlock === null || failedFromBlock < lowestFailedBlock)) {
                lowestFailedBlock = failedFromBlock;
            }

            if (!txids || txids.length === 0) {
                log.info('No transactions found in range');
                continue;
            }

            log.info({ count: txids.length }, 'Found %d transactions to process', txids.length);

            // Process in parallel batches (dedup handled by ON CONFLICT DO NOTHING on upsert)
            for (let i = 0; i < txids.length; i += BATCH_SIZE) {
                const batch = txids.slice(i, i + BATCH_SIZE);

                const txResults = await Promise.all(batch.map(txid => fetchRawTransaction(txid)));

                for (let j = 0; j < batch.length; j++) {
                    const txid = batch[j];
                    const tx = txResults[j];

                    if (!tx) {
                        await upsertFailedTxid(txid, address, 'fetch_failed');
                        continue;
                    }

                    // Skip transactions with fewer than 8 confirmations (pick up next cycle)
                    if (!tx.confirmations || tx.confirmations < 8) {
                        log.info({ txid: txid.substring(0, 10), confirmations: tx.confirmations }, 'Skipping %s - only %d confirmations', txid.substring(0, 10), tx.confirmations);
                        continue;
                    }

                    // Extract app name via OP_RETURN -> permanentmessages lookup
                    const appHash = extractAppHashFromTx(tx);
                    const appName = appHash ? lookupAppName(appHash) : null;
                    const appType = appName ? lookupAppType(appName) : null;

                    const payments = processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType, priceMap);
                    pendingPayments.push(...payments);

                    // Mark as resolved if it was previously failed
                    await resolveFailedTxid(txid);

                    if (payments.length > 0) {
                        log.info({ txid: txid.substring(0, 10), amount: payments[0].amount.toFixed(4), appName }, 'Payment in %s: %s FLUX%s', txid.substring(0, 10), payments[0].amount.toFixed(4), appName ? ` (${appName})` : '');
                    }
                }

                // Flush to DB every DB_FLUSH_SIZE payments so the UI can show partial data
                if (pendingPayments.length >= DB_FLUSH_SIZE) {
                    await flushPending();
                    if (syncAborted) break;
                }

                // Small delay between batches to be API-friendly
                if (i + BATCH_SIZE < txids.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            // Flush any remaining payments for this address before moving to the next
            if (!syncAborted) await flushPending();
        }

        // 6b. Retry previously failed txids from the DB.
        //     This catches txids that were missed when the sync cursor advanced past their block range.
        if (!syncAborted) {
            const failedList = await getUnresolvedFailedTxids(200);
            if (failedList.length > 0) {
                log.info({ count: failedList.length }, 'Retrying %d previously failed txids', failedList.length);
                let recovered = 0;
                for (let i = 0; i < failedList.length; i += BATCH_SIZE) {
                    const batch = failedList.slice(i, i + BATCH_SIZE);
                    const txResults = await Promise.all(
                        batch.map(f => fetchRawTransaction(f.txid))
                    );
                    for (let j = 0; j < batch.length; j++) {
                        const { txid, address: failedAddr } = batch[j];
                        const tx = txResults[j];

                        if (!tx) {
                            await upsertFailedTxid(txid, failedAddr, 'fetch_failed');
                            continue;
                        }

                        if (!tx.confirmations || tx.confirmations < 8) continue;

                        const appHash = extractAppHashFromTx(tx);
                        const appName = appHash ? lookupAppName(appHash) : null;
                        const appType = appName ? lookupAppType(appName) : null;

                        const payments = processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType, priceMap);
                        pendingPayments.push(...payments);
                        await resolveFailedTxid(txid);

                        if (payments.length > 0) {
                            recovered++;
                            log.info({ txid: txid.substring(0, 10), amount: payments[0].amount.toFixed(4) }, 'Recovered %s: %s FLUX', txid.substring(0, 10), payments[0].amount.toFixed(4));
                        }
                    }

                    if (i + BATCH_SIZE < failedList.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                if (recovered > 0) {
                    log.info({ recovered }, 'Recovered %d previously failed transactions', recovered);
                }
            }
        }

        // 7. Final flush (catches any remainder < DB_FLUSH_SIZE)
        if (!syncAborted) await flushPending();

        if (totalNewPayments === 0) {
            log.info('No new transactions found (database is up to date)');
        }

        // 8. Update sync status — don't advance past failed chunks or aborted syncs
        if (syncAborted) {
            log.warn('Sync aborted due to database error -- last_sync_block NOT updated');
        } else if (lowestFailedBlock !== null) {
            const safeBlock = lowestFailedBlock - 1;
            log.warn({ safeBlock, lowestFailedBlock }, 'Some API chunks failed -- advancing last_sync_block only to %d (failed at block %d)', safeBlock, lowestFailedBlock);
            await updateSyncStatus('revenue', 'completed', null, safeBlock);
        } else {
            await updateSyncStatus('revenue', 'completed', null, currentBlock);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const totalTxCount = await getTxidCount();
        log.info({ duration, newPayments: totalNewPayments, total: totalTxCount }, 'Block-range sync complete: duration=%ss, new payments=%d, total=%d', duration, totalNewPayments, totalTxCount);

        const failedStats = await getFailedTxStats();
        if (failedStats.totalFailed > 0) {
            log.info({ failedTxids: failedStats.totalFailed }, 'Failed txids: %d (will retry)', failedStats.totalFailed);
        }

        return {
            success: true,
            newPayments: totalNewPayments,
            txsChecked: 0,
            duration,
            failedTxids: failedStats.totalFailed
        };

    } catch (error) {
        log.error({ err: error }, 'Block-range sync error');
        throw error;
    }
}

// ============================================
// DAILY AUDIT — catch missed transactions
// ============================================

const AUDIT_LOOKBACK_BLOCKS = REVENUE_SYNC.AUDIT_LOOKBACK_BLOCKS;

/**
 * Audit recent transactions by re-fetching txids from the API and comparing against DB.
 * Recovers any missed transactions without a full resync.
 */
export async function auditRecentTransactions() {
    log.info('Starting transaction audit');
    const startTime = Date.now();

    try {
        const fluxPrice = await fetchFluxPrice();
        const priceMap = await buildFullPriceMap();
        const currentBlock = await fetchCurrentBlockHeight();
        const auditStart = Math.max(1, currentBlock - AUDIT_LOOKBACK_BLOCKS);

        log.info({ auditStart, currentBlock, lookbackBlocks: AUDIT_LOOKBACK_BLOCKS }, 'Audit range: %d -> %d (%d blocks)', auditStart, currentBlock, AUDIT_LOOKBACK_BLOCKS);

        await ensurePermanentMessagesCache();

        let totalProcessed = 0;
        let recovered = 0;

        for (const address of TARGET_ADDRESSES) {
            const { txids } = await fetchAddressTxidsInRange(address, auditStart, currentBlock);
            if (!txids || txids.length === 0) continue;

            totalProcessed += txids.length;
            log.info({ count: txids.length, address: address.substring(0, 15) }, 'Audit: checking %d txids for %s', txids.length, address.substring(0, 15));

            // Process transactions in small batches (dedup handled by ON CONFLICT DO NOTHING)
            const auditBatch = REVENUE_SYNC.AUDIT_BATCH_SIZE;
            for (let i = 0; i < txids.length; i += auditBatch) {
                const batch = txids.slice(i, i + auditBatch);
                const txResults = await Promise.all(batch.map(txid => fetchRawTransaction(txid)));
                const payments = [];

                for (let j = 0; j < batch.length; j++) {
                    const tx = txResults[j];
                    if (!tx || !tx.confirmations || tx.confirmations < 8) continue;

                    const appHash = extractAppHashFromTx(tx);
                    const appName = appHash ? lookupAppName(appHash) : null;
                    const appType = appName ? lookupAppType(appName) : null;

                    payments.push(...processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType, priceMap));
                }

                if (payments.length > 0) {
                    const writeOk = await insertTransactionsBatch(payments);
                    if (writeOk !== false) {
                        recovered += payments.length;
                    }
                }

                if (i + auditBatch < txids.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        log.info({ totalProcessed, recovered, duration }, 'Audit complete: processed=%d, recovered=%d, duration=%ss', totalProcessed, recovered, duration);

        return { success: true, totalProcessed, recovered, duration };

    } catch (error) {
        log.error({ err: error }, 'Audit error');
        return { success: false, totalProcessed: 0, recovered: 0, duration: ((Date.now() - startTime) / 1000).toFixed(2), error: error.message };
    }
}

/**
 * Initial sync - for first-time setup (processes all history)
 * This is different from progressive sync - it tries to get everything
 */
export async function initialSync() {
    setRevenueSyncRunning(true);

    try {
        log.info('Starting initial full sync (one-time setup)');
        log.info('This will take a while if you have many transactions');

        // Fetch FLUX price first
        log.info('Fetching FLUX price');
        await fetchFluxPrice();

        // Keep running progressive sync until no new transactions found
        let totalImported = 0;
        let continueSync = true;
        let iterations = 0;

        while (continueSync) {
            iterations++;
            log.info({ iteration: iterations }, 'Initial sync iteration %d', iterations);

            const result = await progressiveSync();

            totalImported += result.newPayments;

            if (result.newPayments === 0) {
                log.info('All historical transactions imported');
                continueSync = false;
            } else {
                log.info({ totalImported }, 'Progress: %d total transactions imported so far', totalImported);
                log.info('Waiting 2 seconds before next batch');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        const totalInDb = await getTxidCount();
        log.info({ totalImported, iterations, totalInDb }, 'Initial sync complete: imported=%d, iterations=%d, total in DB=%d', totalImported, iterations, totalInDb);

        setRevenueSyncRunning(false);
        return {
            success: true,
            totalImported,
            iterations
        };

    } catch (error) {
        log.error({ err: error }, 'Initial sync failed');
        setRevenueSyncError(error);
        setRevenueSyncRunning(false);
        await updateSyncStatus('revenue', 'failed', error.message, null);
        throw error;
    }
}

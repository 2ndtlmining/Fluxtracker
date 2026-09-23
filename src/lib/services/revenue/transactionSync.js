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
import { syncPriceHistory, buildFullPriceMap, repairTodaysNullUsd } from '../priceHistoryService.js';
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

// A payment for FluxDrive rather than for an app (issue #188).
//
// FluxDrive payments carry an OP_RETURN too, but it is an order reference, not an app spec
// hash -- nothing in globalappsspecifications or permanentmessages resolves it (checked
// against the full permanentmessages dump: zero occurrences of "fluxdrive", and a hash query
// for the string returns an empty result). So these rows can never be NAMED; they can only
// be CLASSIFIED, which is what separates them from a failed lookup.
//
// The pattern is deliberately EXACT rather than a loose prefix test, because the
// classification is inferred from on-chain behaviour rather than from any documented Flux
// convention: the literal uppercase tag followed by exactly 24 lowercase base36 characters.
// All 129 payments observed across two years of history match that shape, each with a
// distinct suffix -- a per-payment order id, never reused. Anything that merely starts with
// the tag but is shaped differently stays unclassified rather than being labelled on a guess.
const FLUXDRIVE_OP_RETURN = /^FLUXDRIVE[0-9a-z]{24}$/;

/** Value stored in revenue_transactions.app_type for a FluxDrive payment. */
export const FLUXDRIVE_APP_TYPE = 'fluxdrive';

/**
 * Decode a transaction OP_RETURN and say what kind of payment it is.
 *
 * ONE decoder for the whole sync: the four call sites that used to repeat
 * extract-then-look-up ask this instead, so a new payment kind is added here and nowhere
 * else.
 *
 * @param {object} tx raw transaction
 * @returns {{kind: 'hash'|'fluxdrive'|'none', value: ?string}}
 *   hash      -- an app spec hash, resolvable to an app name
 *   fluxdrive -- a FluxDrive payment; value is the order reference, which resolves to
 *                nothing and is not stored
 *   none      -- no OP_RETURN, or one we cannot classify with confidence
 */
export function classifyOpReturn(tx) {
    if (!tx || !tx.vout) return { kind: 'none', value: null };

    for (const vout of tx.vout) {
        if (vout.scriptPubKey && vout.scriptPubKey.type === 'nulldata') {
            const hex = vout.scriptPubKey.hex || '';
            // Skip OP_RETURN opcode (6a) + length byte = 4 hex chars
            if (hex.length > 4 && hex.startsWith('6a')) {
                const dataHex = hex.substring(4);
                try {
                    const decoded = Buffer.from(dataHex, 'hex').toString('utf8').trim();
                    if (/^[0-9a-f]{64}$/i.test(decoded)) {
                        return { kind: 'hash', value: decoded.toLowerCase() };
                    }
                    if (FLUXDRIVE_OP_RETURN.test(decoded)) {
                        return { kind: 'fluxdrive', value: decoded };
                    }
                } catch (e) {
                    // ignore parse errors
                }
            }
        }
    }
    return { kind: 'none', value: null };
}

/**
 * Extract app hash from OP_RETURN output of a transaction.
 * Thin wrapper over classifyOpReturn for callers that only care about the app-spec case.
 */
export function extractAppHashFromTx(tx) {
    const { kind, value } = classifyOpReturn(tx);
    return kind === 'hash' ? value : null;
}

/**
 * Look up app name from hash — permanentMessages first, globalSpecs (shared cache) as fallback
 */
export function lookupAppName(hash) {
    if (!hash) return null;
    return permanentMessagesCache.map.get(hash) || getAppNameByHash(hash) || null;
}

// ── Targeted hash lookup (issue: new deployments sat unnamed for up to an hour) ──────────
//
// The cached permanentmessages map has a 1h TTL, so an app registered two minutes ago is not
// in it and its transaction was stored with app_name = NULL until the cache next refreshed.
// The API answers a single-hash query directly -- permanentmessages?hash=<hash> returns just
// that app's message -- so a cache miss no longer has to wait for the whole map.
//
// Two bounds keep this from becoming a request amplifier, because backfillAppNames retries
// every unnamed transaction of the last 30 days on every sync pass:
//
//   1. Only for RECENT transactions. An old hash missing from a full, fresh map is not
//      going to appear because we asked about it individually -- it is gone (expired or
//      never propagated). Only a just-registered app benefits.
//   2. A negative cache. A hash the API does not know is not asked about again for 30
//      minutes, so one unresolvable payment costs one request per half hour, not one per
//      sync pass forever.
const TARGETED_LOOKUP_MAX_TX_AGE_MS = 24 * 60 * 60 * 1000;
const MISSED_HASH_RETRY_MS = 30 * 60 * 1000;
const missedHashes = new Map(); // hash -> when the targeted lookup last came back empty

/** Test seam -- clears the negative cache. */
export function resetMissedHashes() {
    missedHashes.clear();
}

/**
 * Ask the API about ONE hash and fold the answer into the cache. Returns the app name, or
 * null when the API does not know it (yet).
 */
export async function fetchPermanentMessageByHash(hash) {
    // The hash goes into a URL, so re-validate its shape here rather than trusting the
    // caller -- extractAppHashFromTx already guarantees it, but this function is exported.
    if (!/^[0-9a-f]{64}$/i.test(hash || '')) return null;

    try {
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/permanentmessages?hash=${hash}`, {
            timeout: 10000,
            breakerKey: 'permanent-message-by-hash'
        });

        if (body?.status !== 'success' || !Array.isArray(body.data) || body.data.length === 0) return null;

        const msg = body.data[0];
        const appSpec = msg.zelAppSpecification || msg.appSpecifications;
        const name = appSpec?.name || msg.name;
        if (!name) return null;

        permanentMessagesCache.map.set(hash, name);
        permanentMessagesCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
        log.info({ hash: hash.substring(0, 10), name }, 'Resolved app name by targeted lookup: %s', name);
        return name;
    } catch (error) {
        log.warn({ err: error, hash: hash.substring(0, 10) }, 'Targeted permanentmessages lookup failed');
        return null;
    }
}

/**
 * The name for a hash: cache first, then a single targeted API call for a recent
 * transaction whose app the cached map has not seen yet.
 *
 * @param {?string} hash app spec hash from the transaction's OP_RETURN
 * @param {?number} txTimestamp unix seconds; older than a day skips the targeted call
 */
export async function resolveAppName(hash, txTimestamp = null) {
    if (!hash) return null;

    const cached = lookupAppName(hash);
    if (cached) return cached;

    const ageMs = Number.isFinite(txTimestamp) ? Date.now() - txTimestamp * 1000 : Infinity;
    if (ageMs > TARGETED_LOOKUP_MAX_TX_AGE_MS) return null;

    const lastMiss = missedHashes.get(hash);
    if (lastMiss && Date.now() - lastMiss < MISSED_HASH_RETRY_MS) return null;

    const name = await fetchPermanentMessageByHash(hash);
    if (!name) {
        missedHashes.set(hash, Date.now());
        return null;
    }

    missedHashes.delete(hash);
    return name;
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
        // Failed txids whose payments are in pendingPayments. Resolved only AFTER the write
        // lands (issue #315): resolving first meant a failed final write lost the recovered
        // payments for good -- the txid read as done, and it sits outside the rescan overlap.
        let pendingResolves = [];
        let totalNewPayments = 0;
        const DB_FLUSH_SIZE = REVENUE_SYNC.DB_FLUSH_SIZE;
        let syncAborted = false;
        let lowestFailedBlock = null;

        // Helper: flush pending payments to DB so they become visible immediately
        async function flushPending() {
            if (pendingPayments.length > 0) {
                const writeOk = await insertTransactionsBatch(pendingPayments);
                if (writeOk === false) {
                    log.error('Database write error -- aborting sync to avoid data loss');
                    syncAborted = true;
                    return; // pendingResolves stay unresolved, so the next pass retries them
                }
                totalNewPayments += pendingPayments.length;
                log.info({ flushed: pendingPayments.length, totalSoFar: totalNewPayments }, 'Flushed %d payments to DB (total so far: %d)', pendingPayments.length, totalNewPayments);
                pendingPayments = [];
            }
            for (const txid of pendingResolves) await resolveFailedTxid(txid);
            pendingResolves = [];
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

                    // Classify the OP_RETURN, then resolve a name for the app-spec case. An
                    // app registered minutes ago is not in the cached map yet, so a miss on a
                    // recent transaction falls through to a single targeted query rather than
                    // leaving the row unnamed until the next hourly cache refresh. A FluxDrive
                    // payment has no name to find -- it carries its type instead.
                    const opReturn = classifyOpReturn(tx);
                    const appName = opReturn.kind === 'hash' ? await resolveAppName(opReturn.value, tx.blocktime) : null;
                    const appType = opReturn.kind === 'fluxdrive'
                        ? FLUXDRIVE_APP_TYPE
                        : (appName ? lookupAppType(appName) : null);

                    const payments = processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType, priceMap);
                    pendingPayments.push(...payments);

                    // Mark as resolved if it was previously failed -- once flushed (#315)
                    pendingResolves.push(txid);

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
            // The retry pass is best-effort: a failed read of the retry list (#307: reads now
            // throw) skips it for this pass instead of failing a sync whose main work is done.
            const failedList = await getUnresolvedFailedTxids(200).catch(error => {
                log.warn({ err: error }, 'Could not read failed txids -- skipping the retry pass');
                return [];
            });
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

                        const opReturn = classifyOpReturn(tx);
                        const appName = opReturn.kind === 'hash' ? await resolveAppName(opReturn.value, tx.blocktime) : null;
                        const appType = opReturn.kind === 'fluxdrive'
                            ? FLUXDRIVE_APP_TYPE
                            : (appName ? lookupAppType(appName) : null);

                        const payments = processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType, priceMap);
                        pendingPayments.push(...payments);
                        pendingResolves.push(txid); // resolved once flushed (#315)

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

        // 8b. Re-price any of TODAY's transactions that a previous pass left unpriced
        // because its live price fetch failed (issue #183). Today is the only day the
        // date-based backfill cannot help with -- flux_price_history excludes the current
        // day -- so without this those rows stay NULL until tomorrow. Isolated: a repair
        // failure must never fail a sync that otherwise succeeded.
        if (fluxPrice) {
            try {
                await repairTodaysNullUsd(fluxPrice);
            } catch (repairErr) {
                log.warn({ err: repairErr }, 'Same-day USD repair failed (non-fatal)');
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        // Informational only -- the sync's writes and cursor are already done. Since #307 a
        // failed read throws, and a log line must not turn a completed sync into a failed one.
        const totalTxCount = await getTxidCount().catch(() => null);
        log.info({ duration, newPayments: totalNewPayments, total: totalTxCount }, 'Block-range sync complete: duration=%ss, new payments=%d, total=%d', duration, totalNewPayments, totalTxCount);

        const failedStats = await getFailedTxStats().catch(() => ({ totalFailed: null }));
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

                    const opReturn = classifyOpReturn(tx);
                    const appName = opReturn.kind === 'hash' ? await resolveAppName(opReturn.value, tx.blocktime) : null;
                    const appType = opReturn.kind === 'fluxdrive'
                        ? FLUXDRIVE_APP_TYPE
                        : (appName ? lookupAppType(appName) : null);

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

        const totalInDb = await getTxidCount().catch(() => null); // informational (#307)
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

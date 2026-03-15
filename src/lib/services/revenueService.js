import axios from 'axios';
import { API_ENDPOINTS, TARGET_ADDRESSES, EXCLUDED_TRANSACTIONS } from '../config.js';
import {
    updateCurrentMetrics,
    updateSyncStatus,
    getSyncStatus,
    insertTransactionsBatch,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getTxidCount,
    getUndeterminedAppNames,
    updateAppTypeForAppName,
    getTxidsWithoutAppName,
    countTxidsWithoutAppName,
    updateAppNameForTxid,
    upsertFailedTxid,
    getUnresolvedFailedTxids,
    resolveFailedTxid,
    getFailedTxidCount,
    clearAbandonedFailedTxids,
    isFailedTxid
} from '../db/database.js';
import { syncPriceHistory, buildFullPriceMap } from './priceHistoryService.js';

// ============================================
// STATE TRACKING
// ============================================
let revenueSyncState = {
    isRunning: false,
    lastStarted: null,
    lastCompleted: null,
    currentBlock: null,
    lastError: null
};

// ============================================
// FAILED TRANSACTION TRACKING (DB-backed)
// ============================================
// Failed txids are now persisted to the failed_txids table in the database.
// This ensures they survive process restarts and are retried every sync cycle.
// See database.js for CRUD functions: upsertFailedTxid, getUnresolvedFailedTxids,
// resolveFailedTxid, getFailedTxidCount, isFailedTxid

/**
 * Get failed transaction statistics (compatible wrapper for existing call sites)
 */
export async function getFailedTxStats() {
    return { totalFailed: await getFailedTxidCount() };
}

/**
 * Clear old resolved failed txids (compatible wrapper — called daily by server.js)
 */
export async function clearPermanentlyFailedTxids() {
    return await clearAbandonedFailedTxids(30);
}

/**
 * Get current revenue sync state
 */
export function getRevenueSyncState() {
    return { ...revenueSyncState };
}

/**
 * Set revenue sync state
 */
function setRevenueSyncRunning(isRunning, currentBlock = null) {
    revenueSyncState.isRunning = isRunning;
    
    if (isRunning) {
        revenueSyncState.lastStarted = Date.now();
        revenueSyncState.currentBlock = currentBlock;
    } else {
        revenueSyncState.lastCompleted = Date.now();
        revenueSyncState.currentBlock = null;
    }
}

/**
 * Set revenue sync error
 */
function setRevenueSyncError(error) {
    revenueSyncState.lastError = {
        message: error.message,
        timestamp: Date.now()
    };
}

/**
 * Check if revenue sync is currently running
 */
export function isRevenueSyncRunning() {
    return revenueSyncState.isRunning;
}

/**
 * Get time since last revenue sync completion
 */
export function getTimeSinceLastSync() {
    if (!revenueSyncState.lastCompleted) {
        return null;
    }
    return Date.now() - revenueSyncState.lastCompleted;
}

// ============================================
// PRICE FETCHING
// ============================================

/**
 * Fetch FLUX price in USD.
 * Tries three sources in order: CoinGecko → Flux Explorer → CryptoCompare
 */
export async function fetchFluxPrice() {
    console.log('Fetching FLUX price...');

    // 1. CoinGecko
    try {
        const response = await axios.get(API_ENDPOINTS.PRICE_COINGECKO, { timeout: 10000 });
        if (response.data?.zelcash?.usd) {
            const price = response.data.zelcash.usd;
            console.log(`FLUX Price (CoinGecko): $${price}`);
            await updateCurrentMetrics({ flux_price_usd: price });
            return price;
        }
    } catch (e) {
        console.warn(`CoinGecko failed: ${e.message}`);
    }

    // 2. Flux Explorer  (returns { status:200, currency:"USD", rate:X })
    try {
        const response = await axios.get(API_ENDPOINTS.PRICE_EXPLORER, { timeout: 10000 });
        if (response.data?.rate) {
            const price = parseFloat(response.data.rate);
            if (price > 0) {
                console.log(`FLUX Price (Explorer): $${price}`);
                await updateCurrentMetrics({ flux_price_usd: price });
                return price;
            }
        }
    } catch (e) {
        console.warn(`Flux Explorer price failed: ${e.message}`);
    }

    // 3. CryptoCompare  (returns { USD: X })
    try {
        const response = await axios.get(API_ENDPOINTS.PRICE_CRYPTOCOMPARE, { timeout: 10000 });
        if (response.data?.USD) {
            const price = parseFloat(response.data.USD);
            if (price > 0) {
                console.log(`FLUX Price (CryptoCompare): $${price}`);
                await updateCurrentMetrics({ flux_price_usd: price });
                return price;
            }
        }
    } catch (e) {
        console.warn(`CryptoCompare failed: ${e.message}`);
    }

    console.warn('All price sources failed — USD values will be null');
    return null;
}

// ============================================
// BLOCKCHAIN DATA FETCHING
// ============================================

/**
 * Fetch current block height
 */
export async function fetchCurrentBlockHeight() {
    try {
        const response = await axios.get(
            `${API_ENDPOINTS.DAEMON}/getblockcount`,
            { timeout: 10000 }
        );
        
        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }
        
        throw new Error('Failed to fetch block height');
        
    } catch (error) {
        console.error('❌ Error fetching block height:', error.message);
        throw error;
    }
}

const TXID_CHUNK_SIZE = 50000; // blocks per API call — conservative to avoid public API timeouts

/**
 * Fetch transaction IDs for an address within a block range using Flux daemon API.
 * Automatically chunks large ranges to avoid API timeouts.
 */
async function fetchAddressTxidsInRange(address, startBlock, endBlock) {
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
        console.log(`Splitting ${totalBlocks.toLocaleString()} blocks into ${chunks.length} chunks of ${TXID_CHUNK_SIZE.toLocaleString()}`);
    }

    let failedFromBlock = null;

    for (const [from, to] of chunks) {
        const MAX_RETRIES = 3;
        let chunkSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const url = `${API_ENDPOINTS.DAEMON}/getaddresstxids/${address}/${from}/${to}`;

                const response = await axios.get(url, { timeout: 60000 });

                if (response.data && response.data.status === 'success' && Array.isArray(response.data.data)) {
                    const count = response.data.data.length;
                    if (count > 0) {
                        console.log(`  blocks ${from}-${to}: ${count} txids found`);
                    }
                    allTxids.push(...response.data.data);
                    chunkSuccess = true;
                    break;
                } else {
                    console.warn(`  blocks ${from}-${to}: unexpected response (attempt ${attempt}/${MAX_RETRIES}) — status: ${response.data?.status}, msg: ${JSON.stringify(response.data?.data ?? response.data)}`);
                }
            } catch (error) {
                console.error(`  blocks ${from}-${to}: ERROR (attempt ${attempt}/${MAX_RETRIES}) - ${error.message}`);
            }

            // Exponential backoff before retry: 2s, 4s, 8s
            if (attempt < MAX_RETRIES) {
                const backoffMs = Math.pow(2, attempt) * 1000;
                console.log(`  Retrying in ${backoffMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
        }

        if (!chunkSuccess) {
            console.error(`  blocks ${from}-${to}: PERMANENTLY FAILED after ${MAX_RETRIES} attempts — txids from this range will be missing`);
            if (failedFromBlock === null || from < failedFromBlock) {
                failedFromBlock = from;
            }
        }

        // Small delay between chunks to be API-friendly
        if (chunks.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    console.log(`Total txids fetched for ${address.substring(0, 15)}: ${allTxids.length}`);
    return { txids: allTxids, failedFromBlock };
}

/**
 * Fetch raw transaction details from Flux daemon with retry logic
 */
async function fetchRawTransaction(txid, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const url = `${API_ENDPOINTS.DAEMON}/getrawtransaction/${txid}/1`;
            const response = await axios.get(url, { timeout: 15000 });

            if (response.data && response.data.status === 'success') {
                return response.data.data;
            }

            return null;
        } catch (error) {
            if (attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.warn(`Retry ${attempt}/${retries} for tx ${txid.substring(0, 10)} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`Failed to fetch tx ${txid.substring(0, 10)} after ${retries} attempts`);
                return null;
            }
        }
    }
    return null;
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

// Secondary fallback: globalappsspecifications (hash -> name + type)
const globalSpecsCache = {
    map: new Map(),      // hash -> name
    typeMap: new Map(),  // name (lowercase) -> 'git' | 'docker'
    lastFetched: 0,
    TTL: 60 * 60 * 1000
};

async function fetchGlobalSpecs() {
    try {
        const response = await axios.get(`${API_ENDPOINTS.APPS}/globalappsspecifications`, { timeout: 30000 });
        if (response.data && response.data.status === 'success' && Array.isArray(response.data.data)) {
            globalSpecsCache.map.clear();
            globalSpecsCache.typeMap.clear();
            for (const appSpec of response.data.data) {
                const hash = appSpec.hash;
                const name = appSpec.name;
                if (hash && name) {
                    globalSpecsCache.map.set(hash, name);
                    globalSpecsCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            globalSpecsCache.lastFetched = Date.now();
            console.log(`Loaded ${globalSpecsCache.map.size} app names from global specs`);
        }
    } catch (error) {
        console.warn(`Failed to fetch global specs: ${error.message}`);
    }
}

/**
 * Determine if an app is git-based (runonflux/Orbit) or docker-based.
 * Works with both old single-component and new compose-array spec formats.
 */
function determineAppType(appSpec) {
    if (!appSpec) return 'docker';

    // New compose format: array of components each with a repotag
    if (Array.isArray(appSpec.compose)) {
        const isGit = appSpec.compose.some(
            c => c.repotag && c.repotag.toLowerCase().includes('runonflux/orbit')
        );
        return isGit ? 'git' : 'docker';
    }

    // Old single-component format: repotag directly on spec
    if (appSpec.repotag && appSpec.repotag.toLowerCase().includes('runonflux/orbit')) {
        return 'git';
    }

    return 'docker';
}

async function fetchPermanentMessages() {
    try {
        console.log('Fetching permanent messages for app name lookup...');
        const response = await axios.get(`${API_ENDPOINTS.APPS}/permanentmessages`, { timeout: 30000 });

        if (response.data && response.data.status === 'success' && Array.isArray(response.data.data)) {
            permanentMessagesCache.map.clear();
            permanentMessagesCache.typeMap.clear();
            for (const msg of response.data.data) {
                const hash = msg.hash;
                const appSpec = msg.zelAppSpecification || msg.appSpecifications;
                const name = appSpec?.name || msg.name;
                if (hash && name) {
                    permanentMessagesCache.map.set(hash, name);
                    permanentMessagesCache.typeMap.set(name.toLowerCase(), determineAppType(appSpec));
                }
            }
            permanentMessagesCache.lastFetched = Date.now();
            console.log(`Loaded ${permanentMessagesCache.map.size} app names from permanent messages`);
        }
    } catch (error) {
        console.warn(`Failed to fetch permanent messages: ${error.message}`);
    }
}

async function ensurePermanentMessagesCache() {
    const pmAge = Date.now() - permanentMessagesCache.lastFetched;
    const gsAge = Date.now() - globalSpecsCache.lastFetched;
    const fetches = [];
    if (pmAge > permanentMessagesCache.TTL || permanentMessagesCache.map.size === 0) {
        fetches.push(fetchPermanentMessages());
    }
    if (gsAge > globalSpecsCache.TTL || globalSpecsCache.map.size === 0) {
        fetches.push(fetchGlobalSpecs());
    }
    if (fetches.length > 0) await Promise.all(fetches);
}

/**
 * Extract app hash from OP_RETURN output of a transaction
 */
function extractAppHashFromTx(tx) {
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
 * Look up app name from hash — permanentMessages first, globalSpecs as fallback
 */
function lookupAppName(hash) {
    if (!hash) return null;
    return permanentMessagesCache.map.get(hash) || globalSpecsCache.map.get(hash) || null;
}

/**
 * Look up app type (git/docker) by app name
 */
function lookupAppType(appName) {
    if (!appName) return null;
    return permanentMessagesCache.typeMap.get(appName.toLowerCase())
        || globalSpecsCache.typeMap.get(appName.toLowerCase())
        || null;
}

// ============================================
// TRANSACTION PROCESSING
// ============================================

/**
 * Process transaction and extract revenue for our tracked addresses.
 * Expects Flux daemon getrawtransaction format (vout.value already in FLUX).
 */
function processTransaction(tx, trackedAddresses, fluxPriceUSD = null, appName = null, appType = null, priceMap = null) {
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
    console.log('\nStarting BLOCK-RANGE SYNC...\n');

    const startTime = Date.now();
    const BATCH_SIZE = 10;

    try {
        // 1. Sync historical price data (fast no-op if already current)
        try {
            await syncPriceHistory();
        } catch (priceErr) {
            console.warn('Price history sync failed (non-fatal):', priceErr.message);
        }

        // 1b. Fetch live FLUX price
        const fluxPrice = await fetchFluxPrice();
        if (fluxPrice) {
            console.log(`FLUX price: $${fluxPrice.toFixed(4)}`);
        } else {
            console.warn('Could not fetch FLUX price - USD values will be null');
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

        console.log(`Block range: ${startBlock} -> ${currentBlock} (${currentBlock - startBlock} blocks)`);

        // 4. Ensure app name cache is fresh
        await ensurePermanentMessagesCache();

        let pendingPayments = [];   // buffer between DB flushes
        let totalNewPayments = 0;
        const DB_FLUSH_SIZE = 200;  // write to DB every 200 payments so graphs update progressively
        let syncAborted = false;
        let lowestFailedBlock = null;

        // Helper: flush pending payments to DB so they become visible immediately
        async function flushPending() {
            if (pendingPayments.length === 0) return;
            const writeOk = await insertTransactionsBatch(pendingPayments);
            if (writeOk === false) {
                console.error('Database write error — aborting sync to avoid data loss');
                syncAborted = true;
                return;
            }
            totalNewPayments += pendingPayments.length;
            console.log(`  Flushed ${pendingPayments.length} payments to DB (total so far: ${totalNewPayments})`);
            pendingPayments = [];
        }

        // 6. Process each tracked address
        for (const address of TARGET_ADDRESSES) {
            if (syncAborted) break;

            console.log(`\nFetching txids for ${address.substring(0, 20)}...`);

            const { txids, failedFromBlock } = await fetchAddressTxidsInRange(address, startBlock, currentBlock);

            // Track the lowest failed block across all addresses
            if (failedFromBlock !== null && (lowestFailedBlock === null || failedFromBlock < lowestFailedBlock)) {
                lowestFailedBlock = failedFromBlock;
            }

            if (!txids || txids.length === 0) {
                console.log('No transactions found in range');
                continue;
            }

            console.log(`Found ${txids.length} transactions to process`);

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
                        console.log(`Skipping ${txid.substring(0, 10)} - only ${tx.confirmations} confirmations`);
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
                        console.log(`Payment in ${txid.substring(0, 10)}: ${payments[0].amount.toFixed(4)} FLUX${appName ? ` (${appName})` : ''}`);
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
                console.log(`\nRetrying ${failedList.length} previously failed txids...`);
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
                            console.log(`  Recovered ${txid.substring(0, 10)}: ${payments[0].amount.toFixed(4)} FLUX`);
                        }
                    }

                    if (i + BATCH_SIZE < failedList.length) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
                if (recovered > 0) {
                    console.log(`  Recovered ${recovered} previously failed transactions`);
                }
            }
        }

        // 7. Final flush (catches any remainder < DB_FLUSH_SIZE)
        if (!syncAborted) await flushPending();

        if (totalNewPayments === 0) {
            console.log('\nNo new transactions found (database is up to date)');
        }

        // 8. Update sync status — don't advance past failed chunks or aborted syncs
        if (syncAborted) {
            console.warn('Sync aborted due to database error — last_sync_block NOT updated');
        } else if (lowestFailedBlock !== null) {
            const safeBlock = lowestFailedBlock - 1;
            console.warn(`Some API chunks failed — advancing last_sync_block only to ${safeBlock} (failed at block ${lowestFailedBlock})`);
            await updateSyncStatus('revenue', 'completed', null, safeBlock);
        } else {
            await updateSyncStatus('revenue', 'completed', null, currentBlock);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\nBLOCK-RANGE SYNC COMPLETE`);
        console.log(`  Duration: ${duration}s | New payments: ${totalNewPayments} | Total: ${await getTxidCount()}`);

        const failedStats = await getFailedTxStats();
        if (failedStats.totalFailed > 0) {
            console.log(`  Failed txids: ${failedStats.totalFailed} (will retry)`);
        }

        return {
            success: true,
            newPayments: totalNewPayments,
            txsChecked: 0,
            duration,
            failedTxids: failedStats.totalFailed
        };

    } catch (error) {
        console.error('Block-range sync error:', error.message);
        throw error;
    }
}

// ============================================
// DAILY AUDIT — catch missed transactions
// ============================================

const AUDIT_LOOKBACK_BLOCKS = 4320; // ~3 days of blocks

/**
 * Audit recent transactions by re-fetching txids from the API and comparing against DB.
 * Recovers any missed transactions without a full resync.
 */
export async function auditRecentTransactions() {
    console.log('\nStarting TRANSACTION AUDIT...\n');
    const startTime = Date.now();

    try {
        const fluxPrice = await fetchFluxPrice();
        const priceMap = await buildFullPriceMap();
        const currentBlock = await fetchCurrentBlockHeight();
        const auditStart = Math.max(1, currentBlock - AUDIT_LOOKBACK_BLOCKS);

        console.log(`Audit range: ${auditStart} -> ${currentBlock} (${AUDIT_LOOKBACK_BLOCKS} blocks)`);

        await ensurePermanentMessagesCache();

        let totalProcessed = 0;
        let recovered = 0;

        for (const address of TARGET_ADDRESSES) {
            const { txids } = await fetchAddressTxidsInRange(address, auditStart, currentBlock);
            if (!txids || txids.length === 0) continue;

            totalProcessed += txids.length;
            console.log(`Audit: checking ${txids.length} txids for ${address.substring(0, 15)}`);

            // Process transactions in small batches (dedup handled by ON CONFLICT DO NOTHING)
            const BATCH_SIZE = 10;
            for (let i = 0; i < txids.length; i += BATCH_SIZE) {
                const batch = txids.slice(i, i + BATCH_SIZE);
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

                if (i + BATCH_SIZE < txids.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\nAUDIT COMPLETE — processed: ${totalProcessed}, recovered: ${recovered}, duration: ${duration}s\n`);

        return { success: true, totalProcessed, recovered, duration };

    } catch (error) {
        console.error('Audit error:', error.message);
        return { success: false, totalProcessed: 0, recovered: 0, duration: ((Date.now() - startTime) / 1000).toFixed(2), error: error.message };
    }
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
    console.log(`🔄 Backfilling app_type for ${appNames.length} distinct app names...`);

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

    console.log(`✅ app_type backfill complete: ${updated} updated, ${unknown} unknown (no spec found)`);
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

    console.log(`🔄 Backfilling app_name for ${txids.length} of ${total} transactions with no app_name...`);

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
    console.log(`✅ app_name backfill complete: ${updated} updated, ${noHash} no OP_RETURN hash, ${noName} hash not in cache, ${fetchErrors} fetch errors`);
    console.log(`   Remaining NULL app_name rows: ~${remaining}`);
    return { total, processed: txids.length, updated, noHash, noName, fetchErrors, remaining };
}

// ============================================
// REVENUE CALCULATION
// ============================================

/**
 * Calculate today's revenue from database
 */
async function calculateDailyRevenue() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const revenue = await getRevenueForDateRange(today, today);

        console.log(`📊 Today's revenue (${today}): ${revenue.toFixed(2)} FLUX`);

        await updateCurrentMetrics({
            last_update: Date.now(),
            current_revenue: revenue
        });
        
        return revenue;
        
    } catch (error) {
        console.error('❌ Error calculating daily revenue:', error.message);
        throw error;
    }
}

/**
 * Calculate revenue for a specific timeframe
 */
async function calculateRevenueByTimeframe(timeframe = 'day') {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];
        
        let daysAgo;
        switch (timeframe.toLowerCase()) {
            case 'day':
                daysAgo = 1;
                break;
            case 'week':
                daysAgo = 7;
                break;
            case 'month':
                daysAgo = 30;
                break;
            case 'quarter':
                daysAgo = 90;
                break;
            case 'year':
                daysAgo = 365;
                break;
            default:
                daysAgo = 1;
        }
        
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - daysAgo);
        const startDateStr = startDate.toISOString().split('T')[0];
        
        const revenue = await getRevenueForDateRange(startDateStr, today);

        console.log(`📊 ${timeframe.toUpperCase()} Revenue (${startDateStr} to ${today}): ${revenue.toFixed(2)} FLUX`);
        
        return revenue;
        
    } catch (error) {
        console.error(`❌ Error calculating ${timeframe} revenue:`, error.message);
        return 0;
    }
}

/**
 * Get revenue breakdown by timeframe
 */
export async function getRevenueBreakdown() {
    try {
        return {
            day: await calculateRevenueByTimeframe('day'),
            week: await calculateRevenueByTimeframe('week'),
            month: await calculateRevenueByTimeframe('month'),
            quarter: await calculateRevenueByTimeframe('quarter'),
            year: await calculateRevenueByTimeframe('year')
        };
    } catch (error) {
        console.error('❌ Error getting revenue breakdown:', error.message);
        return {
            day: 0,
            week: 0,
            month: 0,
            quarter: 0,
            year: 0
        };
    }
}

/**
 * Fetch all revenue metrics (price + revenue)
 * MAIN ENTRY POINT - Called every 5 minutes by scheduler
 */
export async function fetchRevenueStats() {
    setRevenueSyncRunning(true);
    
    try {
        console.log('🔍 Fetching complete revenue statistics...');
        
        // Fetch price
        const price = await fetchFluxPrice();
        
        // Run progressive sync to import new transactions
        await progressiveSync();

        // Auto-backfill transactions that are still missing app_name.
        // Only looks at the last 30 days — old NULL rows are almost certainly direct
        // payments with no OP_RETURN hash that will never resolve. Use the manual
        // admin endpoint (/api/admin/backfill-app-names) to process all NULLs.
        const AUTO_BACKFILL_DAYS = 30;
        const nullAppNames = await countTxidsWithoutAppName(AUTO_BACKFILL_DAYS);
        if (nullAppNames > 0) {
            console.log(`🔄 Auto-backfilling ${nullAppNames} recent transactions missing app_name...`);
            await backfillAppNames(500, AUTO_BACKFILL_DAYS, true);
        }

        // Auto-backfill missing app_type (git/docker) for transactions that have app_name
        await backfillAppTypes();

        // Calculate daily revenue
        const dailyRevenue = await calculateDailyRevenue();
        
        const revenueData = {
            current_revenue: dailyRevenue,
            flux_price_usd: price
        };
        
        console.log('✅ Revenue stats updated:', revenueData);
        
        setRevenueSyncRunning(false);
        return revenueData;
        
    } catch (error) {
        console.error('❌ Error fetching revenue stats:', error.message);
        setRevenueSyncError(error);
        setRevenueSyncRunning(false);
        await updateSyncStatus('revenue', 'failed', error.message, null);
        throw error;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Format revenue stats for display
 */
export function formatRevenueStats(revenueData, fluxPrice) {
    const revenue = revenueData.current_revenue || 0;
    const price = fluxPrice || revenueData.flux_price_usd || 0;
    const usdValue = revenue * price;
    
    return {
        flux: revenue.toFixed(2) + ' FLUX',
        usd: price > 0 ? '$' + usdValue.toFixed(2) : 'N/A',
        price: price > 0 ? '$' + price.toFixed(4) : 'N/A'
    };
}

/**
 * Get detailed sync status for monitoring
 */
export function getRevenueSyncStatus() {
    return {
        state: { ...revenueSyncState },
        timeSinceLastSync: getTimeSinceLastSync(),
        isHealthy: !revenueSyncState.isRunning && 
                   revenueSyncState.lastCompleted !== null &&
                   getTimeSinceLastSync() < 5 * 60 * 1000
    };
}


/**
 * Initial sync - for first-time setup (processes all history)
 * This is different from progressive sync - it tries to get everything
 */
export async function initialSync() {
    setRevenueSyncRunning(true);
    
    try {
        console.log('🚀 Starting INITIAL FULL SYNC (one-time setup)...');
        console.log('⚠️  This will take a while if you have many transactions\n');
        
        // Fetch FLUX price first
        console.log('💰 Fetching FLUX price...');
        await fetchFluxPrice();
        console.log('');
        
        // Keep running progressive sync until no new transactions found
        let totalImported = 0;
        let continueSync = true;
        let iterations = 0;
        
        while (continueSync) {
            iterations++;
            console.log(`\n🔄 Initial sync iteration ${iterations}...\n`);
            
            const result = await progressiveSync();
            
            totalImported += result.newPayments;
            
            if (result.newPayments === 0) {
                console.log('\n✅ All historical transactions imported!');
                continueSync = false;
            } else {
                console.log(`\n📊 Progress: ${totalImported} total transactions imported so far`);
                console.log('⏳ Waiting 2 seconds before next batch...\n');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`\n✅ INITIAL SYNC COMPLETE`);
        console.log(`   Total transactions imported: ${totalImported}`);
        console.log(`   Iterations: ${iterations}`);
        console.log(`   Total in database: ${await getTxidCount()}\n`);
        
        setRevenueSyncRunning(false);
        return {
            success: true,
            totalImported,
            iterations
        };
        
    } catch (error) {
        console.error('❌ Initial sync failed:', error.message);
        setRevenueSyncError(error);
        setRevenueSyncRunning(false);
        await updateSyncStatus('revenue', 'failed', error.message, null);
        throw error;
    }
}
// ============================================
// MONTHLY REVENUE FUNCTIONS
// ============================================

/**
 * Calculate revenue for the current month (month-to-date)
 */
export async function calculateMonthlyRevenue() {
    try {
        const now = new Date();
        
        // Get first day of current month
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = firstDayOfMonth.toISOString().split('T')[0];
        
        // Get today
        const today = now.toISOString().split('T')[0];
        
        // Calculate revenue for current month
        const revenue = await getRevenueForDateRange(startDate, today);

        console.log(`📊 MONTHLY Revenue (${startDate} to ${today}): ${revenue.toFixed(2)} FLUX`);
        
        return revenue;
        
    } catch (error) {
        console.error('❌ Error calculating monthly revenue:', error.message);
        throw error;
    }
}

/**
 * Calculate revenue for the previous month (for comparison)
 */
export async function calculatePreviousMonthRevenue() {
    try {
        const now = new Date();
        
        // Get first day of previous month
        const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startDate = firstDayOfPrevMonth.toISOString().split('T')[0];
        
        // Get last day of previous month
        const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const endDate = lastDayOfPrevMonth.toISOString().split('T')[0];
        
        // Calculate revenue for previous month
        const revenue = await getRevenueForDateRange(startDate, endDate);

        console.log(`📊 PREVIOUS MONTH Revenue (${startDate} to ${endDate}): ${revenue.toFixed(2)} FLUX`);
        
        return revenue;
        
    } catch (error) {
        console.error('❌ Error calculating previous month revenue:', error.message);
        throw error;
    }
}

/**
 * Get payment count for the current month
 */
export async function getMonthlyPaymentCount() {
    try {
        const now = new Date();
        
        // Get first day of current month
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = firstDayOfMonth.toISOString().split('T')[0];
        
        // Get today
        const today = now.toISOString().split('T')[0];
        
        // Get payment count for current month
        const count = await getPaymentCountForDateRange(startDate, today);

        console.log(`📊 MONTHLY Payment Count (${startDate} to ${today}): ${count}`);
        
        return count;
        
    } catch (error) {
        console.error('❌ Error getting monthly payment count:', error.message);
        throw error;
    }
}

/**
 * Get payment count for the previous month
 */
export async function getPreviousMonthPaymentCount() {
    try {
        const now = new Date();
        
        // Get first day of previous month
        const firstDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startDate = firstDayOfPrevMonth.toISOString().split('T')[0];
        
        // Get last day of previous month
        const lastDayOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const endDate = lastDayOfPrevMonth.toISOString().split('T')[0];
        
        // Get payment count for previous month
        const count = await getPaymentCountForDateRange(startDate, endDate);

        console.log(`📊 PREVIOUS MONTH Payment Count (${startDate} to ${endDate}): ${count}`);
        
        return count;
        
    } catch (error) {
        console.error('❌ Error getting previous month payment count:', error.message);
        throw error;
    }
}

/**
 * Calculate yesterday's revenue (for daily comparison)
 */
export async function calculateYesterdayRevenue() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        const revenue = await getRevenueForDateRange(yesterdayStr, yesterdayStr);

        console.log(`📊 YESTERDAY Revenue (${yesterdayStr}): ${revenue.toFixed(2)} FLUX`);
        
        return revenue;
        
    } catch (error) {
        console.error('❌ Error calculating yesterday revenue:', error.message);
        throw error;
    }
}

/**
 * Get payment count for yesterday
 */
export async function getYesterdayPaymentCount() {
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        const count = await getPaymentCountForDateRange(yesterdayStr, yesterdayStr);

        console.log(`📊 YESTERDAY Payment Count (${yesterdayStr}): ${count}`);
        
        return count;
        
    } catch (error) {
        console.error('❌ Error getting yesterday payment count:', error.message);
        throw error;
    }
}
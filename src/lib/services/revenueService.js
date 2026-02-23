import axios from 'axios';
import { API_ENDPOINTS, TARGET_ADDRESSES, EXCLUDED_TRANSACTIONS, INITIAL_SYNC_LOOKBACK_BLOCKS } from '../config.js';
import {
    updateCurrentMetrics,
    updateSyncStatus,
    getSyncStatus,
    insertTransactionsBatch,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getAllTxids,
    getTxidCount,
    getUndeterminedAppNames,
    updateAppTypeForAppName
} from '../db/database.js';

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
// FAILED TRANSACTION TRACKING
// ============================================
let failedTxids = new Map(); // txid -> { attempts: number, lastAttempt: timestamp, reason: string }

/**
 * Mark a transaction as failed
 */
function markTxidAsFailed(txid, reason = 'fetch_failed') {
    const existing = failedTxids.get(txid);
    
    if (existing) {
        failedTxids.set(txid, {
            attempts: existing.attempts + 1,
            lastAttempt: Date.now(),
            reason: reason
        });
    } else {
        failedTxids.set(txid, {
            attempts: 1,
            lastAttempt: Date.now(),
            reason: reason
        });
    }
}

/**
 * Check if a txid should be retried (not attempted recently)
 */
function shouldRetryTxid(txid) {
    const failed = failedTxids.get(txid);
    if (!failed) return true; // Never tried, should try
    
    // If failed more than 5 times, give up
    if (failed.attempts >= 5) {
        return false;
    }
    
    // Only retry if it's been at least 5 minutes since last attempt
    const timeSinceLastAttempt = Date.now() - failed.lastAttempt;
    const fiveMinutes = 5 * 60 * 1000;
    
    return timeSinceLastAttempt >= fiveMinutes;
}

/**
 * Get failed transaction statistics
 */
export function getFailedTxStats() {
    const stats = {
        totalFailed: failedTxids.size,
        byAttempts: {},
        recentlyFailed: []
    };
    
    failedTxids.forEach((data, txid) => {
        // Count by attempt number
        if (!stats.byAttempts[data.attempts]) {
            stats.byAttempts[data.attempts] = 0;
        }
        stats.byAttempts[data.attempts]++;
        
        // Track recent failures (last 10 minutes)
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        if (data.lastAttempt > tenMinutesAgo) {
            stats.recentlyFailed.push({
                txid: txid.substring(0, 10) + '...',
                attempts: data.attempts,
                reason: data.reason
            });
        }
    });
    
    return stats;
}

/**
 * Clear permanently failed transactions (after 5 attempts)
 */
export function clearPermanentlyFailedTxids() {
    let cleared = 0;
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    failedTxids.forEach((data, txid) => {
        if (data.attempts >= 5 || data.lastAttempt < sevenDaysAgo) {
            failedTxids.delete(txid);
            cleared++;
        }
    });
    return cleared;
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
            updateCurrentMetrics({ flux_price_usd: price });
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
                updateCurrentMetrics({ flux_price_usd: price });
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
                updateCurrentMetrics({ flux_price_usd: price });
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

    for (const [from, to] of chunks) {
        try {
            const url = `${API_ENDPOINTS.DAEMON}/getaddresstxids/${address}/${from}/${to}`;

            const response = await axios.get(url, { timeout: 60000 });

            if (response.data && response.data.status === 'success' && Array.isArray(response.data.data)) {
                const count = response.data.data.length;
                if (count > 0) {
                    console.log(`  blocks ${from}-${to}: ${count} txids found`);
                }
                allTxids.push(...response.data.data);
            } else {
                console.warn(`  blocks ${from}-${to}: unexpected response`, response.data?.status);
            }
        } catch (error) {
            console.error(`  blocks ${from}-${to}: ERROR - ${error.message}`);
        }

        // Small delay between chunks to be API-friendly
        if (chunks.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    console.log(`Total txids fetched for ${address.substring(0, 15)}: ${allTxids.length}`);
    return allTxids;
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
function processTransaction(tx, trackedAddresses, fluxPriceUSD = null, appName = null, appType = null) {
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

                // Only apply USD conversion if the transaction is recent (within 24 hours).
                // For historical transactions the current price would be wrong — leave as null.
                const txAgeSeconds = Math.floor(Date.now() / 1000) - timestamp;
                const amountUSD = (fluxPriceUSD && txAgeSeconds < 86400)
                    ? amountFlux * fluxPriceUSD
                    : null;

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
        // 1. Fetch FLUX price
        const fluxPrice = await fetchFluxPrice();
        if (fluxPrice) {
            console.log(`FLUX price: $${fluxPrice.toFixed(4)}`);
        } else {
            console.warn('Could not fetch FLUX price - USD values will be null');
        }

        // 2. Get current block height
        const currentBlock = await fetchCurrentBlockHeight();
        revenueSyncState.currentBlock = currentBlock;

        // 3. Determine start block.
        // Use last_sync_block from sync_status (the highest block we've SCANNED, not just the
        // highest block we have a transaction for). This prevents re-scanning a growing gap
        // when there are no recent transactions.
        const syncStatus = getSyncStatus('revenue');
        const lastSyncedBlock = syncStatus?.last_sync_block || null;
        const startBlock = lastSyncedBlock
            ? Math.max(0, lastSyncedBlock - 25)     // 25-block overlap catches edge cases
            : 0;                                    // Full history scan from genesis

        console.log(`Block range: ${startBlock} -> ${currentBlock} (${currentBlock - startBlock} blocks)`);

        // 4. Ensure app name cache is fresh
        await ensurePermanentMessagesCache();

        // 5. Get existing txids
        const existingTxids = new Set(getAllTxids());
        console.log(`Database has ${existingTxids.size} existing transactions`);

        let pendingPayments = [];   // buffer between DB flushes
        let totalNewPayments = 0;
        const DB_FLUSH_SIZE = 200;  // write to DB every 200 payments so graphs update progressively

        // Helper: flush pending payments to DB so they become visible immediately
        function flushPending() {
            if (pendingPayments.length === 0) return;
            insertTransactionsBatch(pendingPayments);
            totalNewPayments += pendingPayments.length;
            console.log(`  Flushed ${pendingPayments.length} payments to DB (total so far: ${totalNewPayments})`);
            pendingPayments = [];
        }

        // 6. Process each tracked address
        for (const address of TARGET_ADDRESSES) {
            console.log(`\nFetching txids for ${address.substring(0, 20)}...`);

            const txids = await fetchAddressTxidsInRange(address, startBlock, currentBlock);

            if (!txids || txids.length === 0) {
                console.log('No transactions found in range');
                continue;
            }

            console.log(`Found ${txids.length} transactions in range`);

            // Filter out already-known and permanently-failed txids
            const newTxids = txids.filter(txid => !existingTxids.has(txid) && shouldRetryTxid(txid));
            console.log(`${newTxids.length} new transactions to process`);

            // Process in parallel batches
            for (let i = 0; i < newTxids.length; i += BATCH_SIZE) {
                const batch = newTxids.slice(i, i + BATCH_SIZE);

                const txResults = await Promise.all(batch.map(txid => fetchRawTransaction(txid)));

                for (let j = 0; j < batch.length; j++) {
                    const txid = batch[j];
                    const tx = txResults[j];

                    if (!tx) {
                        markTxidAsFailed(txid, 'fetch_failed');
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

                    const payments = processTransaction(tx, TARGET_ADDRESSES, fluxPrice, appName, appType);
                    pendingPayments.push(...payments);

                    if (payments.length > 0) {
                        console.log(`Payment in ${txid.substring(0, 10)}: ${payments[0].amount.toFixed(4)} FLUX${appName ? ` (${appName})` : ''}`);
                    }
                }

                // Flush to DB every DB_FLUSH_SIZE payments so the UI can show partial data
                if (pendingPayments.length >= DB_FLUSH_SIZE) {
                    flushPending();
                }

                // Small delay between batches to be API-friendly
                if (i + BATCH_SIZE < newTxids.length) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            // Flush any remaining payments for this address before moving to the next
            flushPending();
        }

        // 7. Final flush (catches any remainder < DB_FLUSH_SIZE)
        flushPending();

        if (totalNewPayments === 0) {
            console.log('\nNo new transactions found (database is up to date)');
        }

        // 8. Update sync status
        updateSyncStatus('revenue', 'completed', null, currentBlock);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\nBLOCK-RANGE SYNC COMPLETE`);
        console.log(`  Duration: ${duration}s | New payments: ${totalNewPayments} | Total: ${getTxidCount()}`);

        const failedStats = getFailedTxStats();
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
// APP TYPE BACKFILL
// ============================================

/**
 * Backfill app_type for all existing transactions where it is NULL.
 * Uses the permanentMessages cache (fetches if stale) to determine git vs docker.
 * Safe to run multiple times — only updates rows still missing app_type.
 */
export async function backfillAppTypes() {
    await ensurePermanentMessagesCache();

    const appNames = getUndeterminedAppNames();
    console.log(`🔄 Backfilling app_type for ${appNames.length} distinct app names...`);

    let updated = 0;
    let unknown = 0;

    for (const appName of appNames) {
        const type = lookupAppType(appName);
        if (type) {
            updateAppTypeForAppName(appName, type);
            updated++;
        } else {
            unknown++;
        }
    }

    console.log(`✅ app_type backfill complete: ${updated} updated, ${unknown} unknown (no spec found)`);
    return { total: appNames.length, updated, unknown };
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
        const revenue = getRevenueForDateRange(today, today);
        
        console.log(`📊 Today's revenue (${today}): ${revenue.toFixed(2)} FLUX`);
        
        updateCurrentMetrics({ 
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
function calculateRevenueByTimeframe(timeframe = 'day') {
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
        
        const revenue = getRevenueForDateRange(startDateStr, today);
        
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
export function getRevenueBreakdown() {
    try {
        return {
            day: calculateRevenueByTimeframe('day'),
            week: calculateRevenueByTimeframe('week'),
            month: calculateRevenueByTimeframe('month'),
            quarter: calculateRevenueByTimeframe('quarter'),
            year: calculateRevenueByTimeframe('year')
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
        updateSyncStatus('revenue', 'failed', error.message, null);
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
        console.log(`   Total in database: ${getTxidCount()}\n`);
        
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
        updateSyncStatus('revenue', 'failed', error.message, null);
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
        const revenue = getRevenueForDateRange(startDate, today);
        
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
        const revenue = getRevenueForDateRange(startDate, endDate);
        
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
        const count = getPaymentCountForDateRange(startDate, today);
        
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
        const count = getPaymentCountForDateRange(startDate, endDate);
        
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
        
        const revenue = getRevenueForDateRange(yesterdayStr, yesterdayStr);
        
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
        
        const count = getPaymentCountForDateRange(yesterdayStr, yesterdayStr);
        
        console.log(`📊 YESTERDAY Payment Count (${yesterdayStr}): ${count}`);
        
        return count;
        
    } catch (error) {
        console.error('❌ Error getting yesterday payment count:', error.message);
        throw error;
    }
}
import axios from 'axios';
import { API_ENDPOINTS, TARGET_ADDRESSES, BLOCK_CONFIG } from '../config.js';
import { 
    updateCurrentMetrics, 
    updateSyncStatus,
    getSyncStatus,
    insertTransactionsBatch,
    getRevenueForDateRange,
    getPaymentCountForDateRange,
    getAllTxids,
    getTxidCount,
    getLastSyncedBlock
} from '../db/database.js';

// ============================================
// CONFIGURATION
// ============================================
const TRANSACTIONS_PER_SYNC = 20;  // How many transactions to import per 5-minute cycle
const PAGE_SIZE = 1000;             // How many txids to fetch per API call

// ============================================
// STATE TRACKING
// ============================================
let revenueSyncState = {
    isRunning: false,
    lastStarted: null,
    lastCompleted: null,
    currentBlock: null,
    lastError: null,
    // NEW: Track pagination progress
    currentPage: 1,
    totalPages: null,
    processedTxids: new Set() // Track what we've already processed
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
    failedTxids.forEach((data, txid) => {
        if (data.attempts >= 5) {
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
 * Fetch FLUX price in USD
 */
export async function fetchFluxPrice() {
    try {
        console.log('🔍 Fetching FLUX price...');
        
        try {
            const response = await axios.get(
                API_ENDPOINTS.PRICE_PRIMARY,
                { timeout: 10000 }
            );
            
            if (response.data && response.data.zelcash && response.data.zelcash.usd) {
                const price = response.data.zelcash.usd;
                console.log(`✅ FLUX Price: $${price}`);
                updateCurrentMetrics({ 
                    last_update: Date.now(),
                    flux_price_usd: price 
                });
                return price;
            }
        } catch (error) {
            console.warn('⚠️  CoinGecko failed');
        }
        
        console.warn('⚠️  No USD price available');
        return null;
        
    } catch (error) {
        console.error('❌ Error fetching FLUX price:', error.message);
        return null;
    }
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

/**
 * Fetch transaction IDs for a specific address using Blockbook
 */
async function fetchAddressTransactionIds(address, page = 1, pageSize = PAGE_SIZE) {
    try {
        const url = `${API_ENDPOINTS.BLOCKBOOK}address/${address}?page=${page}&pageSize=${pageSize}`;
        
        console.log(`🔍 Fetching transaction IDs for ${address.substring(0, 15)}... (page ${page})`);
        
        const response = await axios.get(url, { 
            timeout: 30000,
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (response.data) {
            return {
                txids: response.data.txids || [],
                totalTxs: response.data.txs || 0,
                totalPages: response.data.totalPages || 0,
                currentPage: response.data.page || page,
                balance: response.data.balance || '0'
            };
        }
        
        return null;
        
    } catch (error) {
        console.error(`❌ Error fetching address transactions:`, error.message);
        return null;
    }
}

/**
 * Fetch full transaction details using Blockbook with retry logic
 */
async function fetchTransactionDetails(txid, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const url = `${API_ENDPOINTS.BLOCKBOOK}tx/${txid}`;
            
            const response = await axios.get(url, { 
                timeout: 15000,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (response.data) {
                return response.data;
            }
            
            return null;
            
        } catch (error) {
            if (attempt < retries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                console.warn(`⚠️  Retry ${attempt}/${retries} for tx ${txid.substring(0, 10)} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`❌ Failed to fetch tx ${txid.substring(0, 10)} after ${retries} attempts`);
                return null;
            }
        }
    }
    return null;
}

// ============================================
// TRANSACTION PROCESSING
// ============================================

/**
 * Process transaction and extract revenue for our tracked addresses
 */
function processTransaction(tx, trackedAddresses, fluxPriceUSD = null) {
    const transactions = [];
    
    if (!tx || !tx.vout) {
        return transactions;
    }
    
    const timestamp = tx.blockTime || Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().split('T')[0];
    const blockHeight = tx.blockHeight || 0;
    
    let fromAddress = 'Unknown';
    if (tx.vin && tx.vin.length > 0 && tx.vin[0].addresses && tx.vin[0].addresses.length > 0) {
        fromAddress = tx.vin[0].addresses[0];
    }
    
    for (const vout of tx.vout) {
        if (!vout.addresses || vout.addresses.length === 0) {
            continue;
        }
        
        for (const address of vout.addresses) {
            if (trackedAddresses.includes(address)) {
                const amountSatoshis = parseFloat(vout.value) || 0;
                const amountFlux = amountSatoshis / 100000000;
                
                // Calculate USD value if price is available
                const amountUSD = fluxPriceUSD ? amountFlux * fluxPriceUSD : null;
                
                transactions.push({
                    txid: tx.txid,
                    address: address,
                    from_address: fromAddress,
                    amount: amountFlux,
                    amount_usd: amountUSD,
                    block_height: blockHeight,
                    timestamp: timestamp,
                    date: date
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
 * Progressive sync - imports TRANSACTIONS_PER_SYNC new transactions per run
 * This ensures we gradually build up historical data without overwhelming the API
 */
export async function progressiveSync() {
    console.log('\n📡 Starting PROGRESSIVE SYNC...\n');
    console.log(`   Target: Import ${TRANSACTIONS_PER_SYNC} new transactions\n`);
    
    const startTime = Date.now();
    
    try {
        // Fetch current FLUX price for USD calculation
        const fluxPrice = await fetchFluxPrice();
        if (fluxPrice) {
            console.log(`   💵 Current FLUX price: $${fluxPrice.toFixed(4)}`);
        } else {
            console.warn('   ⚠️  Could not fetch FLUX price - USD values will be null');
        }
        
        // Get existing txids from database
        const existingTxids = new Set(getAllTxids());
        console.log(`   🗄️  Database has ${existingTxids.size} existing transactions`);
        
        let allNewTransactions = [];
        let totalTxsChecked = 0;
        let targetReached = false;
        
        // Process each tracked address
        for (const address of TARGET_ADDRESSES) {
            if (targetReached) break;
            
            console.log(`\n   🔍 Processing address: ${address.substring(0, 20)}...`);
            
            // Get first page to determine total pages
            const firstPage = await fetchAddressTransactionIds(address, 1, PAGE_SIZE);
            
            if (!firstPage) {
                console.error(`   ❌ Failed to fetch data for address`);
                continue;
            }
            
            const totalPages = firstPage.totalPages;
            const totalTxs = firstPage.totalTxs;
            
            console.log(`   📊 Total transactions: ${totalTxs}`);
            console.log(`   📊 Total pages: ${totalPages}`);
            console.log(`   📊 Need to import: ${TRANSACTIONS_PER_SYNC} transactions`);
            
            // Start from page 1 and work through pages until we find enough new transactions
            for (let page = 1; page <= totalPages; page++) {
                if (targetReached) break;
                
                console.log(`\n   📄 Checking page ${page}/${totalPages}...`);
                
                // Fetch page (reuse firstPage if page 1)
                const pageData = page === 1 ? firstPage : await fetchAddressTransactionIds(address, page, PAGE_SIZE);
                
                if (!pageData || !pageData.txids || pageData.txids.length === 0) {
                    console.warn(`   ⚠️  No data on page ${page}`);
                    continue;
                }
                
                console.log(`   📥 Found ${pageData.txids.length} transaction IDs on page`);
                
                // Check each txid on this page
                let newTxidsOnPage = [];
                for (const txid of pageData.txids) {
                    if (!existingTxids.has(txid)) {
                        // Check if this txid should be retried (not failed too many times recently)
                        if (shouldRetryTxid(txid)) {
                            newTxidsOnPage.push(txid);
                        }
                    }
                }
                
                console.log(`   🆕 ${newTxidsOnPage.length} are NEW (not in database)`);
                
                if (newTxidsOnPage.length === 0) {
                    console.log(`   ⏭️  All transactions on this page already exist, moving to next page...`);
                    continue;
                }
                
                // Process the new txids until we reach our target
                for (const txid of newTxidsOnPage) {
                    if (allNewTransactions.length >= TRANSACTIONS_PER_SYNC) {
                        console.log(`\n   ✅ Target reached! Collected ${TRANSACTIONS_PER_SYNC} new transactions`);
                        targetReached = true;
                        break;
                    }
                    
                    totalTxsChecked++;
                    
                    // Fetch full transaction details
                    const txDetails = await fetchTransactionDetails(txid);
                    
                    if (!txDetails) {
                        console.warn(`   ⚠️  Failed to fetch details for ${txid.substring(0, 10)}`);
                        markTxidAsFailed(txid, 'fetch_failed');
                        continue;
                    }
                    
                    // Process transaction to find payments to our addresses
                    const payments = processTransaction(txDetails, TARGET_ADDRESSES, fluxPrice);
                    
                    if (payments.length > 0) {
                        allNewTransactions.push(...payments);
                        console.log(`   💰 Found ${payments.length} payment(s) in tx ${txid.substring(0, 10)} (${allNewTransactions.length}/${TRANSACTIONS_PER_SYNC})`);
                    } else {
                        console.log(`   ℹ️  No payments in tx ${txid.substring(0, 10)}`);
                    }
                }
                
                if (targetReached) break;
            }
            
            if (targetReached) break;
        }
        
        // Save new transactions
        if (allNewTransactions.length > 0) {
            console.log(`\n💾 Saving ${allNewTransactions.length} new transactions...`);
            insertTransactionsBatch(allNewTransactions);
            console.log(`✅ New transactions saved`);
            
            // Update sync status with the latest block
            const currentBlock = await fetchCurrentBlockHeight();
            updateSyncStatus('revenue', 'completed', null, currentBlock);
        } else {
            console.log(`\n✅ No new transactions found (database is up to date)`);
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`\n✅ PROGRESSIVE SYNC COMPLETE`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Transactions checked: ${totalTxsChecked}`);
        console.log(`   New payments imported: ${allNewTransactions.length}`);
        console.log(`   Total in database: ${getTxidCount()}`);
        
        // Report on failed transactions if any
        const failedStats = getFailedTxStats();
        if (failedStats.totalFailed > 0) {
            console.log(`\n⚠️  Failed Transaction Summary:`);
            console.log(`   Total failed: ${failedStats.totalFailed}`);
            console.log(`   By attempts:`, failedStats.byAttempts);
            if (failedStats.recentlyFailed.length > 0) {
                console.log(`   Recent failures (last 10 min):`, failedStats.recentlyFailed.slice(0, 5));
            }
            console.log(`   Note: Failed transactions will be retried in 5 minutes`);
        }
        console.log('');
        
        return {
            success: true,
            newPayments: allNewTransactions.length,
            txsChecked: totalTxsChecked,
            duration: duration,
            failedTxids: failedStats.totalFailed
        };
        
    } catch (error) {
        console.error('❌ Progressive sync error:', error.message);
        throw error;
    }
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
 * DEBUG: Test Blockbook API with a specific address
 */
export async function debugBlockbookAddress(address) {
    console.log(`\n🔍 DEBUG: Testing Blockbook API for address\n`);
    console.log(`Address: ${address}\n`);
    
    try {
        console.log('Step 1: Fetching address transaction IDs...');
        const addressData = await fetchAddressTransactionIds(address, 1, 5);
        
        if (!addressData) {
            console.error('❌ Failed to fetch address data');
            return;
        }
        
        console.log(`✅ Address data received:`);
        console.log(`   Total transactions: ${addressData.totalTxs}`);
        console.log(`   Total pages: ${addressData.totalPages}`);
        console.log(`   Balance: ${addressData.balance} satoshis (${(parseFloat(addressData.balance) / 100000000).toFixed(2)} FLUX)`);
        console.log(`   Transaction IDs on page 1: ${addressData.txids.length}\n`);
        
        if (addressData.txids.length === 0) {
            console.log('⚠️  No transaction IDs found');
            return;
        }
        
        console.log('Transaction IDs:');
        addressData.txids.slice(0, 5).forEach((txid, i) => {
            console.log(`   [${i}] ${txid}`);
        });
        if (addressData.txids.length > 5) {
            console.log(`   ... and ${addressData.txids.length - 5} more`);
        }
        console.log('');
        
        const firstTxId = addressData.txids[0];
            
        console.log(`Step 2: Fetching details for first transaction...`);
        console.log(`   TXID: ${firstTxId}\n`);
        
        const txDetails = await fetchTransactionDetails(firstTxId);
        
        if (!txDetails) {
            console.error('❌ Failed to fetch transaction details');
            return;
        }
        
        console.log(`✅ Transaction details received:`);
        console.log(`   TXID: ${txDetails.txid}`);
        console.log(`   Block: ${txDetails.blockHeight}`);
        console.log(`   Time: ${new Date(txDetails.blockTime * 1000).toISOString()}`);
        console.log(`   Confirmations: ${txDetails.confirmations}`);
        console.log(`   Inputs (vin): ${txDetails.vin?.length || 0}`);
        console.log(`   Outputs (vout): ${txDetails.vout?.length || 0}`);
        
        if (txDetails.vout) {
            console.log(`\n   Vout (outputs) details:`);
            txDetails.vout.forEach((vout, index) => {
                const fluxAmount = (parseFloat(vout.value) / 100000000).toFixed(8);
                const addresses = vout.addresses?.join(', ') || 'none';
                console.log(`     [${index}] ${fluxAmount} FLUX → ${addresses}`);
            });
        }
        console.log('');
        
        console.log('Step 3: Processing transaction to find payments to tracked address...');
        const payments = processTransaction(txDetails, [address]);
        
        if (payments.length > 0) {
            console.log(`✅ Found ${payments.length} payment(s) to tracked address:`);
            payments.forEach(payment => {
                console.log(`   💰 ${payment.amount.toFixed(8)} FLUX`);
                console.log(`      To: ${payment.address}`);
                console.log(`      Block: ${payment.block_height}`);
                console.log(`      Date: ${payment.date}`);
                console.log(`      Time: ${new Date(payment.timestamp * 1000).toISOString()}`);
            });
        } else {
            console.log('⚠️  No payments to tracked address found in this transaction');
        }
        
        console.log(`\n✅ DEBUG Complete\n`);
        
    } catch (error) {
        console.error('❌ DEBUG Error:', error.message);
        console.error('Stack:', error.stack);
    }
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
import axios from 'axios';
import { API_ENDPOINTS, TARGET_ADDRESSES, BLOCK_CONFIG } from '../config.js';
import { 
    updateCurrentMetrics, 
    updateSyncStatus,
    getSyncStatus,
    insertTransactionsBatch,
    getRevenueForDateRange,
    getAllTxids,
    getTxidCount
} from '../db/database.js';

// ============================================
// TESTING CONFIGURATION
// ============================================
const TESTING_MODE = true;              // Set to false for production
const MAX_TRANSACTIONS_FOR_TESTING = 20; // Limit for testing (set to null for no limit)

// ============================================
// REVENUE SYNC STATE TRACKING (NEW)
// ============================================

/**
 * State tracker for revenue sync operations
 * This allows the snapshot system to coordinate with revenue collection
 */
let revenueSyncState = {
    isRunning: false,
    lastStarted: null,
    lastCompleted: null,
    currentBlock: null,
    lastError: null
};

/**
 * Get current revenue sync state
 * Used by snapshotManager to determine if it's safe to take snapshot
 */
export function getRevenueSyncState() {
    return { ...revenueSyncState };
}

/**
 * Set revenue sync state (internal function)
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
 * FIXED: Now includes last_update timestamp
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
                // FIXED: Added last_update timestamp
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
 * Returns array of txid strings
 */
async function fetchAddressTransactionIds(address, page = 1, pageSize = 1000) {
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
                txids: response.data.txids || [],  // Array of txid strings
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
 * Returns the complete transaction with vout array
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
                // Retry with exponential backoff
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5s
                console.warn(`⚠️  Error fetching tx ${txid.substring(0, 10)}: ${error.message} - Retry ${attempt}/${retries} in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Final attempt failed
                console.error(`❌ Failed to fetch tx ${txid.substring(0, 10)} after ${retries} attempts: ${error.message}`);
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
 * This examines each vout and sums up values where addresses match
 */
function processTransaction(tx, trackedAddresses) {
    const transactions = [];
    
    if (!tx || !tx.vout) {
        return transactions;
    }
    
    // Get timestamp and date from the transaction
    const timestamp = tx.blockTime || Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().split('T')[0];
    const blockHeight = tx.blockHeight || 0;
    
    // Get "from" address (sender) from first vin if available
    let fromAddress = 'Unknown';
    if (tx.vin && tx.vin.length > 0 && tx.vin[0].addresses && tx.vin[0].addresses.length > 0) {
        fromAddress = tx.vin[0].addresses[0];
    }
    
    // Check each vout for our tracked addresses
    for (const vout of tx.vout) {
        if (!vout.addresses || vout.addresses.length === 0) {
            continue;
        }
        
        // Check if any of the vout addresses match our tracked addresses
        for (const address of vout.addresses) {
            if (trackedAddresses.includes(address)) {
                // Found a payment to one of our addresses!
                const amountSatoshis = parseFloat(vout.value) || 0;
                const amountFlux = amountSatoshis / 100000000; // Convert satoshis to FLUX
                
                transactions.push({
                    txid: tx.txid,
                    address: address,
                    from_address: fromAddress,
                    amount: amountFlux,
                    block_height: blockHeight,
                    timestamp: timestamp,
                    date: date
                });
                
                // Don't break here - there might be multiple outputs to our addresses
            }
        }
    }
    
    return transactions;
}

/**
 * Fetch and process ALL transactions for ALL tracked addresses
 * This is the FULL SYNC that gets everything from the blockchain
 */
export async function syncAllAddressesBlockbook() {
    console.log('\n📡 Starting FULL SYNC of all transactions...\n');
    
    const startTime = Date.now();
    let allTransactions = [];
    let totalPages = 0;
    let totalTxsProcessed = 0;
    let totalPaymentsFound = 0;
    
    try {
        for (const address of TARGET_ADDRESSES) {
            console.log(`\n🔍 Processing address: ${address.substring(0, 20)}...`);
            
            // Get first page to find total pages
            const firstPage = await fetchAddressTransactionIds(address, 1, 1000);
            
            if (!firstPage) {
                console.error(`❌ Failed to fetch data for ${address}`);
                continue;
            }
            
            totalPages = firstPage.totalPages;
            const totalTxsForAddress = firstPage.totalTxs;
            
            console.log(`   Total transactions: ${totalTxsForAddress}`);
            console.log(`   Total pages: ${totalPages}`);
            
            // Process each page
            for (let page = 1; page <= totalPages; page++) {
                console.log(`   📄 Processing page ${page}/${totalPages}...`);
                
                // Fetch page (or reuse first page if page 1)
                const pageData = page === 1 ? firstPage : await fetchAddressTransactionIds(address, page, 1000);
                
                if (!pageData || !pageData.txids) {
                    console.warn(`   ⚠️  Failed to fetch page ${page}`);
                    continue;
                }
                
                console.log(`   📥 Fetched ${pageData.txids.length} transaction IDs`);
                
                // Process each transaction on this page
                let paymentsOnPage = 0;
                
                for (const txid of pageData.txids) {
                    // Testing mode limit
                    if (TESTING_MODE && MAX_TRANSACTIONS_FOR_TESTING && totalTxsProcessed >= MAX_TRANSACTIONS_FOR_TESTING) {
                        console.log(`\n⚠️  TESTING MODE: Reached limit of ${MAX_TRANSACTIONS_FOR_TESTING} transactions`);
                        break;
                    }
                    
                    // Fetch full transaction details
                    const txDetails = await fetchTransactionDetails(txid);
                    
                    if (!txDetails) {
                        console.warn(`   ⚠️  Failed to fetch details for ${txid.substring(0, 10)}`);
                        continue;
                    }
                    
                    // Process transaction to find payments to our addresses
                    const payments = processTransaction(txDetails, TARGET_ADDRESSES);
                    
                    if (payments.length > 0) {
                        allTransactions.push(...payments);
                        paymentsOnPage += payments.length;
                        totalPaymentsFound += payments.length;
                    }
                    
                    totalTxsProcessed++;
                }
                
                console.log(`   ✅ Page ${page} complete: ${paymentsOnPage} payment(s) found`);
                
                // Testing mode limit check
                if (TESTING_MODE && MAX_TRANSACTIONS_FOR_TESTING && totalTxsProcessed >= MAX_TRANSACTIONS_FOR_TESTING) {
                    break;
                }
            }
            
            console.log(`✅ Address complete: ${totalPaymentsFound} total payment(s) found\n`);
            
            // Testing mode limit check
            if (TESTING_MODE && MAX_TRANSACTIONS_FOR_TESTING && totalTxsProcessed >= MAX_TRANSACTIONS_FOR_TESTING) {
                break;
            }
        }
        
        // Save all transactions to database
        if (allTransactions.length > 0) {
            console.log(`\n💾 Saving ${allTransactions.length} transactions to database...`);
            insertTransactionsBatch(allTransactions);
            console.log(`✅ Transactions saved`);
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`\n✅ FULL SYNC COMPLETE`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Transactions processed: ${totalTxsProcessed}`);
        console.log(`   Payments found: ${totalPaymentsFound}`);
        console.log(`   Saved to database: ${allTransactions.length}\n`);
        
        return {
            success: true,
            txsProcessed: totalTxsProcessed,
            paymentsFound: totalPaymentsFound,
            duration: duration
        };
        
    } catch (error) {
        console.error('❌ Full sync error:', error.message);
        throw error;
    }
}

/**
 * Initial sync - fetch all transactions from Blockbook
 */
export async function initialSync() {
    setRevenueSyncRunning(true);
    
    try {
        console.log('🚀 Starting initial revenue sync with Blockbook API...');
        
        // Fetch FLUX price first
        console.log('\n💰 Fetching FLUX price...');
        await fetchFluxPrice();
        console.log('');
        
        const result = await syncAllAddressesBlockbook();
        
        console.log('✅ Initial sync completed');
        
        setRevenueSyncRunning(false);
        return result;
        
    } catch (error) {
        console.error('❌ Initial sync failed:', error.message);
        setRevenueSyncError(error);
        setRevenueSyncRunning(false);
        updateSyncStatus('revenue', 'failed', error.message, null);
        throw error;
    }
}


/**
 * Incremental sync - only fetch new transactions since last sync
 * This checks the last synced block and only fetches transactions after that
 */
export async function incrementalSync() {
    console.log('\n📡 Starting INCREMENTAL SYNC...\n');
    
    const startTime = Date.now();
    
    try {
        // Get last synced block from database
        const syncStatus = getSyncStatus('revenue');
        const lastBlock = syncStatus?.last_sync_block || null;
        
        // Get current block height
        const currentBlock = await fetchCurrentBlockHeight();
        
        console.log(`   Last synced block: ${lastBlock || 'none (first sync)'}`);
        console.log(`   Current block: ${currentBlock}`);
        
        setRevenueSyncRunning(true, currentBlock);
        
        if (lastBlock && currentBlock - lastBlock < BLOCK_CONFIG.INCREMENTAL_THRESHOLD) {
            console.log(`   📊 Only ${currentBlock - lastBlock} new blocks - doing incremental sync`);
            
            // Get existing txids to filter out duplicates
            const existingTxids = new Set(getAllTxids());
            console.log(`   🗄️  Database has ${existingTxids.size} existing transactions`);
            
            let allNewTransactions = [];
            let totalNewTxsFound = 0;
            
            // Fetch recent transactions for each address
            for (const address of TARGET_ADDRESSES) {
                console.log(`\n   🔍 Checking address: ${address.substring(0, 20)}...`);
                
                // Fetch first page (most recent transactions)
                const recentTxs = await fetchAddressTransactionIds(address, 1, 100);
                
                if (!recentTxs || !recentTxs.txids) {
                    console.warn(`   ⚠️  Failed to fetch recent transactions`);
                    continue;
                }
                
                console.log(`   📥 Fetched ${recentTxs.txids.length} recent transaction IDs`);
                
                let newTxsForAddress = 0;
                
                // Process each transaction
                for (const txid of recentTxs.txids) {
                    // Skip if we already have this transaction
                    if (existingTxids.has(txid)) {
                        continue;
                    }
                    
                    // Fetch full transaction details
                    const txDetails = await fetchTransactionDetails(txid);
                    
                    if (!txDetails) {
                        continue;
                    }
                    
                    // Skip if transaction is older than our last sync
                    if (lastBlock && txDetails.blockHeight <= lastBlock) {
                        continue;
                    }
                    
                    // Process transaction to find payments to our addresses
                    const payments = processTransaction(txDetails, TARGET_ADDRESSES);
                    
                    if (payments.length > 0) {
                        allNewTransactions.push(...payments);
                        newTxsForAddress += payments.length;
                    }
                }
                
                if (newTxsForAddress > 0) {
                    console.log(`   ✅ Found ${newTxsForAddress} new payment(s)`);
                    totalNewTxsFound += newTxsForAddress;
                } else {
                    console.log(`   ℹ️  No new payments found`);
                }
            }
            
            // Save new transactions
            if (allNewTransactions.length > 0) {
                console.log(`\n💾 Saving ${allNewTransactions.length} new transactions...`);
                insertTransactionsBatch(allNewTransactions);
                console.log(`✅ New transactions saved`);
            }
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            
            console.log(`\n✅ INCREMENTAL SYNC COMPLETE`);
            console.log(`   Duration: ${duration}s`);
            console.log(`   New payments found: ${totalNewTxsFound}`);
            console.log(`   Total in database: ${getTxidCount()}\n`);
            
            // Update sync status
            updateSyncStatus('revenue', 'completed', null, currentBlock);
            
            return {
                success: true,
                newPayments: totalNewTxsFound,
                duration: duration
            };
            
        } else {
            console.log(`   📊 Too many blocks since last sync (${currentBlock - (lastBlock || 0)}) - recommend full sync`);
            console.log(`   ℹ️  Incremental sync skipped - run full sync instead\n`);
            
            return {
                success: false,
                reason: 'Too many blocks - full sync recommended'
            };
        }
        
    } catch (error) {
        console.error('❌ Incremental sync error:', error.message);
        throw error;
    }
}

// ============================================
// REVENUE CALCULATION
// ============================================

/**
 * Calculate today's revenue from database
 * FIXED: Now includes last_update timestamp
 */
async function calculateDailyRevenue() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const revenue = getRevenueForDateRange(today, today);
        
        console.log(`📊 Today's revenue (${today}): ${revenue.toFixed(2)} FLUX`);
        
        // FIXED: Added last_update timestamp
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
 * Get revenue breakdown by timeframe (returns detailed stats)
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
 * UPDATED: Now includes state tracking
 */
export async function fetchRevenueStats() {
    setRevenueSyncRunning(true);
    
    try {
        console.log('🔍 Fetching complete revenue statistics...');
        
        const price = await fetchFluxPrice();
        
        // Try incremental sync first
        const incrementalResult = await incrementalSync();
        
        // ADD THIS: If incremental sync was skipped, run full sync
        if (!incrementalResult.success && incrementalResult.reason) {
            console.log('⚠️  Incremental sync skipped, running FULL SYNC instead...\n');
            await initialSync();  // ← ADD THIS FALLBACK
        }
        
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
 * Get detailed sync status for monitoring (NEW)
 */
export function getRevenueSyncStatus() {
    return {
        state: { ...revenueSyncState },
        timeSinceLastSync: getTimeSinceLastSync(),
        isHealthy: !revenueSyncState.isRunning && 
                   revenueSyncState.lastCompleted !== null &&
                   getTimeSinceLastSync() < 5 * 60 * 1000 // Within last 5 minutes
    };
}

/**
 * DEBUG: Test Blockbook API with a specific address
 */
export async function debugBlockbookAddress(address) {
    console.log(`\n🔍 DEBUG: Testing Blockbook API for address\n`);
    console.log(`Address: ${address}\n`);
    
    try {
        // Step 1: Fetch address transaction IDs
        console.log('Step 1: Fetching address transaction IDs...');
        const addressData = await fetchAddressTransactionIds(address, 1, 5);  // Just get 5 for testing
        
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
        
        // Show the transaction IDs
        console.log('Transaction IDs:');
        addressData.txids.slice(0, 5).forEach((txid, i) => {  // Show first 5 only
            console.log(`   [${i}] ${txid}`);
        });
        if (addressData.txids.length > 5) {
            console.log(`   ... and ${addressData.txids.length - 5} more`);
        }
        console.log('');
        
        // Step 2: Fetch details for first transaction
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
        
        // Show all vout details
        if (txDetails.vout) {
            console.log(`\n   Vout (outputs) details:`);
            txDetails.vout.forEach((vout, index) => {
                const fluxAmount = (parseFloat(vout.value) / 100000000).toFixed(8);
                const addresses = vout.addresses?.join(', ') || 'none';
                console.log(`     [${index}] ${fluxAmount} FLUX → ${addresses}`);
            });
        }
        console.log('');
        
        // Step 3: Process transaction
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
            console.log('   Possible reasons:');
            console.log('   - This address was the sender (check vin), not receiver');
            console.log('   - Payment went to a different address (change output)');
            console.log('   - This is a different type of transaction\n');
            
            // Show vin addresses for context
            if (txDetails.vin && txDetails.vin.length > 0) {
                console.log('   Inputs (vin) addresses:');
                txDetails.vin.forEach((vin, i) => {
                    const addresses = vin.addresses?.join(', ') || 'none';
                    console.log(`     [${i}] ${addresses}`);
                });
            }
        }
        
        console.log(`\n✅ DEBUG Complete\n`);
        
    } catch (error) {
        console.error('❌ DEBUG Error:', error.message);
        console.error('Stack:', error.stack);
    }
}
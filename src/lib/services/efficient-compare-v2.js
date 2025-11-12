#!/usr/bin/env node

/**
 * Efficient Missing Transaction Finder - FIXED
 * Correctly parses Blockbook API v2 response format
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import path from 'path';

const BLOCKBOOK_API_V2 = 'https://blockbook.runonflux.io/api/v2/';
const TARGET_ADDRESS = 't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX';
const dbPath = path.join(process.cwd(), 'data', 'flux-performance.db');

console.log('🔍 Efficient Transaction Comparison (API v2 - FIXED)\n');
console.log('='.repeat(70));

async function compareTransactions() {
    try {
        const db = new Database(dbPath);
        
        // Step 1: Get all TXIDs from database
        console.log('\n📊 Step 1: Load Database TXIDs');
        console.log('-'.repeat(70));
        
        const dbStart = Date.now();
        const dbTxids = new Set(
            db.prepare('SELECT txid FROM revenue_transactions').all().map(r => r.txid)
        );
        const dbTime = Date.now() - dbStart;
        
        console.log(`✅ Loaded ${dbTxids.size} TXIDs from database (${dbTime}ms)`);
        
        // Step 2: Get all TXIDs from API v2 (single call!)
        console.log('\n📊 Step 2: Fetch TXIDs from Blockbook API v2');
        console.log('-'.repeat(70));
        
        const apiUrl = `${BLOCKBOOK_API_V2}address/${TARGET_ADDRESS}`;
        console.log(`Fetching: ${apiUrl}`);
        console.log('⏳ This may take a moment (downloading all transaction IDs)...\n');
        
        const apiStart = Date.now();
        const response = await axios.get(apiUrl, { 
            timeout: 120000,  // 2 minute timeout for large response
            headers: {
                'Accept': 'application/json'
            }
        });
        const apiTime = Date.now() - apiStart;
        
        const data = response.data;
        
        console.log(`✅ API response received (${apiTime}ms)`);
        console.log(`   Address: ${data.address}`);
        console.log(`   Balance: ${(parseFloat(data.balance) / 100000000).toFixed(2)} FLUX`);
        console.log(`   Total Transactions: ${data.txs || 0}`);
        console.log(`   Total Received: ${(parseFloat(data.totalReceived || 0) / 100000000).toFixed(2)} FLUX`);
        console.log(`   Total Sent: ${(parseFloat(data.totalSent || 0) / 100000000).toFixed(2)} FLUX`);
        
        // API v2 returns txids as a simple array
        const apiTxidsArray = data.txids || [];
        
        console.log(`\n📋 Processing ${apiTxidsArray.length} TXIDs from API...`);
        
        // Count duplicates as we convert to Set
        const apiTxids = new Set();
        const duplicateTxids = [];
        
        for (const txid of apiTxidsArray) {
            if (apiTxids.has(txid)) {
                duplicateTxids.push(txid);
            }
            apiTxids.add(txid);
        }
        
        console.log(`✅ Found ${apiTxids.size} unique TXIDs`);
        
        if (duplicateTxids.length > 0) {
            console.log(`⚠️  Found ${duplicateTxids.length} duplicate TXID(s) in API response`);
        }
        
        // Step 3: Compare
        console.log('\n📊 Step 3: Compare TXIDs');
        console.log('-'.repeat(70));
        
        const missingInDb = [];
        const extraInDb = [];
        
        // Find TXIDs in API but not in database
        for (const txid of apiTxids) {
            if (!dbTxids.has(txid)) {
                missingInDb.push(txid);
            }
        }
        
        // Find TXIDs in database but not in API (shouldn't happen)
        for (const txid of dbTxids) {
            if (!apiTxids.has(txid)) {
                extraInDb.push(txid);
            }
        }
        
        console.log(`\nAPI TXIDs (raw):      ${apiTxidsArray.length}`);
        console.log(`API TXIDs (unique):   ${apiTxids.size}`);
        console.log(`Database TXIDs:       ${dbTxids.size}`);
        console.log(`Missing from DB:      ${missingInDb.length}`);
        console.log(`Extra in DB:          ${extraInDb.length}`);
        console.log(`Duplicates in API:    ${duplicateTxids.length}`);
        
        // Step 4: Investigate missing transactions
        if (missingInDb.length > 0) {
            console.log('\n🔍 Step 4: Investigate Missing Transactions');
            console.log('-'.repeat(70));
            console.log(`\n❌ Found ${missingInDb.length} TXID(s) in API but not in database:\n`);
            
            for (const txid of missingInDb.slice(0, 10)) {  // Show first 10
                console.log(`   Missing TXID: ${txid}`);
                
                // Fetch transaction details
                try {
                    const txUrl = `https://blockbook.runonflux.io/api/tx/${txid}`;
                    const txResponse = await axios.get(txUrl, { 
                        timeout: 15000,
                        headers: { 'Accept': 'application/json' }
                    });
                    const tx = txResponse.data;
                    
                    console.log(`     Block: ${tx.blockHeight}`);
                    console.log(`     Time: ${new Date(tx.blockTime * 1000).toISOString()}`);
                    console.log(`     Confirmations: ${tx.confirmations}`);
                    
                    // Check outputs to our address
                    const ourOutputs = tx.vout?.filter(v => 
                        v.addresses?.includes(TARGET_ADDRESS)
                    ) || [];
                    
                    if (ourOutputs.length > 0) {
                        let totalAmount = 0;
                        ourOutputs.forEach(vout => {
                            const amount = parseFloat(vout.value) / 100000000;
                            totalAmount += amount;
                        });
                        console.log(`     Payments to our address: ${ourOutputs.length} output(s) = ${totalAmount.toFixed(8)} FLUX`);
                    }
                    
                    console.log('');
                    
                    // Rate limit protection
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                } catch (error) {
                    console.log(`     ⚠️  Failed to fetch details: ${error.message}`);
                    console.log('');
                }
            }
            
            if (missingInDb.length > 10) {
                console.log(`   ... and ${missingInDb.length - 10} more missing TXIDs\n`);
            }
        }
        
        // Step 5: Investigate extra transactions (shouldn't happen)
        if (extraInDb.length > 0) {
            console.log('\n⚠️  Step 5: Investigate Extra Transactions (Unusual)');
            console.log('-'.repeat(70));
            console.log(`\nFound ${extraInDb.length} TXID(s) in database but not in API:\n`);
            
            for (const txid of extraInDb.slice(0, 5)) {  // Show first 5
                const tx = db.prepare('SELECT * FROM revenue_transactions WHERE txid = ?').get(txid);
                console.log(`   TXID: ${txid}`);
                console.log(`   Amount: ${tx.amount} FLUX`);
                console.log(`   Date: ${tx.date}`);
                console.log(`   Block: ${tx.block_height}`);
                console.log('');
            }
            
            if (extraInDb.length > 5) {
                console.log(`   ... and ${extraInDb.length - 5} more\n`);
            }
        }
        
        // Step 6: Investigate duplicate TXIDs in API
        if (duplicateTxids.length > 0) {
            console.log('\n📊 Step 6: Investigate Duplicate TXIDs in API');
            console.log('-'.repeat(70));
            console.log(`\nFound ${duplicateTxids.length} TXID(s) appearing multiple times in API:\n`);
            
            // Get unique duplicates
            const uniqueDuplicates = [...new Set(duplicateTxids)];
            
            for (const txid of uniqueDuplicates.slice(0, 5)) {  // Show first 5
                const count = apiTxidsArray.filter(t => t === txid).length;
                console.log(`   TXID: ${txid}`);
                console.log(`   Appears: ${count} times in API response`);
                
                // Fetch details
                try {
                    const txUrl = `https://blockbook.runonflux.io/api/tx/${txid}`;
                    const txResponse = await axios.get(txUrl, { 
                        timeout: 15000,
                        headers: { 'Accept': 'application/json' }
                    });
                    const tx = txResponse.data;
                    
                    // Check outputs to our address
                    const ourOutputs = tx.vout?.filter(v => 
                        v.addresses?.includes(TARGET_ADDRESS)
                    ) || [];
                    
                    console.log(`   Outputs to our address: ${ourOutputs.length}`);
                    
                    if (ourOutputs.length > 0) {
                        let totalAmount = 0;
                        ourOutputs.forEach((vout, i) => {
                            const amount = parseFloat(vout.value) / 100000000;
                            totalAmount += amount;
                            console.log(`     Output ${vout.n}: ${amount.toFixed(8)} FLUX`);
                        });
                        console.log(`   Total: ${totalAmount.toFixed(8)} FLUX`);
                    }
                    
                    console.log('');
                    
                    // Rate limit protection
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                } catch (error) {
                    console.log(`   ⚠️  Failed to fetch details: ${error.message}`);
                    console.log('');
                }
            }
            
            if (uniqueDuplicates.length > 5) {
                console.log(`   ... and ${uniqueDuplicates.length - 5} more duplicates\n`);
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 FINAL SUMMARY');
        console.log('='.repeat(70));
        
        console.log(`\nAPI Reports:`);
        console.log(`  Total transactions: ${data.txs}`);
        console.log(`  TXIDs in response: ${apiTxidsArray.length}`);
        console.log(`  Unique TXIDs: ${apiTxids.size}`);
        console.log(`  Duplicate TXIDs: ${duplicateTxids.length}`);
        
        console.log(`\nDatabase:`);
        console.log(`  Total TXIDs: ${dbTxids.size}`);
        
        console.log(`\nComparison:`);
        console.log(`  Missing from database: ${missingInDb.length}`);
        console.log(`  Extra in database: ${extraInDb.length}`);
        
        const discrepancy = data.txs - dbTxids.size;
        
        console.log(`\n🎯 EXPLANATION:`);
        
        if (discrepancy === duplicateTxids.length && missingInDb.length === 0) {
            console.log(`   ✅ The ${discrepancy}-transaction difference is FULLY explained by`);
            console.log(`      ${duplicateTxids.length} duplicate TXID(s) in the API response.`);
            console.log('');
            console.log('   WHY: These transactions have multiple outputs to your address,');
            console.log('        so they appear multiple times in the API txids array.');
            console.log('');
            console.log('   YOUR DATABASE: Correctly stores each TXID only once (UNIQUE constraint)');
            console.log('   REVENUE: Still accurate - all amounts are captured!');
            console.log('');
            console.log('   ✅ No action needed - everything is working correctly!');
        } else if (missingInDb.length > 0) {
            console.log(`   ⚠️  You have ${missingInDb.length} genuinely missing transaction(s).`);
            console.log('   ACTION: Run an incremental sync to capture them:');
            console.log('           node test-blockbook.js');
        } else if (missingInDb.length === 0 && extraInDb.length === 0) {
            console.log('   ✅ Perfect match! Database and API are in sync.');
        } else {
            console.log('   🤔 Mixed situation - review the details above.');
        }
        
        console.log('\n' + '='.repeat(70));
        
        db.close();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            console.error('\n⏱️  Request timed out');
            console.error('   The API response is very large (15k+ transactions)');
            console.error('   Try again or increase timeout');
        } else if (error.response?.status === 429) {
            console.error('\n⚠️  Rate Limited by Blockbook API');
            console.error('   Wait a few minutes and try again');
        } else if (error.response?.status === 400) {
            console.error('\n⚠️  Bad Request - API endpoint may have changed');
            console.error('   Check the Blockbook API documentation');
        }
        
        console.error('\nStack trace:');
        console.error(error.stack);
        
        process.exit(1);
    }
}

compareTransactions();
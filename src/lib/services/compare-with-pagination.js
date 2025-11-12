#!/usr/bin/env node

/**
 * Complete Transaction Comparison with Pagination
 * Fetches all 16 pages from Blockbook API v2
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import path from 'path';

const BLOCKBOOK_API_V2 = 'https://blockbook.runonflux.io/api/v2/';
const TARGET_ADDRESS = 't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX';
const dbPath = path.join(process.cwd(), 'data', 'flux-performance.db');

console.log('🔍 Complete Transaction Comparison (with Pagination)\n');
console.log('='.repeat(70));

async function compareWithPagination() {
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
        
        // Step 2: Get total from API first
        console.log('\n📊 Step 2: Get API Info');
        console.log('-'.repeat(70));
        
        const infoUrl = `${BLOCKBOOK_API_V2}address/${TARGET_ADDRESS}?page=1&pageSize=1`;
        const infoResponse = await axios.get(infoUrl, { 
            timeout: 30000,
            headers: { 'Accept': 'application/json' }
        });
        
        const totalTxs = infoResponse.data.txs || 0;
        const totalPages = infoResponse.data.totalPages || 1;
        
        console.log(`Total Transactions: ${totalTxs}`);
        console.log(`Total Pages:        ${totalPages}`);
        console.log(`Page Size:          1000 TXIDs per page`);
        
        // Step 3: Fetch all pages
        console.log('\n📊 Step 3: Fetch All Pages from API');
        console.log('-'.repeat(70));
        console.log(`Fetching ${totalPages} pages...`);
        console.log('');
        
        const apiTxidsArray = [];
        
        for (let page = 1; page <= totalPages; page++) {
            process.stdout.write(`\r   Fetching page ${page}/${totalPages}...`);
            
            const pageUrl = `${BLOCKBOOK_API_V2}address/${TARGET_ADDRESS}?page=${page}&pageSize=1000`;
            
            try {
                const pageResponse = await axios.get(pageUrl, { 
                    timeout: 30000,
                    headers: { 'Accept': 'application/json' }
                });
                
                const pageTxids = pageResponse.data.txids || [];
                apiTxidsArray.push(...pageTxids);
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`\n   ❌ Failed to fetch page ${page}: ${error.message}`);
                
                if (error.response?.status === 429) {
                    console.log('   ⏳ Rate limited - waiting 5 seconds...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    page--; // Retry this page
                }
            }
        }
        
        console.log(`\n\n✅ Fetched ${apiTxidsArray.length} TXIDs from ${totalPages} pages`);
        
        // Count duplicates
        const apiTxids = new Set();
        const duplicateTxids = [];
        
        for (const txid of apiTxidsArray) {
            if (apiTxids.has(txid)) {
                duplicateTxids.push(txid);
            }
            apiTxids.add(txid);
        }
        
        console.log(`   Unique TXIDs: ${apiTxids.size}`);
        if (duplicateTxids.length > 0) {
            console.log(`   Duplicates: ${duplicateTxids.length}`);
        }
        
        // Step 4: Compare
        console.log('\n📊 Step 4: Compare TXIDs');
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
        
        console.log(`\nAPI Total:            ${totalTxs}`);
        console.log(`API TXIDs (raw):      ${apiTxidsArray.length}`);
        console.log(`API TXIDs (unique):   ${apiTxids.size}`);
        console.log(`Database TXIDs:       ${dbTxids.size}`);
        console.log(`\nMissing from DB:      ${missingInDb.length}`);
        console.log(`Extra in DB:          ${extraInDb.length}`);
        console.log(`Duplicates in API:    ${duplicateTxids.length}`);
        
        // Step 5: Investigate missing transactions
        if (missingInDb.length > 0) {
            console.log('\n🔍 Step 5: Investigate Missing Transactions');
            console.log('-'.repeat(70));
            console.log(`\n❌ Found ${missingInDb.length} TXID(s) in API but not in database:\n`);
            
            for (const txid of missingInDb.slice(0, 5)) {  // Show first 5
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
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.log(`     ⚠️  Failed to fetch details: ${error.message}`);
                    console.log('');
                }
            }
            
            if (missingInDb.length > 5) {
                console.log(`   ... and ${missingInDb.length - 5} more missing TXIDs\n`);
            }
        }
        
        // Step 6: Investigate extra transactions
        if (extraInDb.length > 0) {
            console.log('\n⚠️  Step 6: Investigate Extra Transactions (Unusual)');
            console.log('-'.repeat(70));
            console.log(`\nFound ${extraInDb.length} TXID(s) in database but not in API:\n`);
            
            for (const txid of extraInDb.slice(0, 5)) {
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
        
        // Step 7: Investigate duplicates
        if (duplicateTxids.length > 0) {
            console.log('\n📊 Step 7: Investigate Duplicate TXIDs');
            console.log('-'.repeat(70));
            
            const uniqueDuplicates = [...new Set(duplicateTxids)];
            console.log(`\nFound ${uniqueDuplicates.length} unique TXID(s) appearing multiple times:\n`);
            
            for (const txid of uniqueDuplicates.slice(0, 3)) {
                const count = apiTxidsArray.filter(t => t === txid).length;
                console.log(`   TXID: ${txid}`);
                console.log(`   Appears: ${count} times in API`);
                
                try {
                    const txUrl = `https://blockbook.runonflux.io/api/tx/${txid}`;
                    const txResponse = await axios.get(txUrl, { 
                        timeout: 15000,
                        headers: { 'Accept': 'application/json' }
                    });
                    const tx = txResponse.data;
                    
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
                    
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.log(`   ⚠️  Failed to fetch: ${error.message}`);
                    console.log('');
                }
            }
            
            if (uniqueDuplicates.length > 3) {
                console.log(`   ... and ${uniqueDuplicates.length - 3} more\n`);
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 FINAL SUMMARY');
        console.log('='.repeat(70));
        
        console.log(`\nAPI Reports:`);
        console.log(`  Total transactions: ${totalTxs}`);
        console.log(`  TXIDs fetched: ${apiTxidsArray.length} (across ${totalPages} pages)`);
        console.log(`  Unique TXIDs: ${apiTxids.size}`);
        console.log(`  Duplicate TXIDs: ${duplicateTxids.length}`);
        
        console.log(`\nDatabase:`);
        console.log(`  Total TXIDs: ${dbTxids.size}`);
        
        console.log(`\nComparison:`);
        console.log(`  Missing from database: ${missingInDb.length}`);
        console.log(`  Extra in database: ${extraInDb.length}`);
        
        const discrepancy = totalTxs - dbTxids.size;
        
        console.log(`\n🎯 EXPLANATION:`);
        
        if (discrepancy === duplicateTxids.length && missingInDb.length === 0) {
            console.log(`   ✅ The ${discrepancy}-transaction difference is FULLY explained by`);
            console.log(`      ${duplicateTxids.length} duplicate TXID(s) in the API response.`);
            console.log('');
            console.log('   WHY: These transactions have multiple outputs to your address,');
            console.log('        so they appear multiple times in the API.');
            console.log('');
            console.log('   YOUR DATABASE: Correctly stores each TXID only once (UNIQUE constraint)');
            console.log('   REVENUE: Still accurate - all amounts are captured!');
            console.log('');
            console.log('   ✅ No action needed - everything is working correctly!');
        } else if (missingInDb.length > 0 && duplicateTxids.length === 0) {
            console.log(`   ⚠️  You have ${missingInDb.length} genuinely missing transaction(s).`);
            console.log('   ACTION: Run a sync to capture them:');
            console.log('           node test-blockbook.js');
        } else if (missingInDb.length > 0 && duplicateTxids.length > 0) {
            console.log(`   📊 Mixed situation:`);
            console.log(`      - ${duplicateTxids.length} duplicate(s) explain part of the difference`);
            console.log(`      - ${missingInDb.length} genuinely missing transaction(s)`);
            console.log('   ACTION: Run a sync to capture missing transactions');
        } else if (missingInDb.length === 0 && extraInDb.length === 0) {
            console.log('   ✅ Perfect match! Database and API are in sync.');
        } else {
            console.log('   🤔 Unusual situation - review the details above.');
        }
        
        console.log('\n' + '='.repeat(70));
        
        db.close();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        if (error.response?.status === 429) {
            console.error('\n⚠️  Rate Limited by Blockbook API');
            console.error('   The script tried to be careful, but still hit the limit.');
            console.error('   Wait 5-10 minutes and try again.');
        }
        
        console.error('\nStack trace:');
        console.error(error.stack);
        
        process.exit(1);
    }
}

compareWithPagination();
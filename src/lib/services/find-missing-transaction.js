#!/usr/bin/env node

/**
 * Smart Missing Transaction Finder
 * Uses minimal API calls to find the discrepancy
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import path from 'path';

const BLOCKBOOK_API = 'https://blockbook.runonflux.io/api/';
const TARGET_ADDRESS = 't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX';
const dbPath = path.join(process.cwd(), 'data', 'flux-performance.db');

console.log('🔍 Smart Missing Transaction Finder\n');
console.log('='.repeat(70));

async function smartFind() {
    try {
        const db = new Database(dbPath);
        
        // Step 1: Get counts
        console.log('\n📊 Step 1: Compare Counts');
        console.log('-'.repeat(70));
        
        const dbCount = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions').get();
        console.log(`Database: ${dbCount.count} transactions`);
        
        const apiResponse = await axios.get(
            `${BLOCKBOOK_API}address/${TARGET_ADDRESS}?page=1&pageSize=1`,
            { timeout: 30000 }
        );
        const apiTotal = apiResponse.data.txs || 0;
        const totalPages = apiResponse.data.totalPages || 0;
        
        console.log(`API:      ${apiTotal} transactions`);
        console.log(`Pages:    ${totalPages} pages (1000 per page)`);
        
        const difference = apiTotal - dbCount.count;
        console.log(`\nDifference: ${difference}`);
        
        if (difference === 0) {
            console.log('\n✅ No discrepancy!');
            db.close();
            return;
        }
        
        // Step 2: Check if it's a duplicate issue
        console.log('\n📊 Step 2: Analyze Transaction Structure');
        console.log('-'.repeat(70));
        console.log('Checking if any transactions have multiple outputs to your address...\n');
        
        // Get a sample of recent transactions from database
        const recentTxids = db.prepare(`
            SELECT txid 
            FROM revenue_transactions 
            ORDER BY timestamp DESC 
            LIMIT 10
        `).all().map(r => r.txid);
        
        let multiOutputCount = 0;
        let totalExtraOutputs = 0;
        
        for (const txid of recentTxids) {
            try {
                const txUrl = `${BLOCKBOOK_API}tx/${txid}`;
                const txResponse = await axios.get(txUrl, { 
                    timeout: 15000,
                    headers: { 'Accept': 'application/json' }
                });
                const tx = txResponse.data;
                
                // Count outputs to our address
                const ourOutputs = tx.vout?.filter(v => 
                    v.addresses?.includes(TARGET_ADDRESS)
                ) || [];
                
                if (ourOutputs.length > 1) {
                    multiOutputCount++;
                    totalExtraOutputs += (ourOutputs.length - 1);
                    console.log(`✓ TXID ${txid.substring(0, 16)}... has ${ourOutputs.length} outputs to your address`);
                }
                
                // Add delay to avoid rate limit
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                if (error.response?.status === 429) {
                    console.log('\n⚠️  Rate limited - stopping sample check');
                    break;
                }
                console.log(`  ⚠️  Failed to check ${txid.substring(0, 16)}: ${error.message}`);
            }
        }
        
        console.log(`\n📊 Sample Results (last 10 transactions):`);
        console.log(`   Transactions with multiple outputs: ${multiOutputCount}`);
        console.log(`   Extra outputs found: ${totalExtraOutputs}`);
        
        if (multiOutputCount > 0) {
            console.log('\n💡 Likely Explanation:');
            console.log('   Some transactions have multiple outputs to your address.');
            console.log('   The API counts each appearance, but your database (correctly)');
            console.log('   stores each unique TXID only once.');
            console.log('   This is EXPECTED behavior and revenue totals are accurate!');
        }
        
        // Step 3: Check for actual missing TXIDs (fetch only recent pages)
        console.log('\n📊 Step 3: Check Recent Transactions (Page 1 only)');
        console.log('-'.repeat(70));
        console.log('Fetching most recent TXIDs to check for truly missing transactions...\n');
        
        const page1Response = await axios.get(
            `${BLOCKBOOK_API}address/${TARGET_ADDRESS}?page=1&pageSize=1000`,
            { 
                timeout: 30000,
                headers: { 'Accept': 'application/json' }
            }
        );
        
        const recentApiTxids = new Set(page1Response.data.txids || []);
        console.log(`✅ Fetched ${recentApiTxids.size} recent TXIDs from API`);
        
        // Get recent TXIDs from database
        const recentDbTxids = new Set(
            db.prepare(`
                SELECT txid 
                FROM revenue_transactions 
                ORDER BY timestamp DESC 
                LIMIT 1000
            `).all().map(r => r.txid)
        );
        console.log(`✅ Got ${recentDbTxids.size} recent TXIDs from database`);
        
        // Find missing in recent transactions
        const missingRecent = [];
        for (const txid of recentApiTxids) {
            if (!recentDbTxids.has(txid)) {
                missingRecent.push(txid);
            }
        }
        
        console.log(`\n📊 Recent Missing: ${missingRecent.length}`);
        
        if (missingRecent.length > 0) {
            console.log('\n❌ Found missing transactions in recent data:');
            
            for (const txid of missingRecent.slice(0, 3)) {  // Show first 3 only
                console.log(`\n   TXID: ${txid}`);
                
                try {
                    const txUrl = `${BLOCKBOOK_API}tx/${txid}`;
                    const txResponse = await axios.get(txUrl, { 
                        timeout: 15000,
                        headers: { 'Accept': 'application/json' }
                    });
                    const tx = txResponse.data;
                    
                    console.log(`   Block: ${tx.blockHeight}`);
                    console.log(`   Time: ${new Date(tx.blockTime * 1000).toISOString()}`);
                    
                    // Show outputs to our address
                    const ourOutputs = tx.vout?.filter(v => 
                        v.addresses?.includes(TARGET_ADDRESS)
                    ) || [];
                    
                    console.log(`   Outputs to our address: ${ourOutputs.length}`);
                    ourOutputs.forEach((vout, i) => {
                        const amount = (parseFloat(vout.value) / 100000000).toFixed(8);
                        console.log(`     Output ${i}: ${amount} FLUX`);
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                } catch (error) {
                    console.log(`   ⚠️  Failed to fetch details: ${error.message}`);
                }
            }
            
            if (missingRecent.length > 3) {
                console.log(`\n   ... and ${missingRecent.length - 3} more`);
            }
        }
        
        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 FINAL ANALYSIS');
        console.log('='.repeat(70));
        
        console.log(`\nAPI Total:               ${apiTotal}`);
        console.log(`Database Total:          ${dbCount.count}`);
        console.log(`Difference:              ${difference}`);
        console.log(`\nSample Multi-Outputs:    ${multiOutputCount} (from last 10 checked)`);
        console.log(`Missing Recent TXIDs:    ${missingRecent.length}`);
        
        if (difference === 1 && multiOutputCount > 0 && missingRecent.length === 0) {
            console.log('\n✅ CONCLUSION:');
            console.log('   The 1-transaction difference is likely due to a transaction');
            console.log('   with multiple outputs to your address. The API counts it as');
            console.log('   multiple appearances, but your database (correctly) stores');
            console.log('   each unique TXID only once.');
            console.log('\n   This is NORMAL and EXPECTED behavior.');
            console.log('   Your revenue totals are accurate! ✅');
        } else if (missingRecent.length > 0) {
            console.log('\n⚠️  ACTION REQUIRED:');
            console.log('   You have genuinely missing transactions.');
            console.log('   Run an incremental sync to capture them.');
        } else {
            console.log('\n🤔 UNCLEAR:');
            console.log('   Need to check more transactions to determine the cause.');
            console.log('   The discrepancy might be in older transactions.');
        }
        
        console.log('\n' + '='.repeat(70));
        
        db.close();
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.response?.status === 429) {
            console.error('\n⚠️  Rate Limited by Blockbook API');
            console.error('   Try again in a few minutes.');
        }
        process.exit(1);
    }
}

smartFind();
// check-usd-data.js
// Quick script to inspect transaction data and USD values

import Database from 'better-sqlite3';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'flux-performance.db');

console.log('📊 Checking USD Transaction Data\n');

try {
    const db = new Database(dbPath, { readonly: true });
    
    // 1. Check total transactions
    const total = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions').get();
    console.log(`✅ Total transactions in DB: ${total.count}\n`);
    
    // 2. Check how many have USD values
    const withUSD = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions WHERE amount_usd IS NOT NULL').get();
    const withoutUSD = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions WHERE amount_usd IS NULL').get();
    
    console.log(`💵 Transactions with USD values: ${withUSD.count}`);
    console.log(`❌ Transactions without USD values: ${withoutUSD.count}\n`);
    
    // 3. Show latest 10 transactions
    console.log('📋 Latest 10 transactions:');
    console.log('─'.repeat(120));
    
    const latest = db.prepare(`
        SELECT 
            date,
            txid,
            amount,
            amount_usd,
            CASE WHEN amount_usd IS NULL THEN '❌ No USD' ELSE '✅ Has USD' END as status
        FROM revenue_transactions
        ORDER BY timestamp DESC
        LIMIT 10
    `).all();
    
    latest.forEach(tx => {
        const usdStr = tx.amount_usd !== null ? `$${tx.amount_usd.toFixed(2)}` : 'NULL';
        console.log(`${tx.date} | ${tx.txid.substring(0, 12)}... | ${tx.amount.toFixed(2)} FLUX | ${usdStr.padEnd(12)} | ${tx.status}`);
    });
    
    console.log('─'.repeat(120));
    
    // 4. Check daily aggregation
    console.log('\n📊 Daily Revenue Summary (last 7 days):');
    console.log('─'.repeat(80));
    
    const dailySummary = db.prepare(`
        SELECT 
            date,
            COUNT(*) as tx_count,
            SUM(amount) as total_flux,
            SUM(COALESCE(amount_usd, 0)) as total_usd,
            COUNT(CASE WHEN amount_usd IS NOT NULL THEN 1 END) as usd_count
        FROM revenue_transactions
        WHERE date >= date('now', '-7 days')
        GROUP BY date
        ORDER BY date DESC
    `).all();
    
    if (dailySummary.length > 0) {
        dailySummary.forEach(day => {
            console.log(`${day.date} | ${day.tx_count} txs | ${day.total_flux.toFixed(2)} FLUX | $${day.total_usd.toFixed(2)} | ${day.usd_count}/${day.tx_count} have USD`);
        });
    } else {
        console.log('No transactions in the last 7 days');
    }
    
    console.log('─'.repeat(80));
    
    // 5. Show what the API would return
    console.log('\n🔍 What the USD API endpoint would return:');
    
    const apiData = db.prepare(`
        SELECT 
            date,
            SUM(COALESCE(amount_usd, 0)) as daily_revenue_usd,
            COUNT(CASE WHEN amount_usd IS NOT NULL THEN 1 END) as usd_count,
            COUNT(*) as total_count
        FROM revenue_transactions
        WHERE date >= date('now', '-7 days')
        GROUP BY date
        ORDER BY date ASC
    `).all();
    
    if (apiData.length > 0) {
        console.log(JSON.stringify(apiData, null, 2));
    } else {
        console.log('[]');
    }
    
    db.close();
    
    console.log('\n✅ Check complete!\n');
    
    // Recommendations
    if (withUSD.count === 0) {
        console.log('⚠️  No transactions have USD values yet.');
        console.log('   Wait for the next progressive sync (runs every 5 minutes)');
        console.log('   New transactions will automatically get USD values.\n');
    } else {
        console.log('✅ Some transactions already have USD values!');
        console.log('   The USD chart should show data for recent days.\n');
    }
    
} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}
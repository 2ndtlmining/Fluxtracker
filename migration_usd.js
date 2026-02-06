// migration-add-usd.js
// Run this once to add the amount_usd column to existing revenue_transactions table

import Database from 'better-sqlite3';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'flux-performance.db');

console.log('🔄 Starting database migration: Add amount_usd column\n');

try {
    const db = new Database(dbPath);
    
    // Check if column already exists
    const columns = db.prepare("PRAGMA table_info(revenue_transactions)").all();
    const hasAmountUSD = columns.some(col => col.name === 'amount_usd');
    
    if (hasAmountUSD) {
        console.log('✅ Column amount_usd already exists - no migration needed');
        db.close();
        process.exit(0);
    }
    
    console.log('📋 Current columns:');
    columns.forEach(col => {
        console.log(`   - ${col.name} (${col.type})`);
    });
    
    console.log('\n➕ Adding amount_usd column...');
    
    // Add the new column (REAL type, allows NULL for historical data)
    db.exec('ALTER TABLE revenue_transactions ADD COLUMN amount_usd REAL');
    
    console.log('✅ Column added successfully!\n');
    
    // Verify it was added
    const newColumns = db.prepare("PRAGMA table_info(revenue_transactions)").all();
    console.log('📋 Updated columns:');
    newColumns.forEach(col => {
        console.log(`   - ${col.name} (${col.type})`);
    });
    
    // Count transactions
    const count = db.prepare('SELECT COUNT(*) as count FROM revenue_transactions').get();
    console.log(`\n📊 Database has ${count.count} existing transactions`);
    console.log('   (These will have amount_usd = NULL until new transactions sync)\n');
    
    db.close();
    
    console.log('✅ Migration completed successfully!');
    console.log('   You can now restart your server.\n');
    
} catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
}
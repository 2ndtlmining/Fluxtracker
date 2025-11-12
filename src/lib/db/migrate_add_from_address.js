/**
 * DATABASE MIGRATION: Add from_address column
 * 
 * This script adds the from_address column to the revenue_transactions table
 * and creates an index for better query performance.
 */

import Database from 'better-sqlite3';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'flux-performance.db');

console.log('🔄 Starting database migration...');
console.log(`   Database: ${dbPath}\n`);

try {
    const db = new Database(dbPath);
    
    // Check if column already exists
    const tableInfo = db.prepare("PRAGMA table_info(revenue_transactions)").all();
    const hasFromAddress = tableInfo.some(col => col.name === 'from_address');
    
    if (hasFromAddress) {
        console.log('✅ Column from_address already exists - no migration needed');
        db.close();
        process.exit(0);
    }
    
    console.log('📝 Adding from_address column to revenue_transactions table...');
    
    // Add the new column
    db.exec(`
        ALTER TABLE revenue_transactions 
        ADD COLUMN from_address TEXT DEFAULT 'Unknown';
    `);
    
    console.log('✅ Column added successfully');
    
    // Create index for the new column
    console.log('📝 Creating index on from_address...');
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_from_address 
        ON revenue_transactions(from_address);
    `);
    
    console.log('✅ Index created successfully');
    
    // Get statistics
    const stats = db.prepare(`
        SELECT 
            COUNT(*) as total_transactions,
            COUNT(CASE WHEN from_address = 'Unknown' THEN 1 END) as unknown_count
        FROM revenue_transactions
    `).get();
    
    console.log('\n📊 Migration Statistics:');
    console.log(`   Total transactions: ${stats.total_transactions}`);
    console.log(`   With unknown sender: ${stats.unknown_count}`);
    console.log(`   With known sender: ${stats.total_transactions - stats.unknown_count}`);
    
    db.close();
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n⚠️  IMPORTANT: Existing transactions have from_address = "Unknown"');
    console.log('   New transactions will populate this field automatically.');
    console.log('   To populate historical data, you would need to re-sync transactions.');
    
} catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
}
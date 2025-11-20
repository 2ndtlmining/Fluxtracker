// flux-performance-dashboard/src/lib/db/schemaMigrator.js

/**
 * SCHEMA MIGRATOR - AUTOMATIC COLUMN DETECTION & CREATION
 * 
 * This module automatically detects when new repos are added to config
 * and creates the necessary database columns WITHOUT losing any data.
 * 
 * Features:
 * - Runs automatically on server startup
 * - Can be triggered via API endpoint
 * - Safe: Uses ALTER TABLE which preserves all existing data
 * - Idempotent: Safe to run multiple times
 * - Transaction-based: All-or-nothing approach
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'flux-performance.db');

/**
 * Get all current columns in a table
 */
function getTableColumns(db, tableName) {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.map(col => col.name);
}

/**
 * Check if a column exists in a table
 */
function columnExists(db, tableName, columnName) {
    const columns = getTableColumns(db, tableName);
    return columns.includes(columnName);
}

/**
 * Add a column to a table (safe - preserves all data)
 */
function addColumn(db, tableName, columnName, columnType = 'INTEGER DEFAULT 0') {
    try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`);
        return true;
    } catch (error) {
        if (error.message.includes('duplicate column name')) {
            // Column already exists - this is fine
            return false;
        }
        throw error;
    }
}

/**
 * Extract all repo dbKeys from a config array
 */
function extractRepoKeys(repoConfig) {
    if (!Array.isArray(repoConfig)) {
        return [];
    }
    return repoConfig.map(repo => repo.dbKey).filter(Boolean);
}

/**
 * MAIN MIGRATION FUNCTION
 * Analyzes config and ensures all columns exist
 */
export async function migrateSchema(config) {
    const db = new Database(dbPath);
    
    const results = {
        success: true,
        columnsAdded: [],
        columnsExisting: [],
        errors: [],
        timestamp: new Date().toISOString()
    };
    
    try {
        console.log('\n🔄 Starting schema migration...');
        
        // Extract all repo keys from config
        const allRepoKeys = [
            ...extractRepoKeys(config.GAMING_REPOS || []),
            ...extractRepoKeys(config.CRYPTO_REPOS || []),
            ...extractRepoKeys(config.OTHER_REPOS || [])
        ];
        
        if (allRepoKeys.length === 0) {
            console.log('ℹ️  No repo keys found in config, skipping migration');
            return results;
        }
        
        console.log(`   Found ${allRepoKeys.length} repo keys in config`);
        
        // Tables that need to track these repos
        const targetTables = ['current_metrics', 'daily_snapshots'];
        
        // Begin transaction for safety
        db.exec('BEGIN TRANSACTION');
        
        try {
            for (const tableName of targetTables) {
                console.log(`\n   📋 Checking table: ${tableName}`);
                
                for (const repoKey of allRepoKeys) {
                    if (columnExists(db, tableName, repoKey)) {
                        console.log(`      ✓ ${repoKey} - exists`);
                        results.columnsExisting.push({ table: tableName, column: repoKey });
                    } else {
                        console.log(`      + ${repoKey} - adding...`);
                        addColumn(db, tableName, repoKey, 'INTEGER DEFAULT 0');
                        console.log(`      ✅ ${repoKey} - added successfully`);
                        results.columnsAdded.push({ table: tableName, column: repoKey });
                    }
                }
            }
            
            // Commit transaction
            db.exec('COMMIT');
            console.log('\n✅ Schema migration completed successfully');
            
        } catch (error) {
            // Rollback on any error
            db.exec('ROLLBACK');
            throw error;
        }
        
        // Summary
        if (results.columnsAdded.length > 0) {
            console.log(`\n📊 Migration Summary:`);
            console.log(`   New columns added: ${results.columnsAdded.length}`);
            console.log(`   Existing columns: ${results.columnsExisting.length}`);
            results.columnsAdded.forEach(({ table, column }) => {
                console.log(`      • ${table}.${column}`);
            });
        } else {
            console.log('\n✓ Schema is up to date, no changes needed');
        }
        
    } catch (error) {
        console.error('\n❌ Schema migration failed:', error.message);
        results.success = false;
        results.errors.push(error.message);
        throw error;
    } finally {
        db.close();
    }
    
    return results;
}

/**
 * SAFE MIGRATION - Validates before making changes
 */
export async function validateAndMigrate(config) {
    try {
        // First, validate the config structure
        if (!config || typeof config !== 'object') {
            throw new Error('Invalid config: must be an object');
        }
        
        // Run the migration
        const results = await migrateSchema(config);
        
        return {
            success: true,
            message: 'Schema migration completed',
            ...results
        };
        
    } catch (error) {
        return {
            success: false,
            message: 'Schema migration failed',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * GET SCHEMA INFO - For debugging/monitoring
 */
export function getSchemaInfo() {
    const db = new Database(dbPath);
    
    try {
        const info = {
            current_metrics: getTableColumns(db, 'current_metrics'),
            daily_snapshots: getTableColumns(db, 'daily_snapshots'),
            timestamp: new Date().toISOString()
        };
        
        return info;
        
    } catch (error) {
        throw error;
    } finally {
        db.close();
    }
}

/**
 * DETECT MISSING COLUMNS - Compare config vs database
 */
export function detectMissingColumns(config) {
    const db = new Database(dbPath);
    
    try {
        const allRepoKeys = [
            ...extractRepoKeys(config.GAMING_REPOS || []),
            ...extractRepoKeys(config.CRYPTO_REPOS || []),
            ...extractRepoKeys(config.OTHER_REPOS || [])
        ];
        
        const missing = {
            current_metrics: [],
            daily_snapshots: []
        };
        
        for (const repoKey of allRepoKeys) {
            if (!columnExists(db, 'current_metrics', repoKey)) {
                missing.current_metrics.push(repoKey);
            }
            if (!columnExists(db, 'daily_snapshots', repoKey)) {
                missing.daily_snapshots.push(repoKey);
            }
        }
        
        return {
            hasMissingColumns: missing.current_metrics.length > 0 || missing.daily_snapshots.length > 0,
            missing,
            configRepoCount: allRepoKeys.length,
            timestamp: new Date().toISOString()
        };
        
    } finally {
        db.close();
    }
}
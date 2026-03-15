// Schema Migrator - Supabase (PostgreSQL) version
// Automatically detects when new repos are added to config
// and creates the necessary database columns.

import { supabase } from './supabaseClient.js';
import pg from 'pg';

const FIXED_COLUMNS = [
    { name: 'gitapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'dockerapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'gitapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    { name: 'dockerapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
];

async function getTableColumns(tableName) {
    // Query the table with limit 1 and inspect the returned keys
    const { data: sample, error } = await supabase.from(tableName).select('*').limit(1);
    if (error) {
        console.warn(`getTableColumns(${tableName}): ${error.message}`);
        return [];
    }
    if (sample && sample.length > 0) {
        return Object.keys(sample[0]);
    }
    // Table exists but is empty — insert a dummy row, read columns, then delete
    // This shouldn't happen for current_metrics/daily_snapshots (always have data)
    return [];
}

async function columnExists(tableName, columnName) {
    const columns = await getTableColumns(tableName);
    return columns.includes(columnName);
}

async function addColumn(tableName, columnName, columnType = 'INTEGER DEFAULT 0') {
    // DDL (ALTER TABLE) requires a direct PostgreSQL connection — PostgREST can't run DDL
    const dbUrl = process.env.SUPABASE_DB_URL
        || process.env.SUPABASE_URL?.replace(':54321', ':54322')?.replace('http://', 'postgresql://postgres:postgres@') + '/postgres';

    const client = new pg.Client({ connectionString: dbUrl });
    try {
        await client.connect();
        const sql = `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${columnType}`;
        await client.query(sql);
    } catch (error) {
        if (error.message?.includes('already exists')) {
            // Column already exists — this is fine
        } else {
            console.warn(`addColumn warning for ${tableName}.${columnName}:`, error.message);
        }
    } finally {
        await client.end();
    }
    return true;
}

function extractRepoKeys(repoConfig) {
    if (!Array.isArray(repoConfig)) return [];
    return repoConfig.map(repo => repo.dbKey).filter(Boolean);
}

export async function migrateSchema(config) {
    const results = {
        success: true,
        columnsAdded: [],
        columnsExisting: [],
        errors: [],
        timestamp: new Date().toISOString()
    };

    try {
        console.log('\n🔄 Starting schema migration...');

        const allRepoKeys = [
            ...extractRepoKeys(config.GAMING_REPOS || []),
            ...extractRepoKeys(config.CRYPTO_REPOS || []),
            ...extractRepoKeys(config.OTHER_REPOS || [])
        ];

        console.log(`   Found ${allRepoKeys.length} repo keys in config`);
        console.log(`   Found ${FIXED_COLUMNS.length} fixed app-level columns`);

        const targetTables = ['current_metrics', 'daily_snapshots'];

        // Check fixed columns
        for (const tableName of targetTables) {
            for (const fixedCol of FIXED_COLUMNS) {
                const exists = await columnExists(tableName, fixedCol.name);
                if (exists) {
                    results.columnsExisting.push({ table: tableName, column: fixedCol.name, type: 'fixed' });
                } else {
                    await addColumn(tableName, fixedCol.name, fixedCol.type);
                    results.columnsAdded.push({ table: tableName, column: fixedCol.name, type: 'fixed' });
                    console.log(`      ✅ ${tableName}.${fixedCol.name} - added`);
                }
            }
        }

        // Check config-based repo columns
        if (allRepoKeys.length > 0) {
            for (const tableName of targetTables) {
                for (const repoKey of allRepoKeys) {
                    const exists = await columnExists(tableName, repoKey);
                    if (exists) {
                        results.columnsExisting.push({ table: tableName, column: repoKey, type: 'config' });
                    } else {
                        await addColumn(tableName, repoKey, 'INTEGER DEFAULT 0');
                        results.columnsAdded.push({ table: tableName, column: repoKey, type: 'config' });
                        console.log(`      ✅ ${tableName}.${repoKey} - added`);
                    }
                }
            }
        }

        if (results.columnsAdded.length > 0) {
            console.log(`\n✅ Schema migration completed: ${results.columnsAdded.length} new columns added`);
        } else {
            console.log('\n✓ Schema is up to date, no changes needed');
        }

    } catch (error) {
        console.error('\n❌ Schema migration failed:', error.message);
        results.success = false;
        results.errors.push(error.message);
    }

    return results;
}

export async function validateAndMigrate(config) {
    try {
        if (!config || typeof config !== 'object') {
            throw new Error('Invalid config: must be an object');
        }
        const results = await migrateSchema(config);
        return { success: true, message: 'Schema migration completed', ...results };
    } catch (error) {
        return { success: false, message: 'Schema migration failed', error: error.message, timestamp: new Date().toISOString() };
    }
}

export async function getSchemaInfo() {
    const currentMetricsCols = await getTableColumns('current_metrics');
    const dailySnapshotsCols = await getTableColumns('daily_snapshots');

    return {
        current_metrics: currentMetricsCols,
        daily_snapshots: dailySnapshotsCols,
        fixed_columns: FIXED_COLUMNS.map(c => c.name),
        timestamp: new Date().toISOString()
    };
}

export async function detectMissingColumns(config) {
    const allRepoKeys = [
        ...extractRepoKeys(config.GAMING_REPOS || []),
        ...extractRepoKeys(config.CRYPTO_REPOS || []),
        ...extractRepoKeys(config.OTHER_REPOS || [])
    ];

    const missing = { current_metrics: [], daily_snapshots: [] };

    for (const fixedCol of FIXED_COLUMNS) {
        if (!(await columnExists('current_metrics', fixedCol.name))) {
            missing.current_metrics.push({ name: fixedCol.name, type: 'fixed' });
        }
        if (!(await columnExists('daily_snapshots', fixedCol.name))) {
            missing.daily_snapshots.push({ name: fixedCol.name, type: 'fixed' });
        }
    }

    for (const repoKey of allRepoKeys) {
        if (!(await columnExists('current_metrics', repoKey))) {
            missing.current_metrics.push({ name: repoKey, type: 'config' });
        }
        if (!(await columnExists('daily_snapshots', repoKey))) {
            missing.daily_snapshots.push({ name: repoKey, type: 'config' });
        }
    }

    return {
        hasMissingColumns: missing.current_metrics.length > 0 || missing.daily_snapshots.length > 0,
        missing,
        fixedColumnCount: FIXED_COLUMNS.length,
        configRepoCount: allRepoKeys.length,
        timestamp: new Date().toISOString()
    };
}

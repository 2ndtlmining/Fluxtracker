// Schema Migrator — supports both Supabase (PostgreSQL) and SQLite
// Automatically detects when new repos are added to config
// and creates the necessary database columns.

const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();

const FIXED_COLUMNS = [
    { name: 'gitapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'dockerapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'gitapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    { name: 'dockerapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
];

// ============================================
// SQLite column detection + addition
// ============================================

async function sqliteGetTableColumns(db, tableName) {
    const rows = db.pragma(`table_info(${tableName})`);
    return rows.map(r => r.name);
}

async function sqliteAddColumn(db, tableName, columnName, columnType = 'INTEGER DEFAULT 0') {
    try {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    } catch (error) {
        if (error.message?.includes('duplicate column name')) {
            // Column already exists — this is fine
        } else {
            console.warn(`addColumn warning for ${tableName}.${columnName}:`, error.message);
        }
    }
    return true;
}

// ============================================
// Supabase column detection + addition
// ============================================

async function supabaseGetTableColumns(supabase, tableName) {
    const { data: sample, error } = await supabase.from(tableName).select('*').limit(1);
    if (error) {
        console.warn(`getTableColumns(${tableName}): ${error.message}`);
        return [];
    }
    if (sample && sample.length > 0) {
        return Object.keys(sample[0]);
    }
    return [];
}

async function supabaseAddColumn(tableName, columnName, columnType = 'INTEGER DEFAULT 0') {
    const pg = await import('pg');
    const dbUrl = process.env.SUPABASE_DB_URL
        || process.env.SUPABASE_URL?.replace(':54321', ':54322')?.replace('http://', 'postgresql://postgres:postgres@') + '/postgres';

    const client = new pg.default.Client({ connectionString: dbUrl });
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

// ============================================
// Shared logic
// ============================================

function extractRepoKeys(repoConfig) {
    if (!Array.isArray(repoConfig)) return [];
    return repoConfig.map(repo => repo.dbKey).filter(Boolean);
}

async function getColumns(tableName, ctx) {
    if (dbType === 'sqlite') {
        return sqliteGetTableColumns(ctx, tableName);
    }
    return supabaseGetTableColumns(ctx, tableName);
}

async function addCol(tableName, columnName, columnType, ctx) {
    if (dbType === 'sqlite') {
        return sqliteAddColumn(ctx, tableName, columnName, columnType);
    }
    return supabaseAddColumn(tableName, columnName, columnType);
}

export async function migrateSchema(config, ctx) {
    // ctx: for SQLite = the db instance, for Supabase = the supabase client (or auto-imported)
    const results = {
        success: true,
        columnsAdded: [],
        columnsExisting: [],
        errors: [],
        timestamp: new Date().toISOString()
    };

    try {
        console.log('\n🔄 Starting schema migration...');

        // For Supabase, auto-import the client if ctx not passed
        if (dbType !== 'sqlite' && !ctx) {
            const { supabase } = await import('./supabaseClient.js');
            ctx = supabase;
        }

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
            const columns = await getColumns(tableName, ctx);
            for (const fixedCol of FIXED_COLUMNS) {
                if (columns.includes(fixedCol.name)) {
                    results.columnsExisting.push({ table: tableName, column: fixedCol.name, type: 'fixed' });
                } else {
                    await addCol(tableName, fixedCol.name, fixedCol.type, ctx);
                    results.columnsAdded.push({ table: tableName, column: fixedCol.name, type: 'fixed' });
                    console.log(`      ✅ ${tableName}.${fixedCol.name} - added`);
                }
            }
        }

        // Check config-based repo columns
        if (allRepoKeys.length > 0) {
            for (const tableName of targetTables) {
                const columns = await getColumns(tableName, ctx);
                for (const repoKey of allRepoKeys) {
                    if (columns.includes(repoKey)) {
                        results.columnsExisting.push({ table: tableName, column: repoKey, type: 'config' });
                    } else {
                        await addCol(tableName, repoKey, 'INTEGER DEFAULT 0', ctx);
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

export async function validateAndMigrate(config, ctx) {
    try {
        if (!config || typeof config !== 'object') {
            throw new Error('Invalid config: must be an object');
        }
        const results = await migrateSchema(config, ctx);
        return { success: true, message: 'Schema migration completed', ...results };
    } catch (error) {
        return { success: false, message: 'Schema migration failed', error: error.message, timestamp: new Date().toISOString() };
    }
}

export async function getSchemaInfo(ctx) {
    const currentMetricsCols = await getColumns('current_metrics', ctx);
    const dailySnapshotsCols = await getColumns('daily_snapshots', ctx);

    return {
        current_metrics: currentMetricsCols,
        daily_snapshots: dailySnapshotsCols,
        fixed_columns: FIXED_COLUMNS.map(c => c.name),
        timestamp: new Date().toISOString()
    };
}

export async function detectMissingColumns(config, ctx) {
    // For Supabase, auto-import the client if ctx not passed
    if (dbType !== 'sqlite' && !ctx) {
        const { supabase } = await import('./supabaseClient.js');
        ctx = supabase;
    }

    const allRepoKeys = [
        ...extractRepoKeys(config.GAMING_REPOS || []),
        ...extractRepoKeys(config.CRYPTO_REPOS || []),
        ...extractRepoKeys(config.OTHER_REPOS || [])
    ];

    const missing = { current_metrics: [], daily_snapshots: [] };

    for (const tableName of ['current_metrics', 'daily_snapshots']) {
        const columns = await getColumns(tableName, ctx);
        for (const fixedCol of FIXED_COLUMNS) {
            if (!columns.includes(fixedCol.name)) {
                missing[tableName].push({ name: fixedCol.name, type: 'fixed' });
            }
        }
        for (const repoKey of allRepoKeys) {
            if (!columns.includes(repoKey)) {
                missing[tableName].push({ name: repoKey, type: 'config' });
            }
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

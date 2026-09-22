// Schema Migrator — supports both Supabase (PostgreSQL) and SQLite
// Automatically detects when new repos are added to config
// and creates the necessary database columns.

const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();

const FIXED_COLUMNS = [
    { name: 'gitapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'dockerapps_count', type: 'INTEGER DEFAULT 0' },
    { name: 'gitapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    { name: 'dockerapps_percent', type: 'DOUBLE PRECISION DEFAULT 0' },
    // No DEFAULT on these three, deliberately: an existing row must read back NULL
    // ("not classified yet"), never a fabricated 0% that would misreport as a real
    // reading. Every other FIXED_COLUMNS entry defaults to 0 because 0 IS a valid
    // reading for those; it is not for a percent this feature hasn't computed yet.
    { name: 'decentralization_datacenter_count', type: 'INTEGER' },
    { name: 'decentralization_independent_count', type: 'INTEGER' },
    { name: 'decentralization_datacenter_percent', type: 'DOUBLE PRECISION' },
    // Same reasoning as the decentralization columns above: no DEFAULT, so a row
    // predating this feature reads back NULL ("no reading taken"), never a fabricated 0
    // that would misreport as "nothing was deployed/expiring that day".
    { name: 'apps_deployed_today', type: 'INTEGER' },
    { name: 'apps_expiring_today', type: 'INTEGER' },
    // Issue #162/#163. No DEFAULT, same reasoning as the two above: every row written
    // before app-name matching shipped has no reading for this, and a fabricated 0 would
    // render as "no game instances ran that day" -- which is both false and indistinguishable
    // from a real collection failure (the KPI layer treats a 0 here as missing by design).
    { name: 'gaming_instances_total', type: 'INTEGER' },
    // Issue #201. No DEFAULT, same reasoning again: a 0 would read as "no wallets ran
    // nodes that day", which is false for every row predating this feature and cannot be
    // told apart from a collection failure. Nodes-per-wallet is NOT stored -- it is
    // node_total / unique_wallets, derived at read time so it cannot drift.
    { name: 'unique_wallets', type: 'INTEGER' },
    // Issue #209. No DEFAULT, same reasoning: a 0 would read as "nobody ran an app that
    // day", false for every row predating this feature and indistinguishable from a
    // collection failure. Apps-per-owner is NOT stored -- it is total_apps /
    // unique_app_owners, derived at read time so it cannot drift.
    { name: 'unique_app_owners', type: 'INTEGER' },
    // Issue #210. DOUBLE PRECISION and no DEFAULT: a 0 would read as "no collateral was
    // locked that day", false for every row predating this feature. Node collection is
    // all-or-nothing, so these four are written together or not at all.
    { name: 'locked_collateral_cumulus', type: 'DOUBLE PRECISION' },
    { name: 'locked_collateral_nimbus', type: 'DOUBLE PRECISION' },
    { name: 'locked_collateral_stratus', type: 'DOUBLE PRECISION' },
    { name: 'locked_collateral', type: 'DOUBLE PRECISION' },
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
            // TRACKED_GAMES is a superset of GAMING_REPOS: the games stored per-game
            // include dedicated-site ones with no matchable image (issue #231).
            ...extractRepoKeys(config.TRACKED_GAMES || config.GAMING_REPOS || []),
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
        ...extractRepoKeys(config.TRACKED_GAMES || config.GAMING_REPOS || []),
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

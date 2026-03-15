/**
 * Apply RPC Functions to Cloud Supabase
 *
 * Connects via direct PostgreSQL connection string (not PostgREST)
 * and runs all RPC function definitions from 002_rpc_functions.sql.
 *
 * All functions use CREATE OR REPLACE — safe to run while live traffic
 * hits the old image (adding functions doesn't affect existing queries).
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres.[ref]:[pass]@..." node scripts/apply-rpc-to-cloud.mjs
 *
 * Or set DATABASE_URL in .env / .env.local
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env fallbacks
if (!process.env.DATABASE_URL) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('Missing DATABASE_URL environment variable.');
    console.error('Set it to your cloud Supabase direct connection string:');
    console.error('  postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres');
    process.exit(1);
}

// Mask password in logs
const maskedUrl = DATABASE_URL.replace(/:([^@]+)@/, ':***@');
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Apply RPC Functions to Cloud Supabase');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Target: ${maskedUrl}`);

const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '002_rpc_functions.sql');
const sql = fs.readFileSync(sqlPath, 'utf-8');

// Count functions in the SQL
const fnCount = (sql.match(/CREATE OR REPLACE FUNCTION/gi) || []).length;
console.log(`SQL file: ${path.basename(sqlPath)} (${fnCount} functions)\n`);

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
    await client.connect();
    console.log('Connected to cloud Supabase.');

    await client.query(sql);
    console.log(`Successfully applied ${fnCount} RPC functions.`);

    // Verify: list the functions we just created
    const { rows } = await client.query(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
          AND routine_type = 'FUNCTION'
          AND routine_name LIKE 'get_%'
        ORDER BY routine_name;
    `);
    console.log(`\nVerification — public get_* functions in DB:`);
    rows.forEach(r => console.log(`  ✓ ${r.routine_name}`));

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log('  Step 1 complete — RPC functions applied.');
    console.log('  Safe to deploy new Docker image now.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
} catch (err) {
    console.error('Failed to apply RPC functions:', err.message);
    process.exit(1);
} finally {
    await client.end();
}

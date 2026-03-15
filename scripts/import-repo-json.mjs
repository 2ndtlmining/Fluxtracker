/**
 * Import Historical Repo Snapshots from JSON Files
 *
 * Reads docker_count_*.json files from data/repo_json/ and upserts them
 * into the repo_snapshots Supabase table. Idempotent — safe to re-run.
 *
 * Usage:
 *   node scripts/import-repo-json.mjs
 *
 * Requires:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local or environment
 *   - JSON files in data/repo_json/
 */

import 'dotenv/config';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env same way as supabaseClient.js
if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

const clean = (s) => s?.replace(/[^\x20-\x7E]/g, '').trim();
const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ── Category config (mirrors src/lib/config.js CATEGORY_CONFIG) ──
const CATEGORY_CONFIG = {
    gaming: {
        keywords: ['minecraft', 'palworld', 'enshrouded', 'valheim', 'satisfactory',
                   'ark-survival', 'arkserver', 'rust-server', 'terraria', 'factorio',
                   '7daystodie', 'vrising', 'projectzomboid', 'conan-exiles',
                   'game-server', 'arma-reforger', 'soulmask', 'abioticfactor'],
    },
    crypto: {
        keywords: [
            'presearch/node', 'streamr/node', 'streamr/broker-node',
            'ravencoin', 'kadena-chainweb', 'bitcoin-core', 'bitcoin-cash-node',
            'litecoin', 'dogecoin', 'zcash', 'monero', 'fironode', 'firod',
            'neoxa-node', 'iron-fish/ironfish',
            'rusty-kaspad', 'alephium-standalone', 'alephium/explorer',
            'bittensor', 'subtensor', 'client-go:stable', 'polkadot-docker',
            'wanchain/client-go', 'thornode', 'thorchain',
            'timpi-collector', 'timpi-geocore', 'beldex',
            'mysteriumnetwork/myst',
        ],
    },
    wordpress: {
        keywords: ['wordpress', 'wp-nginx'],
    }
};

function categorizeImage(imageName) {
    const lower = imageName.toLowerCase();
    for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
        if (config.keywords.some(kw => lower.includes(kw))) {
            return category;
        }
    }
    return null;
}

const CHUNK_SIZE = 500;
const JSON_DIR = path.join(process.cwd(), 'data', 'repo_json');

async function main() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Import Historical Repo Snapshots from JSON');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Target: ${SUPABASE_URL}`);

    if (!fs.existsSync(JSON_DIR)) {
        console.error(`JSON directory not found: ${JSON_DIR}`);
        process.exit(1);
    }

    // 1. Read all docker_count_*.json files
    const allFiles = fs.readdirSync(JSON_DIR)
        .filter(f => f.startsWith('docker_count_') && f.endsWith('.json'))
        .sort();

    console.log(`Found ${allFiles.length} JSON files`);

    if (allFiles.length === 0) {
        console.log('No files to import.');
        process.exit(0);
    }

    // 2. Group by date, keep only the latest file per day
    const byDate = new Map();
    for (const file of allFiles) {
        // docker_count_YYYY-MM-DD_HH-MM-SS.json
        const match = file.match(/^docker_count_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.json$/);
        if (!match) {
            console.warn(`Skipping unrecognized file: ${file}`);
            continue;
        }
        const date = match[1];
        const time = match[2]; // HH-MM-SS — lexicographic sort works for picking latest
        const existing = byDate.get(date);
        if (!existing || time > existing.time) {
            byDate.set(date, { time, file });
        }
    }

    const uniqueDates = [...byDate.keys()].sort();
    console.log(`Unique dates: ${uniqueDates.length} (${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]})`);
    console.log(`Chunk size: ${CHUNK_SIZE}\n`);

    const startTime = Date.now();
    let totalRows = 0;
    let totalErrors = 0;
    let filesProcessed = 0;
    const now = Math.floor(Date.now() / 1000);

    // 3. Process each date's file
    let pendingRows = [];

    for (const date of uniqueDates) {
        const { file } = byDate.get(date);
        const filePath = path.join(JSON_DIR, file);

        let data;
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (err) {
            console.error(`Failed to parse ${file}: ${err.message}`);
            totalErrors++;
            continue;
        }

        const imageCounts = data.ImageCounts;
        if (!imageCounts || typeof imageCounts !== 'object') {
            console.warn(`No ImageCounts in ${file}, skipping`);
            continue;
        }

        for (const [imageName, instanceCount] of Object.entries(imageCounts)) {
            pendingRows.push({
                snapshot_date: date,
                image_name: imageName,
                instance_count: instanceCount,
                category: categorizeImage(imageName),
                created_at: now
            });
        }

        filesProcessed++;

        // Flush when we have enough rows
        while (pendingRows.length >= CHUNK_SIZE) {
            const chunk = pendingRows.splice(0, CHUNK_SIZE);
            const { error } = await supabase
                .from('repo_snapshots')
                .upsert(chunk, {
                    onConflict: 'snapshot_date,image_name',
                    ignoreDuplicates: false
                });

            if (error) {
                console.error(`  Chunk error: ${error.message}`);
                totalErrors++;
            } else {
                totalRows += chunk.length;
            }
        }

        // Progress logging every 50 files
        if (filesProcessed % 50 === 0) {
            console.log(`  Progress: ${filesProcessed}/${uniqueDates.length} dates, ${totalRows} rows upserted`);
        }
    }

    // Flush remaining rows
    if (pendingRows.length > 0) {
        const { error } = await supabase
            .from('repo_snapshots')
            .upsert(pendingRows, {
                onConflict: 'snapshot_date,image_name',
                ignoreDuplicates: false
            });

        if (error) {
            console.error(`  Final chunk error: ${error.message}`);
            totalErrors++;
        } else {
            totalRows += pendingRows.length;
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  Import complete in ${elapsed}s`);
    console.log(`  Files processed: ${filesProcessed}`);
    console.log(`  Rows upserted: ${totalRows}`);
    console.log(`  Errors: ${totalErrors}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // 4. Verification
    console.log('\nVerification:');
    const { count } = await supabase
        .from('repo_snapshots')
        .select('*', { count: 'exact', head: true });
    console.log(`  Total rows in repo_snapshots: ${count}`);

    const { data: dateRange } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: true })
        .limit(1);
    const { data: dateRangeEnd } = await supabase
        .from('repo_snapshots')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: false })
        .limit(1);

    if (dateRange?.[0] && dateRangeEnd?.[0]) {
        console.log(`  Date range: ${dateRange[0].snapshot_date} to ${dateRangeEnd[0].snapshot_date}`);
    }

    console.log(`  Unique dates imported: ${uniqueDates.length}`);

    console.log('');
}

main().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
});

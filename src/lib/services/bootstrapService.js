/**
 * BOOTSTRAP SERVICE — Downloads latest R2 backup and imports into local SQLite DB.
 *
 * Only runs in SQLite mode (DB_TYPE=sqlite) when the DB is empty/new.
 * Uses separate read-only credentials (BOOTSTRAP_R2_*) to prevent
 * Docker instances from accidentally writing to or deleting backups.
 *
 * Env vars:
 *   BOOTSTRAP_R2_ENDPOINT, BOOTSTRAP_R2_ACCESS_KEY_ID,
 *   BOOTSTRAP_R2_SECRET_ACCESS_KEY, BOOTSTRAP_R2_BUCKET_NAME
 */

import {
    S3Client,
    GetObjectCommand,
    ListObjectsV2Command
} from '@aws-sdk/client-s3';

import {
    upsertDailySnapshots,
    upsertRepoSnapshots,
    upsertPriceHistory
} from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('bootstrapService');

// ============================================
// CONFIGURATION
// ============================================

function getBootstrapConfig() {
    return {
        endpoint: process.env.BOOTSTRAP_R2_ENDPOINT,
        accessKeyId: process.env.BOOTSTRAP_R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.BOOTSTRAP_R2_SECRET_ACCESS_KEY,
        bucket: process.env.BOOTSTRAP_R2_BUCKET_NAME
    };
}

function isBootstrapConfigured() {
    const cfg = getBootstrapConfig();
    return !!(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);
}

// ============================================
// BOOTSTRAP LOGIC
// ============================================

export async function runBootstrap() {
    const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();
    if (dbType !== 'sqlite') {
        log.info('skipped (not SQLite mode)');
        return;
    }

    // Check if DB already has data (warm restart)
    try {
        const { default: Database } = await import('better-sqlite3');
        const DB_PATH = process.env.DB_PATH || 'data/fluxtracker.sqlite3';

        let needsBootstrap = true;

        try {
            const db = new Database(DB_PATH, { readonly: true });
            const row = db.prepare('SELECT COUNT(*) AS cnt FROM daily_snapshots').get();
            db.close();

            if (row && row.cnt > 0) {
                log.info({ count: row.cnt }, 'skipped (DB already has daily snapshots -- warm restart)');
                needsBootstrap = false;
            }
        } catch {
            // DB doesn't exist or has no tables yet — needs bootstrap
            log.info('fresh database detected');
        }

        if (!needsBootstrap) return;
    } catch (error) {
        log.info({ err: error }, 'cannot check DB state, proceeding');
    }

    // Check for bootstrap credentials
    if (!isBootstrapConfigured()) {
        log.warn('BOOTSTRAP_R2_* env vars not set -- starting with empty database');
        return;
    }

    log.info('downloading latest backup from R2');

    try {
        const cfg = getBootstrapConfig();
        const client = new S3Client({
            region: 'auto',
            endpoint: cfg.endpoint,
            credentials: {
                accessKeyId: cfg.accessKeyId,
                secretAccessKey: cfg.secretAccessKey
            }
        });

        // List backup dates, pick the latest
        const listResp = await client.send(new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: 'backups/',
            Delimiter: '/'
        }));

        const dates = (listResp.CommonPrefixes || [])
            .map(p => p.Prefix.replace('backups/', '').replace('/', ''))
            .filter(d => d.length > 0)
            .sort();

        if (dates.length === 0) {
            log.warn('no backups found in R2 -- starting with empty database');
            return;
        }

        const latestDate = dates[dates.length - 1];
        log.info({ date: latestDate }, 'using backup');

        // Download daily_snapshots
        let dailyCount = 0;
        try {
            log.info('downloading daily_snapshots');
            const dailyObj = await client.send(new GetObjectCommand({
                Bucket: cfg.bucket,
                Key: `backups/${latestDate}/daily_snapshots.json`
            }));
            const dailyJson = JSON.parse(await dailyObj.Body.transformToString());
            dailyCount = dailyJson.rows?.length || 0;

            if (dailyCount > 0) {
                await upsertDailySnapshots(dailyJson.rows);
                log.info({ count: dailyCount }, 'imported daily snapshots');
            }
        } catch (error) {
            dailyCount = 0;
            log.warn({ err: error }, 'daily_snapshots failed');
        }

        // Download repo_snapshots
        let repoCount = 0;
        try {
            log.info('downloading repo_snapshots');
            const repoObj = await client.send(new GetObjectCommand({
                Bucket: cfg.bucket,
                Key: `backups/${latestDate}/repo_snapshots.json`
            }));
            const repoJson = JSON.parse(await repoObj.Body.transformToString());
            repoCount = repoJson.rows?.length || 0;

            if (repoCount > 0) {
                await upsertRepoSnapshots(repoJson.rows);
                log.info({ count: repoCount }, 'imported repo snapshots');
            }
        } catch (error) {
            repoCount = 0;
            log.warn({ err: error }, 'repo_snapshots failed');
        }

        // Download flux_price_history (optional — may be missing)
        let priceCount = 0;
        try {
            log.info('downloading flux_price_history');
            const priceObj = await client.send(new GetObjectCommand({
                Bucket: cfg.bucket,
                Key: `backups/${latestDate}/flux_price_history.json`
            }));
            const priceJson = JSON.parse(await priceObj.Body.transformToString());
            priceCount = priceJson.rows?.length || 0;

            if (priceCount > 0) {
                await upsertPriceHistory(priceJson.rows);
                log.info({ count: priceCount }, 'imported price history rows');
            }
        } catch {
            priceCount = 0;
            log.info('no price history backup found (skipping)');
        }

        log.info({ dailyCount, repoCount, priceCount, date: latestDate }, 'bootstrap complete');

    } catch (error) {
        log.error({ err: error }, 'bootstrap failed');
        log.warn('starting with empty database -- data will sync from blockchain');
    }
}

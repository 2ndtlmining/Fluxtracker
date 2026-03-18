/**
 * BACKUP SERVICE — Cloudflare R2 backup/restore for critical tables
 *
 * Backs up daily_snapshots and repo_snapshots to R2.
 * These tables contain irreplaceable point-in-time observations.
 *
 * Env vars (all optional — backup is a no-op without them):
 *   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    ListObjectsV2Command,
    DeleteObjectsCommand
} from '@aws-sdk/client-s3';

import {
    exportAllDailySnapshots,
    exportAllRepoSnapshots,
    exportAllPriceHistory,
    upsertDailySnapshots,
    upsertRepoSnapshots,
    upsertPriceHistory
} from '../db/database.js';

// ============================================
// CONFIGURATION
// ============================================

const RETENTION_DAYS = 30;

function getConfig() {
    return {
        endpoint: process.env.R2_ENDPOINT,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucket: process.env.R2_BUCKET_NAME
    };
}

let s3Client = null;

function getS3Client() {
    if (s3Client) return s3Client;

    const cfg = getConfig();
    if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucket) {
        return null;
    }

    s3Client = new S3Client({
        region: 'auto',
        endpoint: cfg.endpoint,
        credentials: {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey
        }
    });

    return s3Client;
}

// ============================================
// STATE TRACKING
// ============================================

let isRunning = false;
let lastBackup = null;
let lastBackupDate = null;
let lastError = null;
let consecutiveFailures = 0;

// ============================================
// PUBLIC API
// ============================================

export function isBackupEnabled() {
    const cfg = getConfig();
    return !!(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);
}

export function getBackupStatus() {
    const enabled = isBackupEnabled();
    const ageMs = lastBackup ? Date.now() - lastBackup : null;
    const ageHours = ageMs !== null ? Math.round(ageMs / 1000 / 60 / 60 * 10) / 10 : null;

    return {
        enabled,
        lastBackup,
        lastBackupDate,
        lastError,
        consecutiveFailures,
        isHealthy: !enabled || (lastBackup !== null && ageMs < 48 * 60 * 60 * 1000),
        ageHours
    };
}

export async function performBackup() {
    // SQLite instances are consumers, not producers — only Supabase pushes backups
    if ((process.env.DB_TYPE || 'supabase').toLowerCase() === 'sqlite') {
        return { success: false, error: 'Backup disabled in SQLite mode' };
    }

    if (!isBackupEnabled()) {
        return { success: false, error: 'Backup not configured' };
    }

    if (isRunning) {
        return { success: false, error: 'Backup already in progress' };
    }

    try {
        isRunning = true;
        const client = getS3Client();
        const bucket = getConfig().bucket;
        const dateStr = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        const tableCounts = {};
        const tableErrors = [];

        // Upload each table independently — one failure doesn't block the others
        // daily_snapshots
        try {
            console.log('Backup: exporting daily_snapshots...');
            const dailyRows = await exportAllDailySnapshots();
            const dailyPayload = JSON.stringify({
                table: 'daily_snapshots',
                exportedAt: now,
                rowCount: dailyRows.length,
                rows: dailyRows
            });
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/daily_snapshots.json`,
                Body: dailyPayload,
                ContentType: 'application/json'
            }));
            tableCounts.daily_snapshots = dailyRows.length;
            console.log(`Backup: daily_snapshots uploaded (${dailyRows.length} rows)`);
        } catch (error) {
            tableErrors.push(`daily_snapshots: ${error.message}`);
            console.error('Backup: daily_snapshots failed:', error.message);
        }

        // repo_snapshots
        try {
            console.log('Backup: exporting repo_snapshots...');
            const repoRows = await exportAllRepoSnapshots();
            const repoPayload = JSON.stringify({
                table: 'repo_snapshots',
                exportedAt: now,
                rowCount: repoRows.length,
                rows: repoRows
            });
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/repo_snapshots.json`,
                Body: repoPayload,
                ContentType: 'application/json'
            }));
            tableCounts.repo_snapshots = repoRows.length;
            console.log(`Backup: repo_snapshots uploaded (${repoRows.length} rows)`);
        } catch (error) {
            tableErrors.push(`repo_snapshots: ${error.message}`);
            console.error('Backup: repo_snapshots failed:', error.message);
        }

        // flux_price_history
        try {
            console.log('Backup: exporting flux_price_history...');
            const priceRows = await exportAllPriceHistory();
            const pricePayload = JSON.stringify({
                table: 'flux_price_history',
                exportedAt: now,
                rowCount: priceRows.length,
                rows: priceRows
            });
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/flux_price_history.json`,
                Body: pricePayload,
                ContentType: 'application/json'
            }));
            tableCounts.flux_price_history = priceRows.length;
            console.log(`Backup: flux_price_history uploaded (${priceRows.length} rows)`);
        } catch (error) {
            tableErrors.push(`flux_price_history: ${error.message}`);
            console.error('Backup: flux_price_history failed:', error.message);
        }

        // Prune old backups
        const pruned = await pruneOldBackups(client, bucket);

        // At least one table must succeed for the backup to count
        const anySuccess = Object.keys(tableCounts).length > 0;
        if (anySuccess) {
            lastBackup = Date.now();
            lastBackupDate = dateStr;
            lastError = tableErrors.length > 0 ? tableErrors.join('; ') : null;
            consecutiveFailures = 0;
        } else {
            consecutiveFailures++;
            lastError = tableErrors.join('; ');
        }

        return {
            success: anySuccess,
            date: dateStr,
            tables: tableCounts,
            errors: tableErrors.length > 0 ? tableErrors : undefined,
            pruned
        };

    } catch (error) {
        consecutiveFailures++;
        lastError = error.message;
        console.error('Backup failed:', error.message);
        return { success: false, error: error.message };
    } finally {
        isRunning = false;
    }
}

export async function listBackups() {
    if (!isBackupEnabled()) {
        return { success: false, error: 'Backup not configured' };
    }

    try {
        const client = getS3Client();
        const bucket = getConfig().bucket;

        const response = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: 'backups/',
            Delimiter: '/'
        }));

        const dates = (response.CommonPrefixes || [])
            .map(p => p.Prefix.replace('backups/', '').replace('/', ''))
            .filter(d => d.length > 0)
            .sort()
            .reverse();

        return { success: true, dates };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function restoreFromBackup(date) {
    if (!isBackupEnabled()) {
        return { success: false, error: 'Backup not configured' };
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { success: false, error: 'Invalid date format (expected YYYY-MM-DD)' };
    }

    try {
        const client = getS3Client();
        const bucket = getConfig().bucket;

        // Download daily_snapshots
        console.log(`Restore: downloading daily_snapshots from ${date}...`);
        const dailyObj = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `backups/${date}/daily_snapshots.json`
        }));
        const dailyJson = JSON.parse(await dailyObj.Body.transformToString());

        // Download repo_snapshots
        console.log(`Restore: downloading repo_snapshots from ${date}...`);
        const repoObj = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `backups/${date}/repo_snapshots.json`
        }));
        const repoJson = JSON.parse(await repoObj.Body.transformToString());

        // Download flux_price_history (optional — older backups may not have it)
        let priceJson = null;
        try {
            console.log(`Restore: downloading flux_price_history from ${date}...`);
            const priceObj = await client.send(new GetObjectCommand({
                Bucket: bucket,
                Key: `backups/${date}/flux_price_history.json`
            }));
            priceJson = JSON.parse(await priceObj.Body.transformToString());
        } catch {
            console.log('Restore: no price history backup found (skipping)');
        }

        // Upsert into DB
        console.log(`Restore: upserting ${dailyJson.rowCount} daily snapshots...`);
        const dailyCount = await upsertDailySnapshots(dailyJson.rows);

        console.log(`Restore: upserting ${repoJson.rowCount} repo snapshots...`);
        const repoCount = await upsertRepoSnapshots(repoJson.rows);

        let priceCount = 0;
        if (priceJson) {
            console.log(`Restore: upserting ${priceJson.rowCount} price history rows...`);
            priceCount = await upsertPriceHistory(priceJson.rows);
        }

        return {
            success: true,
            date,
            restored: {
                daily_snapshots: dailyCount,
                repo_snapshots: repoCount,
                flux_price_history: priceCount
            }
        };

    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// INTERNAL
// ============================================

async function pruneOldBackups(client, bucket) {
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
        const cutoffStr = cutoff.toISOString().split('T')[0];

        const response = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: 'backups/',
            Delimiter: '/'
        }));

        const oldDates = (response.CommonPrefixes || [])
            .map(p => p.Prefix.replace('backups/', '').replace('/', ''))
            .filter(d => d.length > 0 && d < cutoffStr);

        if (oldDates.length === 0) return 0;

        // Delete objects in each old date folder
        let totalDeleted = 0;
        for (const date of oldDates) {
            const listResp = await client.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: `backups/${date}/`
            }));

            const objects = (listResp.Contents || []).map(obj => ({ Key: obj.Key }));
            if (objects.length === 0) continue;

            await client.send(new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: objects }
            }));

            totalDeleted += objects.length;
        }

        if (totalDeleted > 0) {
            console.log(`Backup: pruned ${oldDates.length} old backups (${totalDeleted} files)`);
        }

        return oldDates.length;

    } catch (error) {
        console.warn('Backup prune failed:', error.message);
        return 0;
    }
}

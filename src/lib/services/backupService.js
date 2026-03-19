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
import { BACKUP_CONFIG } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('backupService');

// ============================================
// CONFIGURATION
// ============================================

const RETENTION_DAYS = BACKUP_CONFIG.RETENTION_DAYS;
const UPLOAD_MAX_RETRIES = BACKUP_CONFIG.UPLOAD_MAX_RETRIES;
const UPLOAD_INITIAL_BACKOFF_MS = BACKUP_CONFIG.UPLOAD_INITIAL_BACKOFF_MS;

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

        // Upload each table independently — one failure doesn't block the others.
        // Each upload is retried up to UPLOAD_MAX_RETRIES times with exponential backoff.
        // The DB export is NOT retried (only the S3 upload).

        // daily_snapshots
        try {
            log.info('exporting daily_snapshots');
            const dailyRows = await exportAllDailySnapshots();
            const dailyPayload = JSON.stringify({
                table: 'daily_snapshots',
                exportedAt: now,
                rowCount: dailyRows.length,
                rows: dailyRows
            });
            await withRetry(() => client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/daily_snapshots.json`,
                Body: dailyPayload,
                ContentType: 'application/json'
            })), 'daily_snapshots upload');
            tableCounts.daily_snapshots = dailyRows.length;
            log.info({ rows: dailyRows.length }, 'daily_snapshots uploaded');
        } catch (error) {
            tableErrors.push(`daily_snapshots: ${error.message}`);
            log.error({ err: error }, 'daily_snapshots failed after retries');
        }

        // repo_snapshots
        try {
            log.info('exporting repo_snapshots');
            const repoRows = await exportAllRepoSnapshots();
            const repoPayload = JSON.stringify({
                table: 'repo_snapshots',
                exportedAt: now,
                rowCount: repoRows.length,
                rows: repoRows
            });
            await withRetry(() => client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/repo_snapshots.json`,
                Body: repoPayload,
                ContentType: 'application/json'
            })), 'repo_snapshots upload');
            tableCounts.repo_snapshots = repoRows.length;
            log.info({ rows: repoRows.length }, 'repo_snapshots uploaded');
        } catch (error) {
            tableErrors.push(`repo_snapshots: ${error.message}`);
            log.error({ err: error }, 'repo_snapshots failed after retries');
        }

        // flux_price_history
        try {
            log.info('exporting flux_price_history');
            const priceRows = await exportAllPriceHistory();
            const pricePayload = JSON.stringify({
                table: 'flux_price_history',
                exportedAt: now,
                rowCount: priceRows.length,
                rows: priceRows
            });
            await withRetry(() => client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: `backups/${dateStr}/flux_price_history.json`,
                Body: pricePayload,
                ContentType: 'application/json'
            })), 'flux_price_history upload');
            tableCounts.flux_price_history = priceRows.length;
            log.info({ rows: priceRows.length }, 'flux_price_history uploaded');
        } catch (error) {
            tableErrors.push(`flux_price_history: ${error.message}`);
            log.error({ err: error }, 'flux_price_history failed after retries');
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
        log.error({ err: error }, 'backup failed');
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
        log.info({ date }, 'downloading daily_snapshots');
        const dailyObj = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `backups/${date}/daily_snapshots.json`
        }));
        const dailyJson = JSON.parse(await dailyObj.Body.transformToString());

        // Download repo_snapshots
        log.info({ date }, 'downloading repo_snapshots');
        const repoObj = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `backups/${date}/repo_snapshots.json`
        }));
        const repoJson = JSON.parse(await repoObj.Body.transformToString());

        // Download flux_price_history (optional — older backups may not have it)
        let priceJson = null;
        try {
            log.info({ date }, 'downloading flux_price_history');
            const priceObj = await client.send(new GetObjectCommand({
                Bucket: bucket,
                Key: `backups/${date}/flux_price_history.json`
            }));
            priceJson = JSON.parse(await priceObj.Body.transformToString());
        } catch {
            log.info('no price history backup found (skipping)');
        }

        // Upsert into DB
        log.info({ rowCount: dailyJson.rowCount }, 'upserting daily snapshots');
        const dailyCount = await upsertDailySnapshots(dailyJson.rows);

        log.info({ rowCount: repoJson.rowCount }, 'upserting repo snapshots');
        const repoCount = await upsertRepoSnapshots(repoJson.rows);

        let priceCount = 0;
        if (priceJson) {
            log.info({ rowCount: priceJson.rowCount }, 'upserting price history rows');
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

/**
 * Retry an async function with exponential backoff.
 * Only retries on Error (transient network issues).
 */
async function withRetry(fn, label) {
    let lastError;
    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < UPLOAD_MAX_RETRIES) {
                const delayMs = UPLOAD_INITIAL_BACKOFF_MS * Math.pow(4, attempt - 1);
                log.warn({ label, attempt, maxRetries: UPLOAD_MAX_RETRIES, err: error, delayMs }, 'upload attempt failed, retrying');
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    throw lastError;
}

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
            log.info({ dates: oldDates.length, files: totalDeleted }, 'pruned old backups');
        }

        return oldDates.length;

    } catch (error) {
        log.warn({ err: error }, 'backup prune failed');
        return 0;
    }
}

/**
 * BACKUP SERVICE — Cloudflare R2 backup/restore for critical tables
 *
 * Backs up every table in backupTables.js (snapshots, per-game and decentralization history,
 * price history, node classifications) to R2. These hold point-in-time observations that
 * cannot be re-derived later.
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

import { BACKUP_TABLES, BACKUP_TABLE_NAMES } from './backupTables.js';
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
let lastBackupPartial = false; // at least one table failed in the last backup (issue #310)
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
        partial: lastBackupPartial,
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

        // Each table independently -- one failure doesn't block the others. The S3 upload is
        // retried with exponential backoff; the DB export is not.
        for (const { table, exportRows } of BACKUP_TABLES) {
            try {
                log.info({ table }, 'exporting');
                const rows = await exportRows();
                const payload = JSON.stringify({ table, exportedAt: now, rowCount: rows.length, rows });
                await withRetry(() => client.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: `backups/${dateStr}/${table}.json`,
                    Body: payload,
                    ContentType: 'application/json'
                })), `${table} upload`);
                tableCounts[table] = rows.length;
                log.info({ table, rows: rows.length }, 'uploaded');
            } catch (error) {
                tableErrors.push(`${table}: ${error.message}`);
                log.error({ err: error, table }, 'backup of table failed after retries');
            }
        }

        // Prune old backups
        const pruned = await pruneOldBackups(client, bucket);

        // At least one table must succeed for the backup to count
        const anySuccess = Object.keys(tableCounts).length > 0;
        if (anySuccess) {
            lastBackup = Date.now();
            lastBackupDate = dateStr;
            lastBackupPartial = tableErrors.length > 0;
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


/**
 * Recover the last backup's time from R2 at startup (issue #310).
 *
 * lastBackup lives in memory and a backup only runs after the next daily snapshot, so every
 * restart reported `backup.healthy: false` until the following midnight -- a false alarm on
 * each deploy. This reads the newest backup folder instead: its newest object's LastModified
 * is when it ran, and a folder missing a table is marked partial. Never throws.
 */
export async function seedBackupStatusFromStore() {
    if (!isBackupEnabled() || lastBackup !== null) return;
    try {
        const listing = await listBackups();
        const newest = listing.success ? listing.dates?.[0] : null;
        if (!newest) return;

        const client = getS3Client();
        const response = await client.send(new ListObjectsV2Command({
            Bucket: getConfig().bucket,
            Prefix: `backups/${newest}/`
        }));
        const objects = response.Contents || [];
        const times = objects.map(o => new Date(o.LastModified).getTime()).filter(Number.isFinite);
        if (times.length === 0) return;

        const present = new Set(objects.map(o => o.Key.split('/').pop().replace(/\.json$/, '')));
        lastBackup = Math.max(...times);
        lastBackupDate = newest;
        lastBackupPartial = BACKUP_TABLE_NAMES.some(t => !present.has(t));
        log.info({ date: newest, partial: lastBackupPartial }, 'backup status seeded from R2');

        // A backup folder written before a table joined the set (or one where a table failed)
        // stays incomplete until the next daily snapshot triggers a backup. Top it up now
        // rather than carry a "partial" warning -- and the gap -- until the next midnight.
        if (lastBackupPartial && (process.env.DB_TYPE || 'supabase').toLowerCase() !== 'sqlite') {
            log.info('latest backup is missing tables -- running a backup now');
            performBackup().catch(error => log.warn({ err: error }, 'top-up backup failed'));
        }
    } catch (error) {
        log.warn({ err: error }, 'could not seed backup status from R2');
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

        // Download everything first, then write: a missing REQUIRED table aborts before any
        // row is touched. Optional tables are skipped when absent -- older backups predate them.
        const downloaded = [];
        for (const entry of BACKUP_TABLES) {
            try {
                log.info({ date, table: entry.table }, 'downloading');
                const obj = await client.send(new GetObjectCommand({
                    Bucket: bucket,
                    Key: `backups/${date}/${entry.table}.json`
                }));
                downloaded.push({ entry, json: JSON.parse(await obj.Body.transformToString()) });
            } catch (error) {
                if (entry.required) throw new Error(`${entry.table}: ${error.message}`);
                log.info({ table: entry.table }, 'not in this backup (skipping)');
            }
        }

        const restored = {};
        for (const { entry, json } of downloaded) {
            log.info({ table: entry.table, rowCount: json.rowCount }, 'upserting');
            restored[entry.table] = await entry.importRows(json.rows || []);
        }

        return { success: true, date, restored };

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

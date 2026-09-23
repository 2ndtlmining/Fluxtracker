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

import { BACKUP_TABLES } from './backupTables.js';
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

/**
 * Which backup tables are empty in the local SQLite file -- those are the ones to import.
 * A table that does not exist yet counts as empty.
 *
 * Checked per table (issue #311). The old check looked at daily_snapshots alone, so a first
 * boot whose repo or price import failed never retried it: daily_snapshots had rows, and every
 * later boot read that as a warm restart.
 */
export async function findEmptyTables(dbPath, tables = BACKUP_TABLES.map(t => t.table)) {
    const { default: Database } = await import('better-sqlite3');
    let db = null;
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
        return [...tables]; // no database file yet -- everything is empty
    }
    try {
        return tables.filter(table => {
            try {
                return db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get() === undefined;
            } catch {
                return true; // table missing
            }
        });
    } finally {
        db.close();
    }
}

/**
 * The backup folder to restore from: the newest COMPLETE one (every table present), falling
 * back to the newest that at least has the required tables. The newest folder alone could be
 * a partial backup from a run where a table failed (issue #311).
 *
 * @param {string[]} datesNewestFirst
 * @param {(date: string) => Promise<Set<string>>} tablesIn
 */
export async function pickBackupDate(datesNewestFirst, tablesIn, maxToCheck = 7) {
    const all = BACKUP_TABLES.map(t => t.table);
    const required = BACKUP_TABLES.filter(t => t.required).map(t => t.table);
    let fallback = null;
    for (const date of datesNewestFirst.slice(0, maxToCheck)) {
        const present = await tablesIn(date);
        if (all.every(t => present.has(t))) return { date, complete: true };
        if (!fallback && required.every(t => present.has(t))) fallback = date;
    }
    return fallback ? { date: fallback, complete: false } : null;
}

export async function runBootstrap() {
    const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();
    if (dbType !== 'sqlite') {
        log.info('skipped (not SQLite mode)');
        return;
    }

    const DB_PATH = process.env.DB_PATH || 'data/fluxtracker.sqlite3';
    let needed;
    try {
        needed = await findEmptyTables(DB_PATH);
    } catch (error) {
        log.info({ err: error }, 'cannot check DB state, proceeding with every table');
        needed = BACKUP_TABLES.map(t => t.table);
    }

    if (needed.length === 0) {
        log.info('skipped (every backed-up table already has data -- warm restart)');
        return;
    }

    // Check for bootstrap credentials
    if (!isBootstrapConfigured()) {
        log.warn({ emptyTables: needed }, 'BOOTSTRAP_R2_* env vars not set -- empty tables stay empty');
        return;
    }

    log.info({ tables: needed }, 'downloading latest backup from R2');

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

        const listResp = await client.send(new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: 'backups/',
            Delimiter: '/'
        }));

        const dates = (listResp.CommonPrefixes || [])
            .map(p => p.Prefix.replace('backups/', '').replace('/', ''))
            .filter(d => d.length > 0)
            .sort()
            .reverse();

        const tablesIn = async (date) => {
            const resp = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: `backups/${date}/` }));
            return new Set((resp.Contents || []).map(o => o.Key.split('/').pop().replace(/\.json$/, '')));
        };

        const choice = await pickBackupDate(dates, tablesIn);
        if (!choice) {
            log.warn('no usable backup found in R2 -- starting with empty tables');
            return;
        }
        log.info({ date: choice.date, complete: choice.complete }, 'using backup');

        // Each table independently: one failed import doesn't block the others, and a table
        // left empty is retried on the next boot (the per-table check above).
        const counts = {};
        for (const entry of BACKUP_TABLES) {
            if (!needed.includes(entry.table)) continue;
            try {
                const obj = await client.send(new GetObjectCommand({
                    Bucket: cfg.bucket,
                    Key: `backups/${choice.date}/${entry.table}.json`
                }));
                const json = JSON.parse(await obj.Body.transformToString());
                const rows = json.rows || [];
                if (rows.length > 0) await entry.importRows(rows);
                counts[entry.table] = rows.length;
                log.info({ table: entry.table, count: rows.length }, 'imported');
            } catch (error) {
                counts[entry.table] = 0;
                log.warn({ err: error, table: entry.table }, 'import failed or table not in this backup');
            }
        }

        log.info({ counts, date: choice.date }, 'bootstrap complete');

    } catch (error) {
        log.error({ err: error }, 'bootstrap failed');
        log.warn('starting with empty tables -- data will sync from the network');
    }
}

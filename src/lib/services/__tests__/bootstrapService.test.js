import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * bootstrapService: fills an empty SQLite database from the newest usable R2 backup.
 *
 * Since issue #311 the table list comes from backupTables.js (the same list backup and
 * restore use), emptiness is checked PER TABLE, and the backup chosen is the newest
 * COMPLETE one rather than simply the newest.
 */

// ---- A fake R2 bucket: { 'YYYY-MM-DD': { table: rows } } ----
let bucket = {};
let failKeys = new Set(); // object keys whose GetObject rejects

const mockSend = vi.fn(async (cmd) => {
    if (cmd._type === 'ListObjects') {
        if (cmd.Delimiter === '/') {
            return { CommonPrefixes: Object.keys(bucket).map(d => ({ Prefix: `backups/${d}/` })) };
        }
        const date = cmd.Prefix.split('/')[1];
        return { Contents: Object.keys(bucket[date] || {}).map(t => ({ Key: `backups/${date}/${t}.json` })) };
    }
    if (cmd._type === 'GetObject') {
        if (failKeys.has(cmd.Key)) throw new Error('Access Denied');
        const [, date, file] = cmd.Key.split('/');
        const rows = bucket[date]?.[file.replace('.json', '')];
        if (!rows) throw new Error('NoSuchKey');
        return { Body: { transformToString: async () => JSON.stringify({ rows, rowCount: rows.length }) } };
    }
    throw new Error(`unexpected command ${cmd._type}`);
});

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(function() { return { send: mockSend }; }),
    GetObjectCommand: vi.fn().mockImplementation(function(params) { return { _type: 'GetObject', ...params }; }),
    ListObjectsV2Command: vi.fn().mockImplementation(function(params) { return { _type: 'ListObjects', ...params }; })
}));

// ---- Every writer backupTables.js can call ----
const writers = {
    upsertDailySnapshots: vi.fn(),
    upsertRepoSnapshots: vi.fn(),
    upsertGameSnapshots: vi.fn(),
    upsertPriceHistory: vi.fn(),
    upsertNodeIpClassifications: vi.fn(),
    createDecentralizationDimensionSnapshots: vi.fn()
};
vi.mock('../../db/database.js', () => ({
    ...writers,
    exportAllDailySnapshots: vi.fn(),
    exportAllRepoSnapshots: vi.fn(),
    exportAllGameSnapshots: vi.fn(),
    exportAllPriceHistory: vi.fn(),
    getAllNodeIpClassifications: vi.fn(),
    getDecentralizationDimensionSnapshotHistory: vi.fn()
}));

// ---- better-sqlite3: `emptyTables` says which tables have no rows; null = no DB file ----
let emptyTables = null;
vi.mock('better-sqlite3', () => ({
    default: vi.fn().mockImplementation(function() {
        if (emptyTables === null) throw new Error('no such file');
        return {
            prepare: (sql) => ({ get: () => (emptyTables.some(t => sql.includes(` ${t} `)) ? undefined : { 1: 1 }) }),
            close: () => {}
        };
    })
}));

const mockLogWarn = vi.fn();
vi.mock('../../logger.js', () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: mockLogWarn, error: vi.fn(), debug: vi.fn() }))
}));

const { BACKUP_TABLES } = await import('../backupTables.js');
const ALL = BACKUP_TABLES.map(t => t.table);

async function importFresh() {
    vi.resetModules();
    const s3 = await import('@aws-sdk/client-s3');
    s3.S3Client.mockImplementation(function() { return { send: mockSend }; });
    return await import('../bootstrapService.js');
}

function setR2Env() {
    vi.stubEnv('BOOTSTRAP_R2_ENDPOINT', 'https://r2.example.com');
    vi.stubEnv('BOOTSTRAP_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('BOOTSTRAP_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('BOOTSTRAP_R2_BUCKET_NAME', 'test-bucket');
}

/** A backup folder holding `tables` (default: every table), one row each. */
const folder = (tables = ALL) => Object.fromEntries(tables.map(t => [t, [{ from: t }]]));

beforeEach(() => {
    vi.unstubAllEnvs();
    bucket = {};
    failKeys = new Set();
    emptyTables = null;
    mockSend.mockClear();
    mockLogWarn.mockClear();
    for (const w of Object.values(writers)) w.mockReset().mockResolvedValue(1);
});

describe('runBootstrap', () => {
    it('does nothing outside SQLite mode', async () => {
        vi.stubEnv('DB_TYPE', 'supabase');
        const { runBootstrap } = await importFresh();
        await runBootstrap();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('does nothing when every table already has data (warm restart)', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        emptyTables = [];
        const { runBootstrap } = await importFresh();
        await runBootstrap();
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('warns and stops without credentials', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        const { runBootstrap } = await importFresh();
        await runBootstrap();
        expect(mockLogWarn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('BOOTSTRAP_R2_* env vars not set'));
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('a fresh database imports every table, decentralization history included (issue #311)', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        bucket = { '2026-09-22': folder() };
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        expect(writers.upsertDailySnapshots).toHaveBeenCalledWith([{ from: 'daily_snapshots' }]);
        expect(writers.upsertGameSnapshots).toHaveBeenCalledWith([{ from: 'game_snapshots' }]);
        expect(writers.upsertNodeIpClassifications).toHaveBeenCalled();
        expect(writers.createDecentralizationDimensionSnapshots).toHaveBeenCalledTimes(3); // one per dimension
    });

    it('only imports the tables that are empty -- a failed table is retried on the next boot', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        emptyTables = ['repo_snapshots'];
        bucket = { '2026-09-22': folder() };
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        expect(writers.upsertRepoSnapshots).toHaveBeenCalledTimes(1);
        expect(writers.upsertDailySnapshots).not.toHaveBeenCalled();
    });

    it('prefers the newest COMPLETE backup over a newer partial one', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        bucket = {
            '2026-09-20': folder(),
            '2026-09-22': folder(['daily_snapshots', 'repo_snapshots'])
        };
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        const gets = mockSend.mock.calls.map(([c]) => c).filter(c => c._type === 'GetObject');
        expect(gets.length).toBeGreaterThan(0);
        expect(gets.every(c => c.Key.includes('2026-09-20'))).toBe(true);
    });

    it('falls back to the newest backup with the required tables when none is complete', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        bucket = {
            '2026-09-21': folder(['daily_snapshots']),
            '2026-09-22': folder(['daily_snapshots', 'repo_snapshots', 'flux_price_history'])
        };
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        expect(writers.upsertPriceHistory).toHaveBeenCalledWith([{ from: 'flux_price_history' }]);
        expect(writers.upsertGameSnapshots).not.toHaveBeenCalled();
    });

    it('one failed download does not block the other tables', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        bucket = { '2026-09-22': folder() };
        failKeys.add('backups/2026-09-22/repo_snapshots.json');
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        expect(writers.upsertRepoSnapshots).not.toHaveBeenCalled();
        expect(writers.upsertDailySnapshots).toHaveBeenCalled();
        expect(writers.upsertPriceHistory).toHaveBeenCalled();
    });

    it('stops cleanly when R2 has no backups', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        const { runBootstrap } = await importFresh();
        await runBootstrap();

        expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining('no usable backup'));
        expect(writers.upsertDailySnapshots).not.toHaveBeenCalled();
    });
});

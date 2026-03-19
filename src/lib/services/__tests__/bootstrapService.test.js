import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Shared mock references ----
const mockSend = vi.fn();
const mockPrepare = vi.fn();
const mockClose = vi.fn();
const mockGet = vi.fn();

// ---- Mock @aws-sdk/client-s3 ----
vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(function() { return { send: mockSend }; }),
    GetObjectCommand: vi.fn().mockImplementation(function(params) { return { _type: 'GetObject', ...params }; }),
    ListObjectsV2Command: vi.fn().mockImplementation(function(params) { return { _type: 'ListObjects', ...params }; })
}));

// ---- Mock database upsert functions ----
const mockUpsertDailySnapshots = vi.fn().mockResolvedValue();
const mockUpsertRepoSnapshots = vi.fn().mockResolvedValue();
const mockUpsertPriceHistory = vi.fn().mockResolvedValue();

// Path relative to test file: __tests__/ -> services/ -> lib/ -> db/database.js
vi.mock('../../db/database.js', () => ({
    upsertDailySnapshots: mockUpsertDailySnapshots,
    upsertRepoSnapshots: mockUpsertRepoSnapshots,
    upsertPriceHistory: mockUpsertPriceHistory
}));

// ---- Mock better-sqlite3 (dynamically imported inside runBootstrap) ----
const MockDatabase = vi.fn().mockImplementation(function() {
    return { prepare: mockPrepare, close: mockClose };
});

vi.mock('better-sqlite3', () => ({
    default: MockDatabase
}));

// ---- Mock logger (bootstrapService now uses pino instead of console) ----
const mockLogWarn = vi.fn();
vi.mock('../../logger.js', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: mockLogWarn,
        error: vi.fn(),
        debug: vi.fn(),
    }))
}));

// ---- Helpers ----

/** Import runBootstrap fresh (picks up current env vars via resetModules) */
async function importFresh() {
    vi.resetModules();
    // Re-wire S3Client mock implementation after resetModules
    // (resetModules can cause the factory to re-evaluate with stale vi.fn state)
    const s3Mod = await import('@aws-sdk/client-s3');
    s3Mod.S3Client.mockImplementation(function() { return { send: mockSend }; });

    const mod = await import('../bootstrapService.js');
    return mod.runBootstrap;
}

/** Build a mock S3 Body with transformToString */
function makeS3Body(data) {
    return {
        Body: { transformToString: () => JSON.stringify(data) }
    };
}

function setR2Env() {
    vi.stubEnv('BOOTSTRAP_R2_ENDPOINT', 'https://r2.example.com');
    vi.stubEnv('BOOTSTRAP_R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('BOOTSTRAP_R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('BOOTSTRAP_R2_BUCKET_NAME', 'test-bucket');
}

function clearR2Env() {
    vi.stubEnv('BOOTSTRAP_R2_ENDPOINT', '');
    vi.stubEnv('BOOTSTRAP_R2_ACCESS_KEY_ID', '');
    vi.stubEnv('BOOTSTRAP_R2_SECRET_ACCESS_KEY', '');
    vi.stubEnv('BOOTSTRAP_R2_BUCKET_NAME', '');
}

// ---- Tests ----

describe('bootstrapService — runBootstrap()', () => {
    beforeEach(() => {
        // Use mockClear (not resetAllMocks) to preserve implementations
        mockLogWarn.mockClear();
        mockSend.mockClear();
        mockPrepare.mockClear();
        mockClose.mockClear();
        mockGet.mockClear();
        mockUpsertDailySnapshots.mockClear().mockResolvedValue();
        mockUpsertRepoSnapshots.mockClear().mockResolvedValue();
        mockUpsertPriceHistory.mockClear().mockResolvedValue();

        // Re-wire default implementations
        MockDatabase.mockClear().mockImplementation(function() {
            return { prepare: mockPrepare, close: mockClose };
        });
        mockPrepare.mockReturnValue({ get: mockGet });
        mockGet.mockReturnValue({ cnt: 0 });

        vi.unstubAllEnvs();
    });

    // -------------------------------------------------------
    // 1. Not SQLite mode — returns early
    // -------------------------------------------------------
    it('returns early when DB_TYPE is not sqlite', async () => {
        vi.stubEnv('DB_TYPE', 'supabase');
        const runBootstrap = await importFresh();

        await runBootstrap();

        expect(mockSend).not.toHaveBeenCalled();
        expect(mockUpsertDailySnapshots).not.toHaveBeenCalled();
    });

    it('returns early when DB_TYPE is unset (defaults to supabase)', async () => {
        // DB_TYPE not stubbed — defaults to 'supabase'
        const runBootstrap = await importFresh();

        await runBootstrap();

        expect(mockSend).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // 2. Warm restart — DB already has data
    // -------------------------------------------------------
    it('returns early on warm restart when DB has existing snapshots', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        mockGet.mockReturnValue({ cnt: 100 });

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(MockDatabase).toHaveBeenCalled();
        expect(mockSend).not.toHaveBeenCalled();
        expect(mockUpsertDailySnapshots).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // 3. No credentials — fresh DB but R2 vars missing
    // -------------------------------------------------------
    it('logs warning and returns when R2 credentials are not set', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        clearR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(mockLogWarn).toHaveBeenCalledWith(
            expect.stringContaining('BOOTSTRAP_R2_* env vars not set')
        );
        expect(mockSend).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // 4. Fresh DB — full success path
    // -------------------------------------------------------
    it('downloads from R2 and calls all 3 upsert functions on success', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        const listResponse = {
            CommonPrefixes: [{ Prefix: 'backups/2026-03-18/' }]
        };
        const dailyResponse = makeS3Body({ rows: [{ id: 1, date: '2026-03-18' }], rowCount: 1 });
        const repoResponse = makeS3Body({ rows: [{ repo: 'test-app' }], rowCount: 1 });
        const priceResponse = makeS3Body({ rows: [{ date: '2026-03-18', price: 0.5 }], rowCount: 1 });

        mockSend
            .mockResolvedValueOnce(listResponse)
            .mockResolvedValueOnce(dailyResponse)
            .mockResolvedValueOnce(repoResponse)
            .mockResolvedValueOnce(priceResponse);

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(mockSend).toHaveBeenCalledTimes(4);
        expect(mockUpsertDailySnapshots).toHaveBeenCalledWith([{ id: 1, date: '2026-03-18' }]);
        expect(mockUpsertRepoSnapshots).toHaveBeenCalledWith([{ repo: 'test-app' }]);
        expect(mockUpsertPriceHistory).toHaveBeenCalledWith([{ date: '2026-03-18', price: 0.5 }]);
    });

    it('handles multiple backup dates and picks the latest', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        const listResponse = {
            CommonPrefixes: [
                { Prefix: 'backups/2026-03-15/' },
                { Prefix: 'backups/2026-03-18/' },
                { Prefix: 'backups/2026-03-16/' }
            ]
        };
        const dailyResponse = makeS3Body({ rows: [{ id: 1 }], rowCount: 1 });
        const repoResponse = makeS3Body({ rows: [{ repo: 'app' }], rowCount: 1 });
        const priceResponse = makeS3Body({ rows: [], rowCount: 0 });

        mockSend
            .mockResolvedValueOnce(listResponse)
            .mockResolvedValueOnce(dailyResponse)
            .mockResolvedValueOnce(repoResponse)
            .mockResolvedValueOnce(priceResponse);

        const runBootstrap = await importFresh();
        await runBootstrap();

        // Verify the latest date was used
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const getCalls = GetObjectCommand.mock.calls;
        for (const call of getCalls) {
            expect(call[0].Key).toContain('2026-03-18');
        }
    });

    it('returns early when R2 has no backups', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        mockSend.mockResolvedValueOnce({ CommonPrefixes: [] });

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(mockLogWarn).toHaveBeenCalledWith(
            expect.stringContaining('no backups found in R2')
        );
        expect(mockUpsertDailySnapshots).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------
    // 5. Partial download failure — successful tables still imported
    // -------------------------------------------------------
    it('imports successful tables even when one download fails', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        const listResponse = {
            CommonPrefixes: [{ Prefix: 'backups/2026-03-18/' }]
        };
        const dailyResponse = makeS3Body({ rows: [{ id: 1 }], rowCount: 1 });
        const priceResponse = makeS3Body({ rows: [{ date: '2026-03-18', price: 0.5 }], rowCount: 1 });

        mockSend
            .mockResolvedValueOnce(listResponse)
            .mockResolvedValueOnce(dailyResponse)
            .mockRejectedValueOnce(new Error('Access Denied'))
            .mockResolvedValueOnce(priceResponse);

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(mockUpsertDailySnapshots).toHaveBeenCalledWith([{ id: 1 }]);
        expect(mockUpsertRepoSnapshots).not.toHaveBeenCalled();
        expect(mockUpsertPriceHistory).toHaveBeenCalledWith([{ date: '2026-03-18', price: 0.5 }]);
    });

    it('imports daily and repo even when price download fails', async () => {
        vi.stubEnv('DB_TYPE', 'sqlite');
        setR2Env();
        MockDatabase.mockImplementation(function() { throw new Error('no such file'); });

        const listResponse = {
            CommonPrefixes: [{ Prefix: 'backups/2026-03-18/' }]
        };
        const dailyResponse = makeS3Body({ rows: [{ id: 1 }], rowCount: 1 });
        const repoResponse = makeS3Body({ rows: [{ repo: 'test' }], rowCount: 1 });

        mockSend
            .mockResolvedValueOnce(listResponse)
            .mockResolvedValueOnce(dailyResponse)
            .mockResolvedValueOnce(repoResponse)
            .mockRejectedValueOnce(new Error('Not Found'));

        const runBootstrap = await importFresh();
        await runBootstrap();

        expect(mockUpsertDailySnapshots).toHaveBeenCalledWith([{ id: 1 }]);
        expect(mockUpsertRepoSnapshots).toHaveBeenCalledWith([{ repo: 'test' }]);
        expect(mockUpsertPriceHistory).not.toHaveBeenCalled();
    });
});

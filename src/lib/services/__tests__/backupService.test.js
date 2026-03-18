import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the backup service (Cloudflare R2 backup/restore).
 *
 * All external dependencies (S3 client, database exports/upserts) are mocked
 * so these tests run in isolation without network or DB access.
 */

// ---- Mock setup (must be before importing the service) ----

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(function() { return { send: mockSend }; }),
    PutObjectCommand: vi.fn().mockImplementation(function(params) { return { _type: 'PutObjectCommand', ...params }; }),
    GetObjectCommand: vi.fn().mockImplementation(function(params) { return { _type: 'GetObjectCommand', ...params }; }),
    ListObjectsV2Command: vi.fn().mockImplementation(function(params) { return { _type: 'ListObjectsV2Command', ...params }; }),
    DeleteObjectsCommand: vi.fn().mockImplementation(function(params) { return { _type: 'DeleteObjectsCommand', ...params }; }),
}));

vi.mock('../../db/database.js', () => ({
    exportAllDailySnapshots: vi.fn(),
    exportAllRepoSnapshots: vi.fn(),
    exportAllPriceHistory: vi.fn(),
    upsertDailySnapshots: vi.fn(),
    upsertRepoSnapshots: vi.fn(),
    upsertPriceHistory: vi.fn(),
}));

// ---- Imports (after mocks are declared) ----

import {
    exportAllDailySnapshots,
    exportAllRepoSnapshots,
    exportAllPriceHistory,
    upsertDailySnapshots,
    upsertRepoSnapshots,
    upsertPriceHistory,
} from '../../db/database.js';

// We need to re-import the service fresh for each test group because the module
// caches the S3 client. Use resetModules + dynamic import.

// ---- Helpers ----

function setR2Env() {
    vi.stubEnv('R2_ENDPOINT', 'https://r2.example.com');
    vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key-id');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('R2_BUCKET_NAME', 'test-bucket');
}

function clearR2Env() {
    vi.stubEnv('R2_ENDPOINT', '');
    vi.stubEnv('R2_ACCESS_KEY_ID', '');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
    vi.stubEnv('R2_BUCKET_NAME', '');
}

function makeS3Body(data) {
    return {
        Body: {
            transformToString: vi.fn().mockResolvedValue(JSON.stringify(data)),
        },
    };
}

// ---- Tests ----

describe('Backup Service', () => {
    beforeEach(async () => {
        vi.resetModules();
        vi.unstubAllEnvs();
        mockSend.mockReset();
        vi.mocked(exportAllDailySnapshots).mockReset();
        vi.mocked(exportAllRepoSnapshots).mockReset();
        vi.mocked(exportAllPriceHistory).mockReset();
        vi.mocked(upsertDailySnapshots).mockReset();
        vi.mocked(upsertRepoSnapshots).mockReset();
        vi.mocked(upsertPriceHistory).mockReset();
    });

    // ========================================
    // isBackupEnabled
    // ========================================

    describe('isBackupEnabled', () => {
        it('returns false when R2 env vars are missing', async () => {
            clearR2Env();
            const { isBackupEnabled } = await import('../backupService.js');
            expect(isBackupEnabled()).toBe(false);
        });

        it('returns false when only some R2 env vars are set', async () => {
            vi.stubEnv('R2_ENDPOINT', 'https://r2.example.com');
            vi.stubEnv('R2_ACCESS_KEY_ID', 'key');
            // R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME are missing
            const { isBackupEnabled } = await import('../backupService.js');
            expect(isBackupEnabled()).toBe(false);
        });

        it('returns true when all 4 R2 env vars are set', async () => {
            setR2Env();
            const { isBackupEnabled } = await import('../backupService.js');
            expect(isBackupEnabled()).toBe(true);
        });
    });

    // ========================================
    // performBackup
    // ========================================

    describe('performBackup', () => {
        it('returns error in SQLite mode', async () => {
            setR2Env();
            vi.stubEnv('DB_TYPE', 'sqlite');
            const { performBackup } = await import('../backupService.js');

            const result = await performBackup();
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/SQLite/i);
        });

        it('returns error when R2 is not configured', async () => {
            clearR2Env();
            const { performBackup } = await import('../backupService.js');

            const result = await performBackup();
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/not configured/i);
        });

        it('exports all 3 tables and calls PutObjectCommand 3 times on success', async () => {
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            vi.mocked(exportAllDailySnapshots).mockResolvedValue([
                { date: '2026-03-01', total_nodes: 100 },
                { date: '2026-03-02', total_nodes: 101 },
            ]);
            vi.mocked(exportAllRepoSnapshots).mockResolvedValue([
                { date: '2026-03-01', repo: 'app1', nodes: 10 },
            ]);
            vi.mocked(exportAllPriceHistory).mockResolvedValue([
                { date: '2026-03-01', price_usd: 0.55 },
            ]);

            // mockSend for PutObjectCommand uploads + ListObjectsV2Command for pruning
            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const result = await performBackup();

            expect(result.success).toBe(true);
            expect(result.tables.daily_snapshots).toBe(2);
            expect(result.tables.repo_snapshots).toBe(1);
            expect(result.tables.flux_price_history).toBe(1);
            expect(result.errors).toBeUndefined();

            // 3 PutObjectCommand calls + at least 1 ListObjectsV2Command for pruning
            const putCalls = mockSend.mock.calls.filter(
                ([cmd]) => cmd._type === 'PutObjectCommand'
            );
            expect(putCalls.length).toBe(3);
        });

        it('handles partial failure — one table throws, others succeed', async () => {
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            vi.mocked(exportAllDailySnapshots).mockResolvedValue([
                { date: '2026-03-01', total_nodes: 100 },
            ]);
            vi.mocked(exportAllRepoSnapshots).mockRejectedValue(
                new Error('repo export failed')
            );
            vi.mocked(exportAllPriceHistory).mockResolvedValue([
                { date: '2026-03-01', price_usd: 0.55 },
            ]);

            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const result = await performBackup();

            expect(result.success).toBe(true);
            expect(result.tables.daily_snapshots).toBe(1);
            expect(result.tables.repo_snapshots).toBeUndefined();
            expect(result.tables.flux_price_history).toBe(1);
            expect(result.errors).toBeDefined();
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toMatch(/repo_snapshots/);
        });
    });

    // ========================================
    // retry logic
    // ========================================

    describe('retry logic', () => {
        it('retries a failed upload and succeeds on second attempt', async () => {
            vi.useFakeTimers();
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            vi.mocked(exportAllDailySnapshots).mockResolvedValue([{ date: '2026-03-01' }]);
            vi.mocked(exportAllRepoSnapshots).mockResolvedValue([{ repo: 'app1' }]);
            vi.mocked(exportAllPriceHistory).mockResolvedValue([{ date: '2026-03-01', price: 0.5 }]);

            let dailyUploadAttempts = 0;
            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                if (cmd._type === 'PutObjectCommand' && cmd.Key?.includes('daily_snapshots')) {
                    dailyUploadAttempts++;
                    if (dailyUploadAttempts === 1) {
                        return Promise.reject(new Error('network timeout'));
                    }
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const backupPromise = performBackup();

            // Advance past the 1s backoff for first retry
            await vi.advanceTimersByTimeAsync(1500);

            const result = await backupPromise;

            expect(result.success).toBe(true);
            expect(result.tables.daily_snapshots).toBe(1);
            expect(dailyUploadAttempts).toBe(2);
            expect(result.errors).toBeUndefined();

            vi.useRealTimers();
        });

        it('fails after exhausting all 3 retry attempts', async () => {
            vi.useFakeTimers();
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            vi.mocked(exportAllDailySnapshots).mockResolvedValue([{ date: '2026-03-01' }]);
            vi.mocked(exportAllRepoSnapshots).mockResolvedValue([{ repo: 'app1' }]);
            vi.mocked(exportAllPriceHistory).mockResolvedValue([{ date: '2026-03-01', price: 0.5 }]);

            let dailyAttempts = 0;
            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                if (cmd._type === 'PutObjectCommand' && cmd.Key?.includes('daily_snapshots')) {
                    dailyAttempts++;
                    return Promise.reject(new Error('persistent R2 error'));
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const backupPromise = performBackup();

            // Advance through all backoff delays: 1s + 4s
            await vi.advanceTimersByTimeAsync(1500);
            await vi.advanceTimersByTimeAsync(4500);

            const result = await backupPromise;

            // daily_snapshots failed after 3 attempts, but repo + price succeeded
            expect(dailyAttempts).toBe(3);
            expect(result.success).toBe(true); // other tables succeeded
            expect(result.tables.daily_snapshots).toBeUndefined();
            expect(result.tables.repo_snapshots).toBe(1);
            expect(result.tables.flux_price_history).toBe(1);
            expect(result.errors).toBeDefined();
            expect(result.errors[0]).toMatch(/daily_snapshots.*persistent R2 error/);

            vi.useRealTimers();
        });

        it('does not retry DB export failures (only S3 uploads)', async () => {
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            // DB export fails — this should NOT be retried
            vi.mocked(exportAllDailySnapshots).mockRejectedValue(new Error('DB read error'));
            vi.mocked(exportAllRepoSnapshots).mockResolvedValue([{ repo: 'app1' }]);
            vi.mocked(exportAllPriceHistory).mockResolvedValue([{ date: '2026-03-01', price: 0.5 }]);

            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const result = await performBackup();

            // DB export fails immediately, no retry
            expect(exportAllDailySnapshots).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true); // other tables succeeded
            expect(result.errors[0]).toMatch(/daily_snapshots.*DB read error/);
        });

        it('retries with exponential backoff timing', async () => {
            vi.useFakeTimers();
            setR2Env();
            vi.stubEnv('DB_TYPE', 'supabase');

            vi.mocked(exportAllDailySnapshots).mockResolvedValue([{ d: 1 }]);
            vi.mocked(exportAllRepoSnapshots).mockResolvedValue([]);
            vi.mocked(exportAllPriceHistory).mockResolvedValue([]);

            const uploadTimestamps = [];
            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'ListObjectsV2Command') {
                    return Promise.resolve({ CommonPrefixes: [] });
                }
                if (cmd._type === 'PutObjectCommand' && cmd.Key?.includes('daily_snapshots')) {
                    uploadTimestamps.push(Date.now());
                    if (uploadTimestamps.length < 3) {
                        return Promise.reject(new Error('timeout'));
                    }
                }
                return Promise.resolve({});
            });

            const { performBackup } = await import('../backupService.js');
            const backupPromise = performBackup();

            // First retry after 1s backoff
            await vi.advanceTimersByTimeAsync(1500);
            // Second retry after 4s backoff (1000 * 4^1)
            await vi.advanceTimersByTimeAsync(4500);

            await backupPromise;

            expect(uploadTimestamps.length).toBe(3);
            // Verify backoff: gap between 1st and 2nd should be ~1000ms
            const gap1 = uploadTimestamps[1] - uploadTimestamps[0];
            expect(gap1).toBeGreaterThanOrEqual(1000);
            // Gap between 2nd and 3rd should be ~4000ms
            const gap2 = uploadTimestamps[2] - uploadTimestamps[1];
            expect(gap2).toBeGreaterThanOrEqual(4000);

            vi.useRealTimers();
        });
    });

    // ========================================
    // restoreFromBackup
    // ========================================

    describe('restoreFromBackup', () => {
        it('downloads 3 files and calls upsert functions on success', async () => {
            setR2Env();

            const dailyData = {
                table: 'daily_snapshots',
                rowCount: 2,
                rows: [{ date: '2026-03-01' }, { date: '2026-03-02' }],
            };
            const repoData = {
                table: 'repo_snapshots',
                rowCount: 1,
                rows: [{ date: '2026-03-01', repo: 'app1' }],
            };
            const priceData = {
                table: 'flux_price_history',
                rowCount: 1,
                rows: [{ date: '2026-03-01', price_usd: 0.55 }],
            };

            // GetObjectCommand calls return the right data based on Key
            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'GetObjectCommand') {
                    if (cmd.Key.includes('daily_snapshots')) {
                        return Promise.resolve(makeS3Body(dailyData));
                    }
                    if (cmd.Key.includes('repo_snapshots')) {
                        return Promise.resolve(makeS3Body(repoData));
                    }
                    if (cmd.Key.includes('flux_price_history')) {
                        return Promise.resolve(makeS3Body(priceData));
                    }
                }
                return Promise.resolve({});
            });

            vi.mocked(upsertDailySnapshots).mockResolvedValue(2);
            vi.mocked(upsertRepoSnapshots).mockResolvedValue(1);
            vi.mocked(upsertPriceHistory).mockResolvedValue(1);

            const { restoreFromBackup } = await import('../backupService.js');
            const result = await restoreFromBackup('2026-03-01');

            expect(result.success).toBe(true);
            expect(result.date).toBe('2026-03-01');
            expect(result.restored.daily_snapshots).toBe(2);
            expect(result.restored.repo_snapshots).toBe(1);
            expect(result.restored.flux_price_history).toBe(1);

            expect(upsertDailySnapshots).toHaveBeenCalledWith(dailyData.rows);
            expect(upsertRepoSnapshots).toHaveBeenCalledWith(repoData.rows);
            expect(upsertPriceHistory).toHaveBeenCalledWith(priceData.rows);
        });

        it('gracefully skips missing price_history backup', async () => {
            setR2Env();

            const dailyData = {
                table: 'daily_snapshots',
                rowCount: 1,
                rows: [{ date: '2026-03-01' }],
            };
            const repoData = {
                table: 'repo_snapshots',
                rowCount: 1,
                rows: [{ date: '2026-03-01', repo: 'app1' }],
            };

            mockSend.mockImplementation((cmd) => {
                if (cmd._type === 'GetObjectCommand') {
                    if (cmd.Key.includes('daily_snapshots')) {
                        return Promise.resolve(makeS3Body(dailyData));
                    }
                    if (cmd.Key.includes('repo_snapshots')) {
                        return Promise.resolve(makeS3Body(repoData));
                    }
                    if (cmd.Key.includes('flux_price_history')) {
                        return Promise.reject(new Error('NoSuchKey'));
                    }
                }
                return Promise.resolve({});
            });

            vi.mocked(upsertDailySnapshots).mockResolvedValue(1);
            vi.mocked(upsertRepoSnapshots).mockResolvedValue(1);

            const { restoreFromBackup } = await import('../backupService.js');
            const result = await restoreFromBackup('2026-03-01');

            expect(result.success).toBe(true);
            expect(result.restored.daily_snapshots).toBe(1);
            expect(result.restored.repo_snapshots).toBe(1);
            expect(result.restored.flux_price_history).toBe(0);
            expect(upsertPriceHistory).not.toHaveBeenCalled();
        });

        it('returns error for invalid date format', async () => {
            setR2Env();
            const { restoreFromBackup } = await import('../backupService.js');

            const result = await restoreFromBackup('not-a-date');
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/Invalid date/i);
        });

        it('returns error when R2 is not configured', async () => {
            clearR2Env();
            const { restoreFromBackup } = await import('../backupService.js');

            const result = await restoreFromBackup('2026-03-01');
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/not configured/i);
        });
    });
});

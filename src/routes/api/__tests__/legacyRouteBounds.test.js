import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest';
import express from 'express';

/**
 * The older, uncached routes (follow-up to the #543 review): a client-chosen `limit` is
 * capped at the retention window, a malformed date never reaches the database, and the
 * summary's four reads run together.
 */

const db = vi.hoisted(() => ({
    getRepoHistory: vi.fn(async () => []),
    getCategoryHistory: vi.fn(async () => []),
    getTransactionsByDate: vi.fn(async () => []),
    getTxidCount: vi.fn(),
    getRevenueForDateRange: vi.fn()
}));
vi.mock('../../../lib/db/database.js', () => db);

const { default: historyRouter, clampDays } = await import('../history.js');
const { default: revenueRouter } = await import('../revenue.js');
const { DATA_RETENTION_DAYS } = await import('../../../lib/config.js');

let server, base;
beforeAll(async () => {
    const app = express();
    app.use('/api/history', historyRouter);
    app.use('/api', revenueRouter);
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server?.close());

describe('clampDays', () => {
    it('defaults to 90 and stays within 1..DATA_RETENTION_DAYS', () => {
        expect(clampDays(undefined)).toBe(90);
        expect(clampDays('abc')).toBe(90);
        expect(clampDays('-5')).toBe(1);
        expect(clampDays('30')).toBe(30);
        expect(clampDays('99999999')).toBe(DATA_RETENTION_DAYS);
    });
});

describe('uncapped limits', () => {
    it('/repos/history caps limit at the retention window', async () => {
        await fetch(`${base}/api/history/repos/history?image=a/b&limit=99999999`);
        expect(db.getRepoHistory).toHaveBeenCalledWith('a/b', DATA_RETENTION_DAYS);
    });

    it('/category/:category caps limit at the retention window', async () => {
        await fetch(`${base}/api/history/category/gaming?limit=99999999`);
        expect(db.getCategoryHistory).toHaveBeenCalledWith('gaming', DATA_RETENTION_DAYS);
    });
});

describe('/transactions/:date', () => {
    it('answers 400 for a malformed date without querying', async () => {
        const res = await fetch(`${base}/api/transactions/not-a-date`);
        expect(res.status).toBe(400);
        expect(db.getTransactionsByDate).not.toHaveBeenCalled();
    });

    it('queries a well-formed date', async () => {
        const res = await fetch(`${base}/api/transactions/2026-10-01`);
        expect(res.status).toBe(200);
        expect(db.getTransactionsByDate).toHaveBeenCalledWith('2026-10-01');
    });
});

describe('/transactions/summary', () => {
    it('starts all four reads before any of them answers', async () => {
        let release;
        const gate = new Promise(r => { release = r; });
        db.getTxidCount.mockImplementation(() => gate.then(() => 42));
        db.getRevenueForDateRange.mockImplementation(() => gate.then(() => 7));

        const pending = fetch(`${base}/api/transactions/summary`);
        await vi.waitFor(() => expect(db.getRevenueForDateRange).toHaveBeenCalledTimes(3));
        expect(db.getTxidCount).toHaveBeenCalledTimes(1);
        release();

        expect(await (await pending).json()).toEqual({
            totalTransactions: 42,
            revenue: { today: 7, last7Days: 7, last30Days: 7 }
        });
    });
});

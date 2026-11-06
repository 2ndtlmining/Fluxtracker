import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #567: each instance removes its own stored spec-update fees after a sync, because the
 * live site is several SQLite databases behind one domain and an admin call reaches only one.
 * Stored daily_revenue for those days has to follow, or history keeps the removed amounts.
 */

vi.mock('../../../db/database.js', () => ({
    deletePaymentsBelow: vi.fn(),
    getRevenueForDateRange: vi.fn(),
    updateSnapshotRevenue: vi.fn()
}));
vi.mock('../transactionSync.js', () => ({
    FLUXDRIVE_APP_TYPE: 'fluxdrive',
    UNREGISTERED_APP_TYPE: 'unregistered'
}));

import * as db from '../../../db/database.js';

/** A fresh module each test: "already ran" is module state. */
async function load() {
    vi.resetModules();
    return (await import('../revenueBackfill.js')).purgeFeePayments;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T12:00:00.000Z'));
    db.deletePaymentsBelow.mockResolvedValue({ deleted: 3, dates: ['2026-11-06', '2026-09-10'] });
    db.getRevenueForDateRange.mockImplementation(async date => (date === '2026-11-06' ? 5213.39 : 900));
    db.updateSnapshotRevenue.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

describe('purgeFeePayments', () => {
    it('deletes under the configured cutoff and restates each affected day', async () => {
        const purge = await load();

        await expect(purge()).resolves.toMatchObject({ deleted: 3 });

        expect(db.deletePaymentsBelow).toHaveBeenCalledWith(0.1);
        expect(db.updateSnapshotRevenue).toHaveBeenCalledWith('2026-11-06', 5213.39);
        expect(db.updateSnapshotRevenue).toHaveBeenCalledWith('2026-09-10', 900);
    });

    it('leaves today alone: its snapshot is finalised tomorrow (#248)', async () => {
        db.deletePaymentsBelow.mockResolvedValue({ deleted: 1, dates: ['2026-11-07'] });
        const purge = await load();

        await purge();

        expect(db.updateSnapshotRevenue).not.toHaveBeenCalled();
    });

    it('runs once per process', async () => {
        const purge = await load();

        await purge();
        await expect(purge()).resolves.toBeNull();

        expect(db.deletePaymentsBelow).toHaveBeenCalledTimes(1);
    });

    it('tries again after a failed delete', async () => {
        db.deletePaymentsBelow.mockRejectedValueOnce(new Error('timeout'));
        const purge = await load();

        await expect(purge()).rejects.toThrow('timeout');
        await purge();

        expect(db.deletePaymentsBelow).toHaveBeenCalledTimes(2);
        expect(db.updateSnapshotRevenue).toHaveBeenCalledTimes(2);
    });

    it('keeps a day whose restatement failed, since a second delete cannot find it again', async () => {
        db.updateSnapshotRevenue.mockImplementation(async date => {
            if (date === '2026-09-10' && db.updateSnapshotRevenue.mock.calls.length <= 2) throw new Error('timeout');
            return true;
        });
        const purge = await load();

        await purge();
        db.deletePaymentsBelow.mockResolvedValue({ deleted: 0, dates: [] });
        await purge();

        expect(db.updateSnapshotRevenue.mock.calls.filter(([date]) => date === '2026-09-10')).toHaveLength(2);
        expect(db.updateSnapshotRevenue.mock.calls.filter(([date]) => date === '2026-11-06')).toHaveLength(1);
        await expect(purge()).resolves.toBeNull();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #210 — backfilling locked collateral across existing history.
 *
 * Unlike the unique_wallets backfill (#201), which had to import figures from an outside
 * source and left 37 days it had no data for as gaps, this one is EXACT: every snapshot
 * back to day one already stores the three tier counts, and the collateral rates have
 * never changed. The backfill is arithmetic on data the row already holds.
 */

vi.mock('../database.js', () => ({
    getAllSnapshots: vi.fn(),
    fillSnapshotNullColumns: vi.fn()
}));

import { getAllSnapshots, fillSnapshotNullColumns } from '../database.js';
import { backfillLockedCollateral } from '../collateralBackfill.js';

beforeEach(() => {
    vi.clearAllMocks();
    fillSnapshotNullColumns.mockImplementation(async (_date, patch) => Object.keys(patch));
});

describe('backfillLockedCollateral', () => {
    it('computes collateral from each row own stored tier counts', async () => {
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 2907, node_nimbus: 1578, node_stratus: 1692 }
        ]);

        const result = await backfillLockedCollateral();

        expect(fillSnapshotNullColumns).toHaveBeenCalledWith('2026-09-20', {
            locked_collateral_cumulus: 2_907_000,
            locked_collateral_nimbus: 19_725_000,
            locked_collateral_stratus: 67_680_000,
            locked_collateral: 90_312_000
        });
        expect(result.filled).toBe(1);
    });

    it('uses per-row counts rather than one figure for every day', async () => {
        // The whole point of a backfill: each historical day had a different network.
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 10, node_nimbus: 0, node_stratus: 0 },
            { snapshot_date: '2026-09-19', node_cumulus: 20, node_nimbus: 0, node_stratus: 0 }
        ]);

        await backfillLockedCollateral();

        expect(fillSnapshotNullColumns).toHaveBeenNthCalledWith(1, '2026-09-20',
            expect.objectContaining({ locked_collateral: 10_000 }));
        expect(fillSnapshotNullColumns).toHaveBeenNthCalledWith(2, '2026-09-19',
            expect.objectContaining({ locked_collateral: 20_000 }));
    });

    it('skips a row that already has a collateral figure rather than restating it', async () => {
        // If a rate ever changes, an already-recorded day must keep the rate in force then.
        // That is the entire reason the per-tier values are stored instead of derived.
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 10, node_nimbus: 0, node_stratus: 0, locked_collateral: 999 }
        ]);

        const result = await backfillLockedCollateral();

        expect(fillSnapshotNullColumns).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.filled).toBe(0);
    });

    it('skips a row whose tier counts are missing rather than writing a zero', async () => {
        // A row with no node data cannot yield a collateral figure. Writing 0 would put a
        // fabricated trough in the locked-supply trend that looks like a real collapse.
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: null, node_nimbus: null, node_stratus: null }
        ]);

        const result = await backfillLockedCollateral();

        expect(fillSnapshotNullColumns).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
    });

    it('keeps going when one row fails rather than abandoning the rest', async () => {
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 10, node_nimbus: 0, node_stratus: 0 },
            { snapshot_date: '2026-09-19', node_cumulus: 20, node_nimbus: 0, node_stratus: 0 },
            { snapshot_date: '2026-09-18', node_cumulus: 30, node_nimbus: 0, node_stratus: 0 }
        ]);
        fillSnapshotNullColumns
            .mockResolvedValueOnce(['locked_collateral'])
            .mockRejectedValueOnce(new Error('row locked'))
            .mockResolvedValueOnce(['locked_collateral']);

        const result = await backfillLockedCollateral();

        expect(result.filled).toBe(2);
        expect(result.failed).toBe(1);
        expect(fillSnapshotNullColumns).toHaveBeenCalledTimes(3);
    });

    it('skips a row whose tier counts are all zero rather than recording no collateral', async () => {
        // node_cumulus/nimbus/stratus carry DEFAULT 0, so a historical row predating node
        // collection holds 0 meaning "not collected", not "zero nodes ran". Computing 0
        // collateral from it and writing that would put a fabricated trough at the start
        // of the locked-supply trend. Found by running the backfill against a real
        // 545-row history: 411 rows were exactly this shape.
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 0, node_nimbus: 0, node_stratus: 0 }
        ]);

        const result = await backfillLockedCollateral();

        expect(fillSnapshotNullColumns).not.toHaveBeenCalled();
        expect(result.skipped).toBe(1);
        expect(result.filled).toBe(0);
    });

    it('counts a row as filled only when columns were actually written', async () => {
        // fillSnapshotNullColumns returns the columns it wrote and silently declines some
        // values. Counting the ATTEMPT reported 545 of 545 filled on a run that persisted
        // 134 -- a success message that a rerun immediately contradicted.
        getAllSnapshots.mockResolvedValue([
            { snapshot_date: '2026-09-20', node_cumulus: 10, node_nimbus: 1, node_stratus: 1 },
            { snapshot_date: '2026-09-19', node_cumulus: 20, node_nimbus: 1, node_stratus: 1 }
        ]);
        fillSnapshotNullColumns
            .mockResolvedValueOnce(['locked_collateral'])
            .mockResolvedValueOnce([]);

        const result = await backfillLockedCollateral();

        expect(result.filled).toBe(1);
        expect(result.skipped).toBe(1);
    });

    it('reports an empty history without touching anything', async () => {
        getAllSnapshots.mockResolvedValue([]);

        const result = await backfillLockedCollateral();

        expect(result).toEqual({ total: 0, filled: 0, skipped: 0, failed: 0 });
        expect(fillSnapshotNullColumns).not.toHaveBeenCalled();
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #422: the chart's snapshot history carries each day's FLUX price from
 * flux_price_history (snapshot flux_price_usd only exists from late 2025), so the per-node
 * reward series in $ covers every day with a node count.
 */

vi.mock('../../../lib/db/database.js', async importOriginal => ({
    ...(await importOriginal()),
    getPricesForDateRange: vi.fn()
}));

import { getPricesForDateRange } from '../../../lib/db/database.js';
import { attachDailyPrices } from '../history.js';

beforeEach(() => vi.clearAllMocks());

describe('attachDailyPrices (issue #422)', () => {
    it('adds each day\'s price as its own field, reading the range once', async () => {
        getPricesForDateRange.mockResolvedValue([
            { date: '2025-06-01', price_usd: 0.41 },
            { date: '2025-06-03', price_usd: 0.39 }
        ]);
        const snaps = [
            { snapshot_date: '2025-06-03', flux_price_usd: null },
            { snapshot_date: '2025-06-01', flux_price_usd: null },
            { snapshot_date: '2025-06-02', flux_price_usd: 0.4 }
        ];

        await attachDailyPrices(snaps);

        expect(getPricesForDateRange).toHaveBeenCalledOnce();
        expect(getPricesForDateRange).toHaveBeenCalledWith('2025-06-01', '2025-06-03');
        expect(snaps.map(s => s.flux_price_day)).toEqual([0.39, 0.41, null]);
        expect(snaps[2].flux_price_usd).toBe(0.4);   // the snapshot's own price is untouched
    });

    it('a failed price read costs only the new field, never the snapshots', async () => {
        getPricesForDateRange.mockRejectedValue(new Error('db down'));
        const snaps = [{ snapshot_date: '2025-06-01', node_total: 5 }];

        await expect(attachDailyPrices(snaps)).resolves.toBeUndefined();
        expect(snaps[0]).toEqual({ snapshot_date: '2025-06-01', node_total: 5 });
    });
});

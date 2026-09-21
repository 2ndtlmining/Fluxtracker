import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * nodeService was the last service without retries and without structured logging;
 * it now goes through resilientFetch like every other service.
 */

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn()
}));

import axios from 'axios';
import { updateCurrentMetrics, updateSyncStatus } from '../../db/database.js';
import { fetchNodeStats } from '../nodeService.js';

const NODE_COUNTS = {
    status: 'success',
    data: { 'cumulus-enabled': 2907, 'nimbus-enabled': 1578, 'stratus-enabled': 1692, total: 6177 }
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchNodeStats', () => {
    it('maps the tier counts into the metrics columns and marks the sync completed', async () => {
        axios.get.mockResolvedValue({ data: NODE_COUNTS });

        const result = await fetchNodeStats();

        expect(result).toMatchObject({ node_cumulus: 2907, node_nimbus: 1578, node_stratus: 1692, node_total: 6177 });
        expect(updateCurrentMetrics).toHaveBeenCalledWith(result);
        expect(updateSyncStatus).toHaveBeenCalledWith('nodes', 'completed');
    });

    it('records locked collateral alongside the tier counts', async () => {
        axios.get.mockResolvedValue({ data: NODE_COUNTS });

        const result = await fetchNodeStats();

        expect(result.locked_collateral_cumulus).toBe(2907 * 1000);
        expect(result.locked_collateral_nimbus).toBe(1578 * 12500);
        expect(result.locked_collateral_stratus).toBe(1692 * 40000);
        expect(result.locked_collateral).toBe(90_312_000);
        // One write, not two: current_metrics is a read-modify-write of a single row, so a
        // second call for the collateral columns could be interleaved by another service.
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
        expect(updateCurrentMetrics).toHaveBeenCalledWith(expect.objectContaining({
            locked_collateral: 90_312_000
        }));
    });

    it('writes the tier counts but no collateral when a tier is missing from the payload', async () => {
        // The daemon answering with one tier absent is a partial reading. The counts are
        // still recorded (`|| 0` has always been their behaviour and history depends on
        // it), but locked supply must stay NULL rather than be understated by a whole
        // tier -- at 40,000 FLUX a missing stratus count is most of the total.
        axios.get.mockResolvedValue({
            data: { status: 'success', data: { 'cumulus-enabled': 2907, 'nimbus-enabled': 1578, total: 4485 } }
        });

        const result = await fetchNodeStats();

        expect(result.node_stratus).toBe(0);
        expect(result.locked_collateral).toBeNull();
        expect(result.locked_collateral_cumulus).toBeNull();
    });

    it('retries a transient failure before succeeding', async () => {
        vi.useFakeTimers();
        axios.get.mockRejectedValueOnce(new Error('boom'));
        axios.get.mockResolvedValue({ data: NODE_COUNTS });

        const pending = fetchNodeStats();
        await vi.runAllTimersAsync();   // skip the 5s retry delay
        const result = await pending;

        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(result.node_total).toBe(6177);
        vi.useRealTimers();
    });

    it('marks the sync failed and rethrows after every attempt is exhausted', async () => {
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('down'));

        const pending = expect(fetchNodeStats()).rejects.toThrow('down');
        await vi.runAllTimersAsync();
        await pending;

        expect(axios.get).toHaveBeenCalledTimes(3); // 1 + 2 retries
        expect(updateSyncStatus).toHaveBeenCalledWith('nodes', 'failed', 'down');
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

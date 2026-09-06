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

        expect(result).toEqual({ node_cumulus: 2907, node_nimbus: 1578, node_stratus: 1692, node_total: 6177 });
        expect(updateCurrentMetrics).toHaveBeenCalledWith(result);
        expect(updateSyncStatus).toHaveBeenCalledWith('nodes', 'completed');
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

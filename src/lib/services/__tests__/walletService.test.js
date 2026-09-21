import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #201 — unique wallets running Flux nodes.
 *
 * The figure is a DISTINCT count over payment_address in the deterministic node list,
 * not a row count: today ~6,400 nodes are run by ~830 wallets, so the two differ by
 * nearly 8x and confusing them would silently restate the metric as "nodes".
 */

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn()
}));

import axios from 'axios';
import { updateCurrentMetrics, updateSyncStatus } from '../../db/database.js';
import { fetchUniqueWallets, refreshUniqueWalletsIfStale, __resetWalletCacheForTests } from '../walletService.js';

/** Three wallets across five nodes — one wallet runs three, and across two tiers. */
const NODE_LIST = {
    status: 'success',
    data: [
        { payment_address: 't1Alpha', tier: 'CUMULUS', ip: '1.1.1.1' },
        { payment_address: 't1Alpha', tier: 'CUMULUS', ip: '1.1.1.2' },
        { payment_address: 't1Alpha', tier: 'STRATUS', ip: '1.1.1.3' },
        { payment_address: 't1Beta', tier: 'NIMBUS', ip: '2.2.2.1' },
        { payment_address: 't1Gamma', tier: 'CUMULUS', ip: '3.3.3.1' }
    ]
};

beforeEach(() => {
    vi.clearAllMocks();
    __resetWalletCacheForTests();
});

describe('fetchUniqueWallets', () => {
    it('counts distinct payment addresses, not nodes', async () => {
        axios.get.mockResolvedValue({ data: NODE_LIST });

        const result = await fetchUniqueWallets();

        expect(result).toEqual({ unique_wallets: 3 });
        expect(updateCurrentMetrics).toHaveBeenCalledWith({ unique_wallets: 3 });
        expect(updateSyncStatus).toHaveBeenCalledWith('wallets', 'completed');
    });

    it('ignores entries with no payment address rather than counting them as one wallet', async () => {
        // A missing address is absence of information. Letting undefined/'' into the Set
        // would add exactly one phantom wallet, however many such rows there are.
        axios.get.mockResolvedValue({
            data: {
                status: 'success',
                data: [
                    { payment_address: 't1Alpha' },
                    { payment_address: '' },
                    { payment_address: null },
                    {},
                    { payment_address: 't1Beta' }
                ]
            }
        });

        const result = await fetchUniqueWallets();

        expect(result).toEqual({ unique_wallets: 2 });
    });

    it('marks the sync failed and rethrows rather than writing 0', async () => {
        // A 0 here would read as "the network lost every operator" and, because daily
        // snapshots are averaged into the KPI report, would be averaged in as a real
        // reading. Failure must stay absent, not become a number.
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('down'));

        const pending = expect(fetchUniqueWallets()).rejects.toThrow('down');
        await vi.runAllTimersAsync();
        await pending;

        expect(updateSyncStatus).toHaveBeenCalledWith('wallets', 'failed', 'down');
        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('rejects an empty node list instead of recording zero wallets', async () => {
        // A successful-looking response carrying no nodes is an upstream fault, not a
        // network with no operators. Same reasoning as above: never persist the 0.
        vi.useFakeTimers();
        axios.get.mockResolvedValue({ data: { status: 'success', data: [] } });

        const pending = expect(fetchUniqueWallets()).rejects.toThrow();
        await vi.runAllTimersAsync();
        await pending;

        expect(updateCurrentMetrics).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('retries a transient failure before succeeding', async () => {
        vi.useFakeTimers();
        axios.get.mockRejectedValueOnce(new Error('boom'));
        axios.get.mockResolvedValue({ data: NODE_LIST });

        const pending = fetchUniqueWallets();
        await vi.runAllTimersAsync();
        const result = await pending;

        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(result.unique_wallets).toBe(3);
        vi.useRealTimers();
    });
});

describe('refreshUniqueWalletsIfStale', () => {
    it('fetches on a cold cache', async () => {
        axios.get.mockResolvedValue({ data: NODE_LIST });

        const result = await refreshUniqueWalletsIfStale();

        expect(result).toEqual({ unique_wallets: 3 });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('skips the ~4MB fetch while the previous count is still fresh', async () => {
        // The service cycle runs every few minutes; this payload is refreshed hourly.
        axios.get.mockResolvedValue({ data: NODE_LIST });

        await refreshUniqueWalletsIfStale();
        const second = await refreshUniqueWalletsIfStale();

        expect(second).toEqual({ skipped: true });
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(updateCurrentMetrics).toHaveBeenCalledTimes(1);
    });

    it('retries on the next cycle after a failure rather than waiting out the interval', async () => {
        // Only successes arm the freshness gate. If failures armed it too, one bad hour
        // would suppress retries for a full interval.
        vi.useFakeTimers();
        axios.get.mockRejectedValue(new Error('down'));
        const failing = expect(refreshUniqueWalletsIfStale()).rejects.toThrow('down');
        await vi.runAllTimersAsync();
        await failing;
        vi.useRealTimers();

        axios.get.mockResolvedValue({ data: NODE_LIST });
        const result = await refreshUniqueWalletsIfStale();

        expect(result).toEqual({ unique_wallets: 3 });
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The one scheduler with no tests (issue #225). servicesScheduler and kpiScheduler both have
 * them; this one drives the revenue figures.
 *
 * What makes it worth covering is the `isRunning` flag. It is shared by runSync() and
 * runAudit() and is cleared only in a `finally`. If an edit ever lets it stay true, every
 * later tick returns at the concurrency guard and revenue sync stops forever -- while
 * /api/health still reports `isSchedulerRunning: true`, because that reads the interval
 * handle, not the flag. The only symptom is a revenue number that quietly stops moving.
 */

const mockFetchRevenueStats = vi.fn();
const mockAuditRecentTransactions = vi.fn();
vi.mock('../revenueService.js', () => ({
    fetchRevenueStats: (...args) => mockFetchRevenueStats(...args),
    auditRecentTransactions: (...args) => mockAuditRecentTransactions(...args)
}));

const mockBackfillNullUsdAmounts = vi.fn();
vi.mock('../priceHistoryService.js', () => ({
    backfillNullUsdAmounts: (...args) => mockBackfillNullUsdAmounts(...args)
}));

const mockShouldAllowRequest = vi.fn();
const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
vi.mock('../../db/circuitBreaker.js', () => ({
    shouldAllowRequest: (...args) => mockShouldAllowRequest(...args),
    recordSuccess: (...args) => mockRecordSuccess(...args),
    recordFailure: (...args) => mockRecordFailure(...args)
}));

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUDIT_INITIAL_DELAY_MS = 5 * 60 * 1000;
const AUDIT_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * The scheduler keeps its state at module scope, so each test gets a fresh copy of the
 * module rather than inheriting the previous test's interval handles and flags.
 */
async function loadScheduler() {
    vi.resetModules();
    return await import('../revenueScheduler.js');
}

/** A promise with its resolve/reject exposed, to hold a sync open mid-flight. */
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

let scheduler;

beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockShouldAllowRequest.mockReturnValue(true);
    mockFetchRevenueStats.mockResolvedValue(undefined);
    mockAuditRecentTransactions.mockResolvedValue({ recovered: 0, missingFound: 0 });
    mockBackfillNullUsdAmounts.mockResolvedValue({ updated: 0, skipped: 0 });
    scheduler = await loadScheduler();
});

afterEach(() => {
    scheduler?.stopRevenueSync();
    vi.useRealTimers();
});

describe('startRevenueSync', () => {
    it('syncs immediately rather than waiting out the first interval', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(1);
    });

    it('syncs again on every interval tick', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(4); // immediate + 3 ticks
    });

    it('ignores a second start rather than stacking a second interval', async () => {
        scheduler.startRevenueSync();
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(2); // not 4
    });

    it('reports itself as running once started', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(scheduler.getRevenueSyncSchedulerStatus().isSchedulerRunning).toBe(true);
    });
});

describe('the isRunning guard', () => {
    it('skips a tick while the previous sync is still in flight', async () => {
        const inFlight = deferred();
        mockFetchRevenueStats.mockReturnValueOnce(inFlight.promise);

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(1); // the tick was skipped
        expect(scheduler.getRevenueSyncSchedulerStatus().isSyncInProgress).toBe(true);

        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(scheduler.getRevenueSyncSchedulerStatus().isSyncInProgress).toBe(false);
    });

    it('clears the flag after a FAILED sync, so the next tick still runs', async () => {
        // The failure that matters: if the flag survived a throw, every later tick would
        // return at the guard and revenue sync would stop forever, with the health endpoint
        // still reporting the scheduler as running.
        mockFetchRevenueStats.mockRejectedValueOnce(new Error('supabase unreachable'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(scheduler.getRevenueSyncSchedulerStatus().isSyncInProgress).toBe(false);

        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(2);
    });

    it('keeps syncing after a failed audit too', async () => {
        mockAuditRecentTransactions.mockRejectedValueOnce(new Error('audit blew up'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS);
        expect(mockAuditRecentTransactions).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
        expect(scheduler.getRevenueSyncSchedulerStatus().isSyncInProgress).toBe(false);
        expect(mockFetchRevenueStats.mock.calls.length).toBeGreaterThan(1);
    });
});

describe('the deferred-audit handoff', () => {
    it('queues an audit that lands mid-sync and runs it once the sync finishes', async () => {
        const inFlight = deferred();
        mockFetchRevenueStats.mockReturnValueOnce(inFlight.promise);

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS);

        // The audit's turn came while the first sync was still running: deferred, not dropped.
        expect(mockAuditRecentTransactions).not.toHaveBeenCalled();

        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockAuditRecentTransactions).toHaveBeenCalledTimes(1);
    });

    it('runs a deferred audit exactly once, not once per later sync', async () => {
        const inFlight = deferred();
        mockFetchRevenueStats.mockReturnValueOnce(inFlight.promise);

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS);
        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);

        expect(mockAuditRecentTransactions).toHaveBeenCalledTimes(1);
    });

    it('backfills missing USD amounts as part of an audit', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS);

        expect(mockBackfillNullUsdAmounts).toHaveBeenCalledTimes(1);
    });

    it('repeats the audit on its own longer interval', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS);
        await vi.advanceTimersByTimeAsync(AUDIT_INTERVAL_MS);

        expect(mockAuditRecentTransactions).toHaveBeenCalledTimes(2);
    });
});

describe('circuit breaker wiring', () => {
    it('skips the sync entirely while the breaker is OPEN', async () => {
        mockShouldAllowRequest.mockReturnValue(false);

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);

        expect(mockFetchRevenueStats).not.toHaveBeenCalled();
        // A skipped run is not a failure -- recording one would keep the breaker open on its
        // own skips.
        expect(mockRecordFailure).not.toHaveBeenCalled();
    });

    it('records a success on a clean sync', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockRecordSuccess).toHaveBeenCalledTimes(1);
        expect(mockRecordFailure).not.toHaveBeenCalled();
    });

    it('records a failure when the sync throws', async () => {
        mockFetchRevenueStats.mockRejectedValueOnce(new Error('supabase unreachable'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockRecordFailure).toHaveBeenCalledTimes(1);
        expect(mockRecordSuccess).not.toHaveBeenCalled();
    });
});

describe('health status', () => {
    it('counts consecutive failures and turns unhealthy at three', async () => {
        mockFetchRevenueStats.mockRejectedValue(new Error('supabase unreachable'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);

        const status = scheduler.getRevenueSyncSchedulerStatus();
        expect(status.consecutiveFailures).toBe(3);
        expect(status.isHealthy).toBe(false);
    });

    it('resets the failure count on the first sync that succeeds', async () => {
        mockFetchRevenueStats
            .mockRejectedValueOnce(new Error('one'))
            .mockRejectedValueOnce(new Error('two'))
            .mockResolvedValueOnce(undefined);

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);

        const status = scheduler.getRevenueSyncSchedulerStatus();
        expect(status.consecutiveFailures).toBe(0);
        expect(status.isHealthy).toBe(true);
    });

    it('records the time of the last successful sync only', async () => {
        mockFetchRevenueStats.mockRejectedValueOnce(new Error('nope'));

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);
        expect(scheduler.getRevenueSyncSchedulerStatus().lastRun).toBeNull();

        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
        expect(scheduler.getRevenueSyncSchedulerStatus().lastRun).toEqual(expect.any(Number));
    });
});

describe('stopRevenueSync', () => {
    it('stops the sync interval, the audit timer and the audit interval', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);
        mockFetchRevenueStats.mockClear();

        scheduler.stopRevenueSync();
        await vi.advanceTimersByTimeAsync(AUDIT_INITIAL_DELAY_MS + AUDIT_INTERVAL_MS);

        expect(mockFetchRevenueStats).not.toHaveBeenCalled();
        expect(mockAuditRecentTransactions).not.toHaveBeenCalled();
        expect(scheduler.getRevenueSyncSchedulerStatus().isSchedulerRunning).toBe(false);
    });

    it('can be restarted after being stopped', async () => {
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);
        scheduler.stopRevenueSync();
        mockFetchRevenueStats.mockClear();

        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(1);
        expect(scheduler.getRevenueSyncSchedulerStatus().isSchedulerRunning).toBe(true);
    });

    it('does not abandon or double-run a sync that was in flight when it was stopped', async () => {
        // stop() clears the timers, not the flag: an in-flight sync finishes on its own, and
        // a restart before it does is held at the concurrency guard rather than running a
        // second copy over the top of it.
        const inFlight = deferred();
        mockFetchRevenueStats.mockReturnValueOnce(inFlight.promise);

        scheduler.startRevenueSync();
        scheduler.stopRevenueSync();
        scheduler.startRevenueSync();
        await vi.advanceTimersByTimeAsync(0);

        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(1);

        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(scheduler.getRevenueSyncSchedulerStatus().isSyncInProgress).toBe(false);

        // ...and once it has, the restarted scheduler picks up normally on its next tick.
        await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS);
        expect(mockFetchRevenueStats).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when nothing is running', () => {
        expect(() => scheduler.stopRevenueSync()).not.toThrow();
    });
});

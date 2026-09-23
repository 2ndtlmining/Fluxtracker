import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabaseClient.js to avoid heavy side effects (Supabase client creation).
// The path matches the import in circuitBreaker.js: './supabaseClient.js'
// `active` mirrors the real client: switchTo() changes it, getActiveInstanceName() reads it.
vi.mock('../supabaseClient.js', () => {
    const client = {
        active: 'primary',
        switchTo: vi.fn(target => {
            const previous = client.active;
            client.active = target;
            return { success: true, previous, active: target, changed: previous !== target };
        }),
        getActiveInstanceName: vi.fn(() => client.active),
        hasFailover: vi.fn(() => true)
    };
    return { ...client, __client: client };
});

/**
 * Helper: dynamically import a fresh circuitBreaker module.
 * Because `isSqlite` is evaluated at module load time, we must
 * use vi.resetModules() + dynamic import to get isolated state per test.
 */
async function loadFreshModule() {
    vi.resetModules();
    const cb = await import('../circuitBreaker.js');
    const client = await import('../supabaseClient.js');
    // Clear accumulated mock calls and state from previous tests
    client.__client.active = 'primary';
    client.switchTo.mockClear();
    client.hasFailover.mockClear();
    return { cb, client };
}

/** Trip the breaker by recording FAILURE_THRESHOLD (5) failures. */
function tripBreaker(cb) {
    for (let i = 0; i < 5; i++) {
        cb.recordFailure();
    }
}

describe('circuitBreaker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Default to supabase mode
        delete process.env.DB_TYPE;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete process.env.DB_TYPE;
    });

    // ── Test 1 ──────────────────────────────────────────────────────────
    it('CLOSED: allows requests in fresh state', async () => {
        const { cb } = await loadFreshModule();

        expect(cb.shouldAllowRequest()).toBe(true);
        expect(cb.getCircuitState().state).toBe('CLOSED');
    });

    // ── Test 2 ──────────────────────────────────────────────────────────
    it('CLOSED -> OPEN after 5 failures', async () => {
        const { cb } = await loadFreshModule();

        for (let i = 0; i < 4; i++) {
            cb.recordFailure();
            // Still CLOSED after fewer than 5 failures
            expect(cb.shouldAllowRequest()).toBe(true);
        }

        cb.recordFailure(); // 5th failure
        expect(cb.getCircuitState().state).toBe('OPEN');
        expect(cb.shouldAllowRequest()).toBe(false);
    });

    // ── Test 3 ──────────────────────────────────────────────────────────
    it('OPEN -> HALF_OPEN after cooldown expires', async () => {
        const { cb } = await loadFreshModule();

        tripBreaker(cb);
        expect(cb.getCircuitState().state).toBe('OPEN');
        expect(cb.shouldAllowRequest()).toBe(false);

        // Advance time past the 60-second cooldown
        vi.advanceTimersByTime(60_001);

        expect(cb.shouldAllowRequest()).toBe(true);
        expect(cb.getCircuitState().state).toBe('HALF_OPEN');
    });

    // ── Test 4 ──────────────────────────────────────────────────────────
    it('HALF_OPEN -> CLOSED on success', async () => {
        const { cb } = await loadFreshModule();

        tripBreaker(cb);
        vi.advanceTimersByTime(60_001);
        cb.shouldAllowRequest(); // triggers transition to HALF_OPEN
        expect(cb.getCircuitState().state).toBe('HALF_OPEN');

        cb.recordSuccess();
        expect(cb.getCircuitState().state).toBe('CLOSED');
        expect(cb.getCircuitState().failureCount).toBe(0);
        expect(cb.shouldAllowRequest()).toBe(true);
    });

    // ── Test 5 ──────────────────────────────────────────────────────────
    it('HALF_OPEN -> OPEN on failure', async () => {
        const { cb } = await loadFreshModule();

        tripBreaker(cb);
        vi.advanceTimersByTime(60_001);
        cb.shouldAllowRequest(); // transition to HALF_OPEN
        expect(cb.getCircuitState().state).toBe('HALF_OPEN');

        cb.recordFailure(); // single failure in HALF_OPEN re-trips the breaker
        expect(cb.getCircuitState().state).toBe('OPEN');
        expect(cb.shouldAllowRequest()).toBe(false);
    });

    // ── Test 6 ──────────────────────────────────────────────────────────
    it('auto-failover fires once, primary -> failover, and never flips back (issue #308)', async () => {
        const { cb, client } = await loadFreshModule();

        // First trip: primary -> failover
        tripBreaker(cb);
        expect(client.switchTo).toHaveBeenCalledTimes(1);
        expect(client.switchTo).toHaveBeenCalledWith('failover');
        expect(client.__client.active).toBe('failover');

        // More failures while already OPEN: nothing
        cb.recordFailure();
        cb.recordFailure();
        expect(client.switchTo).toHaveBeenCalledTimes(1);

        // A failed HALF_OPEN probe is the same outage, not a new one. The old code treated
        // it as a fresh trip and toggled the failover straight back to the dead primary.
        vi.advanceTimersByTime(60_001);
        cb.shouldAllowRequest(); // HALF_OPEN
        cb.recordFailure();      // back to OPEN
        expect(client.switchTo).toHaveBeenCalledTimes(1);
        expect(client.__client.active).toBe('failover');
    });

    it('a new outage while already on the failover does not switch back to the primary', async () => {
        const { cb, client } = await loadFreshModule();
        client.__client.active = 'failover';

        tripBreaker(cb); // CLOSED -> OPEN while on the failover

        expect(client.switchTo).not.toHaveBeenCalled();
        expect(client.__client.active).toBe('failover');
    });

    // ── Test 7 ──────────────────────────────────────────────────────────
    it('SQLite mode always allows requests even after failures', async () => {
        process.env.DB_TYPE = 'sqlite';
        const { cb } = await loadFreshModule();

        expect(cb.shouldAllowRequest()).toBe(true);

        // Even after many failures, shouldAllowRequest still returns true
        for (let i = 0; i < 10; i++) {
            cb.recordFailure();
        }
        expect(cb.shouldAllowRequest()).toBe(true);
    });

    // ── Test 8 ──────────────────────────────────────────────────────────
    it('getCircuitState returns correct shape and values', async () => {
        const { cb } = await loadFreshModule();

        const initial = cb.getCircuitState();
        expect(initial).toEqual({
            state: 'CLOSED',
            failureCount: 0,
            lastFailureTime: 0,
            cooldownMs: 60_000,
            failureThreshold: 5
        });

        cb.recordFailure();
        cb.recordFailure();
        const afterTwo = cb.getCircuitState();
        expect(afterTwo.state).toBe('CLOSED');
        expect(afterTwo.failureCount).toBe(2);
        expect(afterTwo.lastFailureTime).toBeGreaterThan(0);
        expect(afterTwo.cooldownMs).toBe(60_000);
        expect(afterTwo.failureThreshold).toBe(5);
    });
});

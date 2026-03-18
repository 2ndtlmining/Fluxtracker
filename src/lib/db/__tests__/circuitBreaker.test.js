import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabaseClient.js to avoid heavy side effects (Supabase client creation).
// The path matches the import in circuitBreaker.js: './supabaseClient.js'
vi.mock('../supabaseClient.js', () => ({
    switchToFailover: vi.fn(() => ({ success: true, previous: 'primary', active: 'failover' })),
    hasFailover: vi.fn(() => true)
}));

/**
 * Helper: dynamically import a fresh circuitBreaker module.
 * Because `isSqlite` is evaluated at module load time, we must
 * use vi.resetModules() + dynamic import to get isolated state per test.
 */
async function loadFreshModule() {
    vi.resetModules();
    const cb = await import('../circuitBreaker.js');
    const client = await import('../supabaseClient.js');
    // Clear accumulated mock calls from previous tests
    client.switchToFailover.mockClear();
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
    it('auto-failover fires once on first OPEN, not on subsequent OPEN transitions', async () => {
        const { cb, client } = await loadFreshModule();

        // First trip: should trigger switchToFailover
        tripBreaker(cb);
        expect(client.switchToFailover).toHaveBeenCalledTimes(1);

        // Record more failures while already OPEN — should NOT call switchToFailover again
        cb.recordFailure();
        cb.recordFailure();
        expect(client.switchToFailover).toHaveBeenCalledTimes(1);

        // Transition OPEN -> HALF_OPEN -> OPEN again
        vi.advanceTimersByTime(60_001);
        cb.shouldAllowRequest(); // HALF_OPEN
        cb.recordFailure();      // back to OPEN
        // This is a NEW transition to OPEN (from HALF_OPEN), so failover fires again
        expect(client.switchToFailover).toHaveBeenCalledTimes(2);
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

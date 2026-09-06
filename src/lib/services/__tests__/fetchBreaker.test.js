import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Per-endpoint fetch breaker. Same state machine as the DB circuit breaker, but keyed —
 * one dead endpoint must not block another.
 */

vi.mock('../../logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

import {
    shouldAllowRequest,
    recordSuccess,
    recordFailure,
    getState,
    resetCircuits
} from '../fetchBreaker.js';

const FLUX_API = 'flux-stats';
const PRICE_API = 'binance';

beforeEach(() => {
    vi.useFakeTimers();
    resetCircuits();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('fetchBreaker', () => {
    it('allows requests while CLOSED', () => {
        expect(shouldAllowRequest(FLUX_API)).toBe(true);
    });

    it('stays CLOSED through fewer than the threshold failures', () => {
        for (let i = 0; i < 4; i++) {
            recordFailure(FLUX_API);
        }
        expect(getState(FLUX_API).state).toBe('CLOSED');
        expect(shouldAllowRequest(FLUX_API)).toBe(true);
    });

    it('opens at the failure threshold and blocks calls', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        expect(getState(FLUX_API).state).toBe('OPEN');
        expect(shouldAllowRequest(FLUX_API)).toBe(false);
    });

    it('keys are independent — one open endpoint never blocks another', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        expect(shouldAllowRequest(FLUX_API)).toBe(false);
        expect(shouldAllowRequest(PRICE_API)).toBe(true);
    });

    it('half-opens after the cooldown and allows one probe', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        vi.advanceTimersByTime(60_000 + 1);
        expect(shouldAllowRequest(FLUX_API)).toBe(true); // probe
        // A failed probe re-opens immediately, before the threshold is re-reached
        recordFailure(FLUX_API);
        expect(shouldAllowRequest(FLUX_API)).toBe(false);
    });

    it('a successful probe closes the circuit and resets the count', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        vi.advanceTimersByTime(60_000 + 1);
        shouldAllowRequest(FLUX_API); // probe allowed
        recordSuccess(FLUX_API);
        expect(getState(FLUX_API).state).toBe('CLOSED');
        expect(getState(FLUX_API).failureCount).toBe(0);
        expect(shouldAllowRequest(FLUX_API)).toBe(true);
    });

    it('a success closes an OPEN circuit even without a probe window', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        recordSuccess(FLUX_API);
        expect(shouldAllowRequest(FLUX_API)).toBe(true);
    });

    it('does not re-trip an already OPEN circuit as a fresh event', () => {
        for (let i = 0; i < 5; i++) {
            recordFailure(FLUX_API);
        }
        expect(getState(FLUX_API).state).toBe('OPEN');
        // More failures while OPEN: cooldown anchor moves, but no new "tripped" state
        recordFailure(FLUX_API);
        expect(getState(FLUX_API).state).toBe('OPEN');
    });
});

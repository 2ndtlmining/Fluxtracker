// ============================================
// FETCH CIRCUIT BREAKER — per-endpoint, keyed
// ============================================
// Same state machine as the DB circuit breaker (CLOSED → OPEN → HALF_OPEN), but generic
// and keyed per outbound endpoint, so one dead API (e.g. a Flux stats endpoint) cannot
// burn every service cycle timing out against it while the rest of the network reads on.
//
// One dead endpoint must never block another: state is tracked per key, and a key that
// recovers re-enters CLOSED without touching the others.

import { FETCH_CIRCUIT_BREAKER_CONFIG } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('fetchBreaker');

const FAILURE_THRESHOLD = FETCH_CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD;
const COOLDOWN_MS = FETCH_CIRCUIT_BREAKER_CONFIG.COOLDOWN_MS;

// key -> { state, failureCount, lastFailureTime }
const circuits = new Map();

function circuitOf(key) {
    let circuit = circuits.get(key);
    if (!circuit) {
        circuit = { state: 'CLOSED', failureCount: 0, lastFailureTime: 0 };
        circuits.set(key, circuit);
    }
    return circuit;
}

/** Whether a call to `key` may go out right now. Advances OPEN → HALF_OPEN on cooldown. */
export function shouldAllowRequest(key) {
    const circuit = circuitOf(key);

    if (circuit.state === 'CLOSED') return true;

    if (circuit.state === 'OPEN') {
        if (Date.now() - circuit.lastFailureTime >= COOLDOWN_MS) {
            circuit.state = 'HALF_OPEN';
            log.info({ key }, 'fetch breaker -> HALF_OPEN (probing)');
            return true;
        }
        return false;
    }

    // HALF_OPEN — allow one probe request
    return true;
}

export function recordSuccess(key) {
    const circuit = circuitOf(key);
    if (circuit.state !== 'CLOSED') {
        log.info({ key }, 'fetch breaker -> CLOSED (recovered)');
    }
    circuit.state = 'CLOSED';
    circuit.failureCount = 0;
}

export function recordFailure(key) {
    const circuit = circuitOf(key);
    circuit.failureCount++;
    circuit.lastFailureTime = Date.now();

    if (circuit.state === 'HALF_OPEN' || circuit.failureCount >= FAILURE_THRESHOLD) {
        if (circuit.state !== 'OPEN') {
            circuit.state = 'OPEN';
            log.info({ key, failureCount: circuit.failureCount }, 'fetch breaker -> OPEN');
        }
    }
}

export function getState(key) {
    const circuit = circuitOf(key);
    return {
        state: circuit.state,
        failureCount: circuit.failureCount,
        lastFailureTime: circuit.lastFailureTime,
        cooldownMs: COOLDOWN_MS,
        failureThreshold: FAILURE_THRESHOLD
    };
}

/** Test hook — drops every circuit. */
export function resetCircuits() {
    circuits.clear();
}

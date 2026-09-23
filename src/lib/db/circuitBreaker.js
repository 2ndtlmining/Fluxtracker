// ============================================
// CIRCUIT BREAKER — prevents hammering a dead DB
// ============================================
// States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (probing)
// In SQLite mode the DB is local — circuit breaker is always CLOSED.

import { switchTo, hasFailover, getActiveInstanceName } from './supabaseClient.js';
import { CIRCUIT_BREAKER_CONFIG } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('circuitBreaker');

const isSqlite = (process.env.DB_TYPE || 'supabase').toLowerCase() === 'sqlite';

const FAILURE_THRESHOLD = CIRCUIT_BREAKER_CONFIG.FAILURE_THRESHOLD;
const COOLDOWN_MS = CIRCUIT_BREAKER_CONFIG.COOLDOWN_MS;

let state = 'CLOSED';
let failureCount = 0;
let lastFailureTime = 0;

export function shouldAllowRequest() {
    if (isSqlite) return true; // local DB — always available

    if (state === 'CLOSED') return true;

    if (state === 'OPEN') {
        if (Date.now() - lastFailureTime >= COOLDOWN_MS) {
            state = 'HALF_OPEN';
            log.info('[CIRCUIT-BREAKER] Circuit breaker -> HALF_OPEN (probing)');
            return true;
        }
        return false;
    }

    // HALF_OPEN — allow one probe request
    return true;
}

export function recordSuccess() {
    if (state !== 'CLOSED') {
        log.info(`[CIRCUIT-BREAKER] Circuit breaker -> CLOSED (was ${state})`);
    }
    state = 'CLOSED';
    failureCount = 0;
}

export function recordFailure() {
    failureCount++;
    lastFailureTime = Date.now();

    if (state === 'HALF_OPEN' || failureCount >= FAILURE_THRESHOLD) {
        // Only a CLOSED -> OPEN trip is a new outage. A failed HALF_OPEN probe is the same
        // outage continuing, and used to count as a "first" trip too: with the old toggle
        // that sent traffic from the failover straight back to the dead primary on every
        // cooldown (issue #308).
        const wasClosed = state === 'CLOSED';
        state = 'OPEN';
        log.info(`[CIRCUIT-BREAKER] Circuit breaker -> OPEN (${failureCount} consecutive failures)`);

        // Automatic failover only ever moves primary -> failover. Going back is a manual
        // decision (POST /api/admin/failover) because data written meanwhile needs reconciling.
        if (wasClosed && hasFailover() && getActiveInstanceName() === 'primary') {
            const result = switchTo('failover');
            if (result.success && result.changed) {
                log.info(`[AUTO-FAILOVER] Switched ${result.previous} -> ${result.active}`);
            }
        }
    }
}

export function getCircuitState() {
    return {
        state,
        failureCount,
        lastFailureTime,
        cooldownMs: COOLDOWN_MS,
        failureThreshold: FAILURE_THRESHOLD
    };
}

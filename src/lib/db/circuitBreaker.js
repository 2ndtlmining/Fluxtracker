// ============================================
// CIRCUIT BREAKER — prevents hammering a dead DB
// ============================================
// States: CLOSED (normal) → OPEN (tripped) → HALF_OPEN (probing)
// In SQLite mode the DB is local — circuit breaker is always CLOSED.

import { switchToFailover, hasFailover } from './supabaseClient.js';
import { CIRCUIT_BREAKER_CONFIG } from '../config.js';

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
            console.log('🔌 Circuit breaker → HALF_OPEN (probing)');
            return true;
        }
        return false;
    }

    // HALF_OPEN — allow one probe request
    return true;
}

export function recordSuccess() {
    if (state !== 'CLOSED') {
        console.log(`🔌 Circuit breaker → CLOSED (was ${state})`);
    }
    state = 'CLOSED';
    failureCount = 0;
}

export function recordFailure() {
    failureCount++;
    lastFailureTime = Date.now();

    if (state === 'HALF_OPEN' || failureCount >= FAILURE_THRESHOLD) {
        const wasAlreadyOpen = state === 'OPEN';
        state = 'OPEN';
        console.log(`🔌 Circuit breaker → OPEN (${failureCount} consecutive failures)`);

        // Auto-failover on FIRST transition to OPEN only
        if (!wasAlreadyOpen && hasFailover()) {
            const result = switchToFailover();
            if (result.success) {
                console.log(`AUTO-FAILOVER: Switched ${result.previous} → ${result.active}`);
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

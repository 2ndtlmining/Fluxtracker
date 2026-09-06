// ============================================
// RESILIENT FETCH — one shared HTTP GET primitive
// ============================================
// Every outbound Flux/exchange API read in the services goes through here:
//   - retries with a fixed delay between attempts
//   - per-attempt timeout
//   - optional per-endpoint circuit breaker (fetchBreaker.js) so a dead endpoint is
//     short-circuited for a cooldown instead of being hammered every cycle
//   - optional response-shape validation, so an HTTP 200 carrying garbage counts as a
//     failure and is retried/recorded like any other
//
// Not covered on purpose:
//   - POST/webhook calls (e.g. the Discord KPI delivery) — a retry could duplicate the
//     user-visible message; those keep their own explicit status handling
//   - last-good-cache fallbacks — they are service-shaped (cloudService falls back to DB
//     reads, runningAppsProvider to an in-memory snapshot) and stay in their services;
//     this helper throws when the retries are exhausted and the caller decides

import axios from 'axios';
import { createLogger } from '../logger.js';
import { shouldAllowRequest, recordSuccess, recordFailure } from './fetchBreaker.js';

const log = createLogger('resilientFetch');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Thrown without recording a new failure — the circuit was already open. */
export class CircuitOpenError extends Error {
    constructor(key) {
        super(`Circuit open for "${key}" — skipping fetch during cooldown`);
        this.name = 'CircuitOpenError';
        this.key = key;
    }
}

/**
 * GET `url` with retries, timeout, optional breaker and optional shape validation.
 * Resolves with the parsed response body (`response.data`).
 *
 * A failure is recorded on the breaker once per call (after the retries are exhausted),
 * not per attempt — retries are the helper's own first line of defence.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {number} [options.timeout=15000]        per-attempt timeout (ms)
 * @param {number} [options.retries=0]            attempts after the first
 * @param {number} [options.delayMs=5000]         delay between attempts (ms)
 * @param {string} [options.breakerKey]           opt-in per-endpoint circuit breaker
 * @param {(data:any) => boolean} [options.validate] response-shape check; a false result
 *                                                 counts as a failure and is retried
 * @param {object} [options.axiosConfig]          extra axios config (headers, params...)
 * @returns {Promise<any>} the parsed response body
 */
export async function resilientFetch(url, {
    timeout = 15000,
    retries = 0,
    delayMs = 5000,
    breakerKey = null,
    validate = null,
    axiosConfig = {}
} = {}) {
    if (breakerKey && !shouldAllowRequest(breakerKey)) {
        throw new CircuitOpenError(breakerKey);
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, { timeout, ...axiosConfig });
            const data = response.data;

            if (validate && !validate(data)) {
                throw new Error(`Response from ${url} failed validation`);
            }

            if (breakerKey) recordSuccess(breakerKey);
            return data;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                log.warn({ url: String(url), attempt: attempt + 1, retries, err: error.message }, 'fetch failed, retrying');
                await sleep(delayMs);
            }
        }
    }

    if (breakerKey) recordFailure(breakerKey);
    throw lastError;
}

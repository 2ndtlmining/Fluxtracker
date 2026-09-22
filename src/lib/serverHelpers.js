// Shared helpers used across the src/routes/api/* router modules. Extracted from server.js
// (issue #123) so routers don't depend on server.js itself, and so nothing gets duplicated
// across modules.
import { shouldAllowRequest, recordSuccess, recordFailure } from './db/circuitBreaker.js';
import { dbSuccessCount, isDatabaseError } from './db/dbCallTracker.js';

// ============================================
// RESPONSE CACHE — stale-while-revalidate
// ============================================
export function createCache(ttlMs) {
    const store = new Map();
    return {
        get(key) {
            const entry = store.get(key);
            if (entry && Date.now() - entry.time < ttlMs) return entry.data;
            return null;
        },
        getStale(key) {
            const entry = store.get(key);
            return entry ? entry.data : null;
        },
        set(key, data) {
            store.set(key, { data, time: Date.now() });
        }
    };
}

// ============================================
// DB FALLBACK HELPER — circuit breaker + stale cache
// ============================================
/**
 * Runs in progress, keyed by cache key (issue #221). Shared across every cache instance:
 * the keys already carry their endpoint ('header', `snapshots:${...}`), so collisions
 * between routers would mean two routers had chosen the same key for different data.
 */
const inFlight = new Map();

export async function withDbFallback(cache, cacheKey, res, fetchFn) {
    // 1. Return fresh cache if available
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // 2. If circuit is open, return stale cache or 503
    if (!shouldAllowRequest()) {
        const stale = cache.getStale(cacheKey);
        if (stale) return res.status(503).json({ ...stale, _stale: true, _circuitOpen: true });
        return res.status(503).json({ error: 'Database unavailable', _circuitOpen: true });
    }

    // 3. Collapse concurrent misses on the same key into one run (issue #221).
    //
    // The cache check and the fetch used to have nothing between them, so every viewer
    // whose poll landed in the same miss window paid its own upstream fetch and its own
    // database fan-out. On /api/header that meant a 3.76 MB download and two exact counts
    // of revenue_transactions per concurrent viewer. Same pattern as
    // runningAppsProvider.getRunningApps(); living here, it covers every cached endpoint.
    //
    // Joiners get the leader's outcome, including its failure -- retrying behind a request
    // that just failed would rebuild the stampede this prevents. The entry is cleared in
    // `finally`, so the next request after a failure tries again.
    const existing = inFlight.get(cacheKey);
    if (existing) {
        try {
            const data = await existing;
            return res.json(data);
        } catch (error) {
            const stale = cache.getStale(cacheKey);
            if (stale) return res.status(503).json({ ...stale, _stale: true });
            return res.status(503).json({ error: error.message });
        }
    }

    // 4. Run the route's work, and judge the DATABASE only on what the database did.
    //
    // Some routes here do upstream-API work as well (/api/apps/deployment-fill) or both
    // (/api/games/live). Counting an upstream outage as a database failure is what let a
    // Flux API outage trip this breaker and auto-failover Supabase (issue #219), and
    // counting an upstream success as a database success is the same mistake mirrored --
    // it would clear the failure count of a database that was genuinely down.
    //
    // The client-facing behaviour below is deliberately unchanged: either kind of failure
    // still serves the stale cache, or a 503 carrying the message.
    const dbCallsBefore = dbSuccessCount();
    // The IIFE invokes fetchFn synchronously (an async body runs up to its first await
    // straight away) while still turning a synchronous throw into a rejection.
    // Promise.resolve().then(fetchFn) would defer the call by a microtask for no reason.
    const run = (async () => fetchFn())().finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, run);

    try {
        const data = await run;
        if (dbSuccessCount() > dbCallsBefore) recordSuccess();
        cache.set(cacheKey, data);
        return res.json(data);
    } catch (error) {
        if (isDatabaseError(error)) recordFailure();
        const stale = cache.getStale(cacheKey);
        if (stale) return res.status(503).json({ ...stale, _stale: true });
        return res.status(503).json({ error: error.message });
    }
}

// ============================================
// CHANGE CALCULATION — used by comparison-style endpoints
// ============================================
export function calculateChange(current, past) {
    if (!past || past === 0) return { change: 0, trend: 'neutral' };
    const change = ((current - past) / past) * 100;
    return {
        change: Math.round(change * 100) / 100,
        trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
    };
}

// Shared helpers used across the src/routes/api/* router modules. Extracted from server.js
// (issue #123) so routers don't depend on server.js itself, and so nothing gets duplicated
// across modules.
import { shouldAllowRequest, recordSuccess, recordFailure } from './db/circuitBreaker.js';
import { dbSuccessCount, isDatabaseError } from './db/dbCallTracker.js';

// ============================================
// RESPONSE CACHE — stale-while-revalidate
// ============================================
/**
 * A bounded cache (issue #291). It used to be a plain Map that never evicted -- on purpose,
 * since stale entries back the 503 fallback -- keyed on raw query strings, so every distinct
 * `limit`/date/search a client sent was kept forever. Now least-recently-used entries are
 * dropped past BOTH `maxEntries` and `maxBytes`, which still leaves the stale copy of every
 * key actually in use. Routes also normalise their keys -- see parseRangeQuery().
 *
 * The byte budget matters as much as the count: one /snapshots/full "All" answer is ~3 MB,
 * so 100 of them would still be ~300 MB (measured on a real server before this budget).
 * Size is estimated from the JSON the route is about to send anyway; an entry larger than
 * the whole budget is simply not cached.
 */
export function createCache(ttlMs, { maxEntries = 100, maxBytes = 32 * 1024 * 1024 } = {}) {
    const store = new Map(); // insertion order doubles as recency order
    let bytes = 0;
    const touch = (key, entry) => {
        store.delete(key);
        store.set(key, entry);
    };
    const remove = (key) => {
        const entry = store.get(key);
        if (!entry) return;
        bytes -= entry.bytes;
        store.delete(key);
    };
    return {
        get(key) {
            const entry = store.get(key);
            if (entry && Date.now() - entry.time < ttlMs) {
                touch(key, entry);
                return entry.data;
            }
            return null;
        },
        getStale(key) {
            const entry = store.get(key);
            return entry ? entry.data : null;
        },
        set(key, data) {
            let size;
            try {
                size = JSON.stringify(data)?.length ?? 0;
            } catch {
                size = 0;
            }
            remove(key);
            if (size > maxBytes) return; // bigger than the whole budget: don't cache it
            store.set(key, { data, time: Date.now(), bytes: size });
            bytes += size;
            while (store.size > maxEntries || bytes > maxBytes) remove(store.keys().next().value);
        },
        get size() {
            return store.size;
        },
        get bytes() {
            return bytes;
        }
    };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `?limit=&start_date=&end_date=` parsed and clamped once, so equivalent requests share one
 * cache key (issue #291): `30`, `030` and `30.0` were three entries. Malformed dates are an
 * error rather than being passed through to the database.
 *
 * @returns {{limit: number, start: string|null, end: string|null, key: string, error?: string}}
 */
export function parseRangeQuery(query, { defaultLimit = 30, maxLimit = 10000 } = {}) {
    const parsed = parseInt(query.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : defaultLimit, 1), maxLimit);
    const start = query.start_date || null;
    const end = query.end_date || null;
    if ((start && !ISO_DATE.test(start)) || (end && !ISO_DATE.test(end))) {
        return { limit, start: null, end: null, key: '', error: 'start_date and end_date must be YYYY-MM-DD' };
    }
    const range = start && end;
    return { limit, start: range ? start : null, end: range ? end : null, key: range ? `${start}:${end}` : `last:${limit}` };
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
        // A deliberate client-facing answer (e.g. 404 "nothing to compare yet") is not an
        // outage: pass its status through, and neither trip the breaker nor serve stale data.
        if (error.httpStatus) return res.status(error.httpStatus).json({ error: error.message });
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

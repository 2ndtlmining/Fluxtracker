// Shared helpers used across the src/routes/api/* router modules. Extracted from server.js
// (issue #123) so routers don't depend on server.js itself, and so nothing gets duplicated
// across modules.
import { shouldAllowRequest, recordSuccess, recordFailure } from './db/circuitBreaker.js';

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

    // 3. Fetch from DB
    try {
        const data = await fetchFn();
        recordSuccess();
        cache.set(cacheKey, data);
        return res.json(data);
    } catch (error) {
        recordFailure();
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

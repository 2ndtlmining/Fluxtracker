// Attribution for the database circuit breaker (issue #219).
//
// withDbFallback used to call recordFailure() -- the DATABASE breaker -- for any error
// thrown inside it, including errors from pure upstream-API work that never touched the
// database. A Flux API outage, polled from a few open tabs, reached the 5-failure
// threshold in one burst: every withDbFallback endpoint 503'd, snapshotManager skipped its
// snapshot checks, and with SUPABASE_FAILOVER_URL set the process silently switched
// instances -- while the primary database was perfectly healthy.
//
// Attribution is decided here, at the one place every database call already passes
// through (database.js re-exports the instrumented adapter), rather than per-route. Two
// reasons that beats splitting the wrapper in two:
//   - /api/games/live does upstream AND database work in one fetchFn. A wrapper split has
//     to mislabel it one way or the other; tagging judges it on what actually failed.
//   - A new route cannot be added to the "wrong" wrapper, because there is only one.
//
// This is a leaf module on purpose: serverHelpers.js and database.js both import it, and
// neither may end up importing the other.

/** Rises on every database call that returns without throwing. */
let successes = 0;

/**
 * A monotonic count of successful database calls.
 *
 * withDbFallback snapshots this before running a route's fetchFn and compares after, which
 * is how it knows whether a 200 response is evidence the database is healthy or just
 * evidence that an upstream API answered.
 */
export function dbSuccessCount() {
    return successes;
}

/** True only for an error raised by a database call. */
export function isDatabaseError(error) {
    return Boolean(error?.isDatabaseError);
}

function tag(error) {
    // A thrown primitive (or a frozen error) has nowhere to carry the flag; treat it as
    // unattributable rather than crashing on the assignment.
    if (error && typeof error === 'object') {
        try {
            error.isDatabaseError = true;
        } catch { /* frozen */ }
    }
    return error;
}

/**
 * Wrap an adapter so every call it exposes reports whether it succeeded or failed.
 *
 * Applied once to the chosen adapter in database.js, so all 73 functions are covered and a
 * function added later is covered automatically. Non-function properties pass through, and
 * both synchronous throws (getDb()) and rejected promises are tagged.
 */
export function instrumentAdapter(adapter) {
    const wrapped = {};

    for (const [name, value] of Object.entries(adapter)) {
        if (typeof value !== 'function') {
            wrapped[name] = value;
            continue;
        }

        wrapped[name] = function (...args) {
            let result;
            try {
                result = value.apply(this, args);
            } catch (error) {
                throw tag(error);
            }

            if (result && typeof result.then === 'function') {
                return result.then(
                    resolved => { successes++; return resolved; },
                    error => { throw tag(error); }
                );
            }

            successes++;
            return result;
        };
    }

    return wrapped;
}

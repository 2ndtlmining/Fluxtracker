/**
 * In-memory sliding-window rate limiter for the KPI endpoint.
 *
 * Two independent limits:
 *   per-client       stops one visitor generating a flood of outbound requests
 *   per-destination  stops a webhook being spammed by many visitors, and stops someone
 *                    entering a third party's webhook repeatedly to harass them
 *
 * In-memory is deliberate: this guards an outbound-send button on a single-process app, and
 * a restart clearing the window is an acceptable trade for not adding a dependency. If the
 * app is ever run multi-process, this needs to move to the database.
 */

export const LIMITS = {
    perClientPerHour: 5,
    perClientPerDay: 20,
    perTargetSeconds: 300   // one send per destination per 5 minutes
};

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;

// key -> array of timestamps
const clientHits = new Map();
const targetHits = new Map();

function recent(list, windowMs, now) {
    return (list || []).filter(t => now - t < windowMs);
}

/** Drop entries that can no longer affect any window, so the maps don't grow forever. */
function prune(map, windowMs, now) {
    for (const [key, times] of map) {
        const kept = recent(times, windowMs, now);
        if (kept.length === 0) map.delete(key);
        else map.set(key, kept);
    }
}

function humanizeSeconds(seconds) {
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Check both limits without recording anything.
 * @returns {{allowed: boolean, reason?: string, retryAfterSeconds?: number}}
 */
export function checkRateLimit(clientKey, targetKey, now = Date.now()) {
    prune(clientHits, DAY_MS, now);
    prune(targetHits, LIMITS.perTargetSeconds * 1000, now);

    const client = clientHits.get(clientKey) || [];
    const lastDay = recent(client, DAY_MS, now);
    const lastHour = recent(client, HOUR_MS, now);

    if (lastHour.length >= LIMITS.perClientPerHour) {
        const retry = Math.ceil((HOUR_MS - (now - Math.min(...lastHour))) / 1000);
        return {
            allowed: false,
            reason: `You've sent ${LIMITS.perClientPerHour} reports in the last hour. Try again in ${humanizeSeconds(retry)}.`,
            retryAfterSeconds: retry
        };
    }

    if (lastDay.length >= LIMITS.perClientPerDay) {
        const retry = Math.ceil((DAY_MS - (now - Math.min(...lastDay))) / 1000);
        return {
            allowed: false,
            reason: `You've reached the daily limit of ${LIMITS.perClientPerDay} reports. Try again in ${humanizeSeconds(retry)}.`,
            retryAfterSeconds: retry
        };
    }

    const target = targetHits.get(targetKey) || [];
    const windowMs = LIMITS.perTargetSeconds * 1000;
    const recentTarget = recent(target, windowMs, now);

    if (recentTarget.length > 0) {
        const retry = Math.ceil((windowMs - (now - Math.max(...recentTarget))) / 1000);
        return {
            allowed: false,
            reason: `A report was just sent to this destination. Try again in ${humanizeSeconds(retry)}.`,
            retryAfterSeconds: retry
        };
    }

    return { allowed: true };
}

/** Record a successful send against both windows. */
export function recordSend(clientKey, targetKey, now = Date.now()) {
    clientHits.set(clientKey, [...(clientHits.get(clientKey) || []), now]);
    targetHits.set(targetKey, [...(targetHits.get(targetKey) || []), now]);
}

/** Test hook. */
export function resetRateLimits() {
    clientHits.clear();
    targetHits.clear();
}

/**
 * Scheduling arithmetic for the KPI report scheduler. Pure and unit-tested —
 * change it here, not inline in the scheduler.
 *
 * All times UTC. The scheduler fires once per UTC day (or ISO week) at a fixed
 * hour; dedupe compares the receipt's timestamp against the current period key,
 * so a restart can never double-send and a missed window catches up on the next
 * tick (the sync_status receipt is restart-persistent).
 */

const MS_PER_DAY = 86400000;

/** "2026-09-05" — UTC day key. */
export function utcDayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * ISO week key "2026-W34". Weeks run Monday-Sunday; the year is the ISO year
 * (2024-12-30 belongs to 2025-W01). The week's Thursday is what pins the ISO year.
 */
export function isoWeekKey(ms) {
    const t = new Date(ms);
    const target = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
    const day = new Date(target).getUTCDay() || 7;   // Sunday -> 7
    const monday = target - (day - 1) * MS_PER_DAY;  // this week's Monday
    const thursday = monday + 3 * MS_PER_DAY;
    const thursdayDate = new Date(thursday);
    const yearStart = Date.UTC(thursdayDate.getUTCFullYear(), 0, 1);
    const week = Math.floor((thursday - yearStart) / MS_PER_DAY / 7) + 1;
    return `${thursdayDate.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The period a timestamp belongs to, for the timeframe's dedupe key. */
export function periodKey(timeframe, ms) {
    return timeframe === 'weekly' ? isoWeekKey(ms) : utcDayKey(ms);
}

/**
 * Whether `timeframe` is due to run right now:
 * - the configured UTC hour must have passed
 * - the receipt (last recorded send attempt) must be from a previous period
 * A null receipt (never sent) is due as soon as the hour has passed.
 *
 * Weekly has no Monday-only gate: the week-key dedupe alone decides, so a report
 * missed on Monday still goes out later in the week (the period is complete).
 */
export function isDue(timeframe, now, hourUtc, lastSyncMs) {
    const nowMs = now instanceof Date ? now.getTime() : now;
    if (new Date(nowMs).getUTCHours() < hourUtc) return false;

    const current = periodKey(timeframe, nowMs);
    const last = lastSyncMs == null ? null : periodKey(timeframe, lastSyncMs);
    return last !== current;
}

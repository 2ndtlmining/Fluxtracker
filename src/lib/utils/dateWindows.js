/**
 * Split an inclusive YYYY-MM-DD range into consecutive windows of at most `windowDays` days
 * (issue #390).
 *
 * The per-day revenue RPCs return one row per day, and PostgREST caps a response at 1000
 * rows. Paging them with .range() re-runs the whole aggregation for every page and throws
 * away the offset afterwards, so a range past 1000 days cost two full scans, then three.
 * Asking for date windows short enough to fit in one page makes each call aggregate only
 * its own days: the same total work as one scan, however long the history gets.
 *
 * The last window keeps the caller's end date exactly, even a far-future sentinel.
 */
const DAY_MS = 86400000;
const toDay = s => Date.parse(`${s}T00:00:00Z`);
const toIso = ms => new Date(ms).toISOString().slice(0, 10);

export function splitDateRange(start, end, windowDays) {
    const s = toDay(start);
    const e = toDay(end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [[start, end]];
    // Never split past today: rows cannot exist beyond it, so a sentinel end date
    // ('9999-12-31') must not turn into thousands of empty windows.
    const lastUseful = Math.min(e, Date.now() + DAY_MS);
    const windows = [];
    let from = s;
    while (from + (windowDays - 1) * DAY_MS < lastUseful) {
        const to = from + (windowDays - 1) * DAY_MS;
        windows.push([toIso(from), toIso(to)]);
        from = to + DAY_MS;
    }
    windows.push([toIso(from), end]);
    return windows;
}

/**
 * KPI period arithmetic.
 *
 * Rule: a KPI report only ever compares two *completed* periods. The in-progress period is
 * never included, because a partial week/month would always look like a collapse against a
 * full one.
 *
 * All dates are UTC `YYYY-MM-DD` strings, matching how the rest of the app stores dates
 * (`revenue_transactions.date`, `daily_snapshots.snapshot_date` are both derived from
 * `toISOString()`).
 */

export const TIMEFRAMES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

const MS_PER_DAY = 86400000;

function toDateStr(ms) {
    return new Date(ms).toISOString().split('T')[0];
}

function utc(year, monthIndex, day) {
    return Date.UTC(year, monthIndex, day);
}

/** Midnight UTC of the day `date` falls on. Accepts a Date or a YYYY-MM-DD string. */
function startOfUtcDay(date) {
    const d = date instanceof Date ? date : new Date(`${date}T00:00:00Z`);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Monday of the ISO week containing `ms`.
 * getUTCDay() is 0=Sunday..6=Saturday, so Sunday must step back 6 days, not 0.
 */
function startOfIsoWeek(ms) {
    const day = new Date(ms).getUTCDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    return ms - daysSinceMonday * MS_PER_DAY;
}

function range(startMs, endMs) {
    return { start: toDateStr(startMs), end: toDateStr(endMs) };
}

/** Inclusive day count, used for coverage checks. */
export function dayCount(start, end) {
    return Math.round((startOfUtcDay(end) - startOfUtcDay(start)) / MS_PER_DAY) + 1;
}

/** Every date in an inclusive range, as YYYY-MM-DD. */
export function enumerateDates(start, end) {
    const out = [];
    for (let ms = startOfUtcDay(start); ms <= startOfUtcDay(end); ms += MS_PER_DAY) {
        out.push(toDateStr(ms));
    }
    return out;
}

/**
 * The most recently completed period and the one immediately before it.
 *
 * @param {'weekly'|'monthly'|'quarterly'|'yearly'} timeframe
 * @param {Date} [now] defaults to the current time
 * @returns {{ timeframe, current: {start,end}, comparison: {start,end}, label }}
 */
export function getPeriodRanges(timeframe, now = new Date()) {
    if (!TIMEFRAMES.includes(timeframe)) {
        throw new Error(`Unknown timeframe: ${timeframe}`);
    }

    const today = startOfUtcDay(now);

    switch (timeframe) {
        case 'daily': {
            // Yesterday — the last completed UTC day — versus the day before it.
            // Today must never appear: its revenue is still accruing, which is the
            // same partial-period trap the other timeframes avoid.
            const currentStart = today - MS_PER_DAY;
            return {
                timeframe,
                current: range(currentStart, currentStart),
                comparison: range(currentStart - MS_PER_DAY, currentStart - MS_PER_DAY),
                label: 'Day'
            };
        }

        case 'weekly': {
            // The in-progress week starts on this Monday; the last completed week is the
            // seven days before it. When today IS Monday, that's simply the previous week.
            const thisMonday = startOfIsoWeek(today);
            const currentStart = thisMonday - 7 * MS_PER_DAY;
            const currentEnd = thisMonday - MS_PER_DAY;
            const comparisonStart = currentStart - 7 * MS_PER_DAY;
            const comparisonEnd = currentStart - MS_PER_DAY;
            return {
                timeframe,
                current: range(currentStart, currentEnd),
                comparison: range(comparisonStart, comparisonEnd),
                label: 'Week'
            };
        }

        case 'monthly': {
            const d = new Date(today);
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth();
            // Day 0 of a month is the last day of the previous one, which also handles
            // leap years and short months without any special casing.
            return {
                timeframe,
                current: range(utc(y, m - 1, 1), utc(y, m, 0)),
                comparison: range(utc(y, m - 2, 1), utc(y, m - 1, 0)),
                label: 'Month'
            };
        }

        case 'quarterly': {
            const d = new Date(today);
            const y = d.getUTCFullYear();
            const currentQuarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
            const lastQuarterStartMonth = currentQuarterStartMonth - 3;
            return {
                timeframe,
                current: range(
                    utc(y, lastQuarterStartMonth, 1),
                    utc(y, lastQuarterStartMonth + 3, 0)
                ),
                comparison: range(
                    utc(y, lastQuarterStartMonth - 3, 1),
                    utc(y, lastQuarterStartMonth, 0)
                ),
                label: 'Quarter'
            };
        }

        case 'yearly': {
            const y = new Date(today).getUTCFullYear();
            return {
                timeframe,
                current: range(utc(y - 1, 0, 1), utc(y - 1, 11, 31)),
                comparison: range(utc(y - 2, 0, 1), utc(y - 2, 11, 31)),
                label: 'Year'
            };
        }
    }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 9-15, 2026" / "Jul 2026" / "Q2 2026" / "2025" — for report headings. */
export function formatPeriod(timeframe, { start, end }) {
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);

    switch (timeframe) {
        case 'daily':
            return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}, ${s.getUTCFullYear()}`;
        case 'weekly': {
            const sameMonth = s.getUTCMonth() === e.getUTCMonth();
            const left = `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}`;
            const right = sameMonth
                ? `${e.getUTCDate()}`
                : `${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`;
            return `${left}-${right}, ${e.getUTCFullYear()}`;
        }
        case 'monthly':
            return `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
        case 'quarterly':
            return `Q${Math.floor(s.getUTCMonth() / 3) + 1} ${s.getUTCFullYear()}`;
        case 'yearly':
            return `${s.getUTCFullYear()}`;
        default:
            return `${start} to ${end}`;
    }
}

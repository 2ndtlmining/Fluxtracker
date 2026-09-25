// Run-rate (issue #263). Pure.
//
// Revenue arrives in lumps: an app paying for a year pays it all on one day. Spreading each
// payment's USD evenly over the days it bought gives the underlying rate -- what the network
// earns per day from everything currently paid for -- and what has been paid but not yet
// consumed (deferred revenue). The database computes both per day (migration 021 /
// getDailyRunRateInRange); this file holds the unit conversions and a plain reference
// implementation the tests check the SQL against.

export const BLOCKS_PER_DAY = 2880;
export const DAYS_PER_MONTH = 365.25 / 12;

/** A daily rate as an average month (MRR). */
export function monthlyRunRate(dailyRateUsd) {
  return (Number(dailyRateUsd) || 0) * DAYS_PER_MONTH;
}

/** Rows from getDailyRunRateInRange as the chart and card use them: MRR and deferred, in $. */
export function shapeRunRateRows(rows) {
  return (rows ?? []).filter(row => row?.date).map(row => ({
    date: String(row.date).slice(0, 10),
    mrr_usd: monthlyRunRate(row.daily_rate_usd),
    deferred_usd: Number(row.deferred_usd) || 0
  }));
}

const DAY_MS = 86_400_000;
const dayNumber = date => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/**
 * Reference implementation: loop over every day and every payment. A payment starting on
 * day s for len days is active on day d while (d - s) < len, contributing usd / len per
 * day, with usd / len * (s + len - d) still unconsumed at the start of day d.
 *
 * @param {{date: string, usd: number|null, expire: number|null}[]} payments
 */
export function bruteForceRunRate(payments, start, end) {
  const usable = payments.filter(p => p.expire > 0 && p.usd > 0 && p.date <= end)
    .map(p => ({ s: dayNumber(p.date), len: p.expire / BLOCKS_PER_DAY, usd: p.usd }));
  const out = [];
  for (let d = dayNumber(start); d <= dayNumber(end); d++) {
    let rate = 0;
    let deferred = 0;
    for (const p of usable) {
      if (d >= p.s && d - p.s < p.len) {
        rate += p.usd / p.len;
        deferred += (p.usd / p.len) * (p.s + p.len - d);
      }
    }
    out.push({ date: new Date(d * DAY_MS).toISOString().slice(0, 10), daily_rate_usd: rate, deferred_usd: deferred });
  }
  return out;
}

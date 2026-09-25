// Revenue analytics that need nothing new collected (issues #261, #266). Pure: rows in,
// numbers out, so the maths is unit-tested apart from the database.

/**
 * #261 -- daily revenue split by who paid: the Flux team (FLUX_TEAM_ADDRESSES), the fiat
 * on-ramp (FLUX_FIAT_ADDRESSES), and everyone else ("organic" -- real on-chain customers).
 * Organic is the remainder, so the three always add up to the day's total, and a day with
 * no team or fiat payments still appears (the address endpoints only return days that had
 * some). Negative remainders -- rounding between two separately summed queries -- clamp to 0.
 *
 * @param {{date: string, daily_revenue?: number, daily_revenue_usd?: number}[]} rows each of
 *   total (FLUX), totalUsd, team, teamUsd, fiat, fiatUsd, as the history endpoints return them
 */
export function mergeRevenueSources({ total = [], totalUsd = [], team = [], teamUsd = [], fiat = [], fiatUsd = [] }) {
  const byDate = new Map();
  const add = (rows, key, field) => {
    for (const row of rows) {
      if (!row?.date) continue;
      const day = byDate.get(row.date) ?? { date: row.date, total_flux: 0, total_usd: 0, team_flux: 0, team_usd: 0, fiat_flux: 0, fiat_usd: 0 };
      day[key] += Number(row[field]) || 0;
      byDate.set(row.date, day);
    }
  };
  add(total, 'total_flux', 'daily_revenue');
  add(totalUsd, 'total_usd', 'daily_revenue_usd');
  add(team, 'team_flux', 'daily_revenue');
  add(teamUsd, 'team_usd', 'daily_revenue_usd');
  add(fiat, 'fiat_flux', 'daily_revenue');
  add(fiatUsd, 'fiat_usd', 'daily_revenue_usd');

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(day => ({
      ...day,
      organic_flux: Math.max(0, day.total_flux - day.team_flux - day.fiat_flux),
      organic_usd: Math.max(0, day.total_usd - day.team_usd - day.fiat_usd)
    }));
}

/**
 * #266 -- is FLUX revenue growth real demand, or the token price? App pricing is effectively
 * pegged to USD, so FLUX revenue rises whenever the price falls. Split the FLUX change into:
 *   - usdChange: the change in what was actually paid, in USD at the time of payment (demand)
 *   - priceChange: the change in the average USD price paid per FLUX (price)
 * Since FLUX = USD / price, (1 + fluxChange) = (1 + usdChange) / (1 + priceChange).
 * Null when either period has nothing to compare against.
 */
export function computeDemandSplit({ fluxCurrent, fluxPrevious, usdCurrent, usdPrevious }) {
  const valid = [fluxCurrent, fluxPrevious, usdCurrent, usdPrevious].every(v => Number.isFinite(v) && v > 0);
  if (!valid) return null;
  const usdChange = ((usdCurrent - usdPrevious) / usdPrevious) * 100;
  const priceNow = usdCurrent / fluxCurrent;
  const priceThen = usdPrevious / fluxPrevious;
  const priceChange = ((priceNow - priceThen) / priceThen) * 100;
  return {
    usdCurrent,
    usdPrevious,
    usdChange: Math.round(usdChange * 10) / 10,
    priceChange: Math.round(priceChange * 10) / 10
  };
}

/** Sum a daily USD series (as getDailyRevenueUSDInRange returns it). */
export function sumUsd(rows) {
  return (rows ?? []).reduce((sum, row) => sum + (Number(row?.daily_revenue_usd) || 0), 0);
}

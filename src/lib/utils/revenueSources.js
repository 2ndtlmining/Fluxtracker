// Revenue analytics that need nothing new collected (issues #261, #262, #267). Pure: rows in,
// numbers out, so the maths is unit-tested apart from the database.

/**
 * #261 / #373 -- daily revenue split two independent ways:
 *   - WHO paid: the Flux team (FLUX_TEAM_ADDRESSES) or everyone else ("organic" customers).
 *     organic + team = total.
 *   - HOW they paid: by card through the fiat on-ramp (FLUX_FIAT_ADDRESSES, which buys FLUX
 *     for its customers and pays on their behalf) or in FLUX directly. fiat + crypto = total.
 * Fiat is a payment METHOD, not a payer (#373): card payments are organic customers too. It
 * used to be subtracted from organic as if it were a third payer, so organic read ~35% when
 * customers were ~97% of revenue.
 * A day with no team or fiat payments still appears (the address endpoints only return days
 * that had some). Negative remainders -- rounding between separately summed queries --
 * clamp to 0.
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
      organic_flux: Math.max(0, day.total_flux - day.team_flux),
      organic_usd: Math.max(0, day.total_usd - day.team_usd),
      crypto_flux: Math.max(0, day.total_flux - day.fiat_flux),
      crypto_usd: Math.max(0, day.total_usd - day.fiat_usd)
    }));
}

/**
 * #267 -- a Postgres function that does not exist yet (migration 018 not applied) must not
 * read as a failed dashboard: the payer endpoints answer "not available, apply this file"
 * instead, the way the transaction endpoint names a missing migration (#171).
 */
export function isMissingFunctionError(error, fnName) {
  const message = String(error?.message ?? error ?? '');
  return message.includes(fnName) && /could not find the function|does not exist|PGRST202/i.test(message);
}

/** #267 -- monthly payer rows with the returning count derived, never negative. */
export function shapePayerRows(rows) {
  return (rows ?? []).map(row => ({
    month: String(row.month).slice(0, 10),
    payers: Number(row.payers) || 0,
    new_payers: Number(row.new_payers) || 0,
    returning_payers: Math.max(0, (Number(row.payers) || 0) - (Number(row.new_payers) || 0))
  }));
}

/**
 * #262 -- daily revenue mix rows as the chart needs them: new apps (registrations) vs
 * renewals and updates, enterprise, and the days bought per payment as a sum and a count
 * (so a week or month averages over payments, not over daily averages). Numbers only --
 * Postgres can return bigint/numeric as strings. A payment with no message metadata counts
 * in total_flux only, so the shares never claim more than the data knows.
 */
export function shapeMixRows(rows) {
  const num = v => Number(v) || 0;
  return (rows ?? []).filter(row => row?.date).map(row => ({
    date: String(row.date).slice(0, 10),
    total_flux: num(row.total_flux),
    new_flux: num(row.new_flux),
    new_usd: num(row.new_usd),
    update_flux: num(row.update_flux),
    update_usd: num(row.update_usd),
    enterprise_flux: num(row.enterprise_flux),
    enterprise_usd: num(row.enterprise_usd),
    commitment_days_sum: num(row.commitment_days_sum),
    commitment_payments: num(row.commitment_payments)
  }));
}

/**
 * #262 -- one day's revenue-mix chart fields. The ratio numerators/denominators ride along
 * so weekly/monthly views divide sums instead of averaging daily ratios. A day with no mix
 * row (no metadata) contributes zeros, never a fake share.
 */
export function mixFields(mix, totalFlux) {
  const m = mix ?? {};
  const share = part => (totalFlux > 0 ? ((part || 0) / totalFlux) * 100 : 0);
  return {
    new_flux: m.new_flux || 0,
    new_usd: m.new_usd || 0,
    update_flux: m.update_flux || 0,
    update_usd: m.update_usd || 0,
    enterprise_flux: m.enterprise_flux || 0,
    enterprise_usd: m.enterprise_usd || 0,
    commitment_days_sum: m.commitment_days_sum || 0,
    commitment_payments: m.commitment_payments || 0,
    mix_new_percent: share(m.new_flux),
    mix_update_percent: share(m.update_flux),
    mix_enterprise_percent: share(m.enterprise_flux),
    mix_commitment_days: m.commitment_payments > 0 ? m.commitment_days_sum / m.commitment_payments : 0
  };
}

/** #267 -- the concentration row as shares of the total. */
export function shapeConcentration(row) {
  const total = Number(row?.total_revenue) || 0;
  const apps = Number(row?.app_count) || 0;
  return {
    totalRevenue: total,
    appCount: apps,
    top10Share: total > 0 ? Math.round((1000 * (Number(row.top10_revenue) || 0)) / total) / 10 : 0,
    appsFor80Pct: Number(row?.apps_for_80pct) || 0
  };
}

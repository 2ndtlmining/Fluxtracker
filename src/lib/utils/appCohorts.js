// App retention cohorts (issue #264). Pure.
//
// Rows from getAppCohorts (migration 022): one per registration month, with counts. This
// turns them into chart rows. A share whose denominator is 0 -- a cohort too young to have
// reached 90 days, say -- is null, never 0%, so the chart leaves a gap instead of drawing a
// cohort that looks like it died.

const WINDOWS = [30, 90, 180];

const share = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);

export function shapeCohortRows(rows) {
  return (rows ?? []).filter(row => row?.month).map(row => {
    const n = key => Number(row[key]) || 0;
    const out = {
      date: String(row.month).slice(0, 10),
      new_apps: n('new_apps'),
      paid_again: n('paid_again'),
      still_active: n('still_active'),
      paid_again_percent: share(n('paid_again'), n('new_apps')),
      still_active_percent: share(n('still_active'), n('new_apps'))
    };
    for (const days of WINDOWS) {
      out[`eligible_${days}`] = n(`eligible_${days}`);
      out[`survived_${days}`] = n(`survived_${days}`);
      out[`survival_${days}_percent`] = share(n(`survived_${days}`), n(`eligible_${days}`));
    }
    return out;
  });
}

import { describe, it, expect } from 'vitest';
import { mergeRevenueSources } from './revenueSources.js';

describe('mergeRevenueSources (#261)', () => {
  const rows = mergeRevenueSources({
    total: [{ date: '2026-09-01', daily_revenue: 1000 }, { date: '2026-09-02', daily_revenue: 500 }],
    totalUsd: [{ date: '2026-09-01', daily_revenue_usd: 50 }, { date: '2026-09-02', daily_revenue_usd: 25 }],
    team: [{ date: '2026-09-01', daily_revenue: 600 }],
    teamUsd: [{ date: '2026-09-01', daily_revenue_usd: 30 }],
    fiat: [{ date: '2026-09-02', daily_revenue: 200 }],
    fiatUsd: [{ date: '2026-09-02', daily_revenue_usd: 10 }]
  });

  it('organic is the remainder, so the three sources always add up to the total', () => {
    expect(rows[0]).toMatchObject({ date: '2026-09-01', team_flux: 600, fiat_flux: 0, organic_flux: 400, organic_usd: 20 });
    expect(rows[1]).toMatchObject({ date: '2026-09-02', team_flux: 0, fiat_flux: 200, organic_flux: 300, organic_usd: 15 });
    for (const r of rows) expect(r.team_flux + r.fiat_flux + r.organic_flux).toBe(r.total_flux);
  });

  it('keeps days with no team or fiat payments, in date order', () => {
    expect(rows.map(r => r.date)).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('never reports a negative organic share when the separate sums disagree by rounding', () => {
    const [day] = mergeRevenueSources({
      total: [{ date: '2026-09-03', daily_revenue: 100 }],
      team: [{ date: '2026-09-03', daily_revenue: 100.0000001 }]
    });
    expect(day.organic_flux).toBe(0);
  });
});

describe('payer base helpers (#267)', async () => {
  const { shapePayerRows, shapeConcentration, isMissingFunctionError } = await import('./revenueSources.js');

  it('derives returning payers and never goes negative', () => {
    expect(shapePayerRows([{ month: '2026-07-01T00:00:00Z', payers: '3', new_payers: 1 }]))
      .toEqual([{ month: '2026-07-01', payers: 3, new_payers: 1, returning_payers: 2 }]);
    expect(shapePayerRows([{ month: '2026-07-01', payers: 1, new_payers: 5 }])[0].returning_payers).toBe(0);
  });

  it('turns the concentration row into shares, and survives an empty table', () => {
    expect(shapeConcentration({ total_revenue: 1000, app_count: 40, top10_revenue: 212, apps_for_80pct: 9 }))
      .toEqual({ totalRevenue: 1000, appCount: 40, top10Share: 21.2, appsFor80Pct: 9 });
    expect(shapeConcentration({}).top10Share).toBe(0);
  });

  it('recognises a function that migration 018 has not created yet', () => {
    expect(isMissingFunctionError(new Error('Could not find the function public.get_monthly_payer_stats(p_end, p_exclude, p_start) in the schema cache'), 'get_monthly_payer_stats')).toBe(true);
    expect(isMissingFunctionError(new Error('function get_app_revenue_concentration() does not exist'), 'get_app_revenue_concentration')).toBe(true);
    expect(isMissingFunctionError(new Error('connection refused'), 'get_monthly_payer_stats')).toBe(false);
  });
});

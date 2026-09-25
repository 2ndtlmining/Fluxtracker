import { describe, it, expect } from 'vitest';
import { mergeRevenueSources, computeDemandSplit, sumUsd } from './revenueSources.js';

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

describe('computeDemandSplit (#266)', () => {
  it('separates the USD (demand) change from the price change', () => {
    // FLUX revenue up 8x while USD went $5.7k -> $9.3k: most of the FLUX growth was price.
    const split = computeDemandSplit({ fluxCurrent: 221_000, fluxPrevious: 28_000, usdCurrent: 9_300, usdPrevious: 5_700 });
    expect(split.usdChange).toBeCloseTo(63.2, 1);
    expect(split.priceChange).toBeCloseTo(-79.3, 1);
    // (1 + flux) = (1 + usd) / (1 + price)
    expect((1 + split.usdChange / 100) / (1 + split.priceChange / 100)).toBeCloseTo(221_000 / 28_000, 1);
  });

  it('is null with nothing to compare against, never a fake 0%', () => {
    expect(computeDemandSplit({ fluxCurrent: 10, fluxPrevious: 0, usdCurrent: 1, usdPrevious: 0 })).toBeNull();
    expect(computeDemandSplit({ fluxCurrent: 10, fluxPrevious: 5, usdCurrent: 1 })).toBeNull();
  });

  it('sumUsd adds a daily series', () => {
    expect(sumUsd([{ daily_revenue_usd: 1.5 }, { daily_revenue_usd: 2 }, {}])).toBe(3.5);
    expect(sumUsd(null)).toBe(0);
  });
});

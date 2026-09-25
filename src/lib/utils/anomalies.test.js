import { describe, it, expect } from 'vitest';
import { revenueSpike, largestPayment, hoursSinceLastPayment, buildSpikePayload, buildOutagePayload } from './anomalies.js';

/** 28 ordinary days before 2026-09-29 around $300, plus the day itself. */
function history(targetUsd, { gaps = 0 } = {}) {
  const rows = [];
  for (let i = 1; i <= 28; i++) {
    if (i <= gaps) continue;
    const day = new Date(Date.parse('2026-09-29T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10);
    rows.push({ date: day, daily_revenue_usd: 300 + (i % 5) * 20 });   // 300..380
  }
  rows.push({ date: '2026-09-29', daily_revenue_usd: targetUsd });
  return rows;
}

describe('revenueSpike (#269)', () => {
  it('flags a day far above the previous 28 days', () => {
    const spike = revenueSpike(history(3200), '2026-09-29');
    expect(spike).not.toBeNull();
    expect(spike.usd).toBe(3200);
    expect(spike.typicalUsd).toBeCloseTo(340, 0);
    expect(spike.multiple).toBeCloseTo(9.4, 1);
    expect(spike.z).toBeGreaterThan(3);
  });

  it('ignores an ordinary day, and low days (only spikes alert)', () => {
    expect(revenueSpike(history(390), '2026-09-29')).toBeNull();
    expect(revenueSpike(history(10), '2026-09-29')).toBeNull();
  });

  it('says nothing with too little history or no row for the day', () => {
    expect(revenueSpike(history(3200, { gaps: 20 }), '2026-09-29')).toBeNull();
    expect(revenueSpike(history(3200), '2026-09-30')).toBeNull();
  });
});

describe('largestPayment', () => {
  const opts = { isTeam: a => a === 'team', isFiat: a => a === 'fiat' };

  it('names the biggest payment and who or how it was paid', () => {
    const txs = [
      { app_name: 'small', amount_usd: 5, amount: 70, from_address: 'x' },
      { app_name: 'palworld1790087212677', amount_usd: 2100, amount: 30000, from_address: 'fiat' }
    ];
    expect(largestPayment(txs, opts)).toEqual({ appName: 'palworld1790087212677', usd: 2100, flux: 30000, paidBy: 'card (fiat on-ramp)' });
    expect(largestPayment([{ amount_usd: 1, from_address: 'team' }], opts).paidBy).toBe('Flux team');
    expect(largestPayment([{ app_name: 'a', amount_usd: 1, from_address: 'wallet' }], opts).paidBy).toBe('FLUX');
    expect(largestPayment([], opts)).toBeNull();
  });
});

describe('hoursSinceLastPayment', () => {
  it('uses the transaction timestamp in seconds', () => {
    expect(hoursSinceLastPayment(1_790_000_000, 1_790_000_000_000 + 7 * 3_600_000)).toBe(7);
    expect(hoursSinceLastPayment(null, Date.now())).toBeNull();
  });
});

describe('payloads', () => {
  it('reads in plain words, with no statistics jargon', () => {
    const text = JSON.stringify(buildSpikePayload('2026-09-29', { usd: 3200, typicalUsd: 340, multiple: 9.4, z: 12 }, { appName: 'kagura', usd: 2100, paidBy: 'FLUX' }));
    expect(text).toContain('Unusual revenue day: 2026-09-29');
    expect(text).toContain('9.4x');
    expect(text).toContain('kagura: $2,100, paid by FLUX');
    expect(text).not.toMatch(/sigma|σ|z-score/i);
    expect(JSON.stringify(buildOutagePayload(7.4, 1_790_000_000))).toContain('No payment has synced for 7 hours');
  });
});

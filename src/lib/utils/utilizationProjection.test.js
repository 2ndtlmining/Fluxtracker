import { describe, it, expect } from 'vitest';
import { computeUtilizationProjection, BLOCKS_PER_DAY } from './utilizationProjection.js';

const HEIGHT = 3_000_000;
const NOW = Date.UTC(2026, 8, 25);
const day = n => n * BLOCKS_PER_DAY;

// Registered at HEIGHT - 10 so "blocks left" is expire - 10.
const spec = (name, expireDays, instances, { cpu = 2, enterprise = false, compose = null } = {}) => ({
  name,
  height: HEIGHT - 10,
  expire: day(expireDays) + 10,
  instances,
  enterprise,
  ...(compose ? { compose } : { cpu })
});

const SPECS = [
  spec('week', 7, 3),                                  // expires at the end of day 7
  spec('month', 30, 2, { cpu: 4 }),
  spec('year', 365, 1, { cpu: 8 }),
  spec('game', 7, 2, { enterprise: true, cpu: 0 }),    // encrypted: instances only
  spec('compose', 30, 2, { compose: [{ cpu: 1 }, { cpu: 0.5 }] }),
  { name: 'legacy', height: HEIGHT - 5, instances: 5 }, // no expire
  { name: 'stale', height: HEIGHT - day(40), expire: day(30), instances: 9, cpu: 9 } // already past
];

describe('computeUtilizationProjection (#347)', () => {
  const p = computeUtilizationProjection(SPECS, HEIGHT, { horizonDays: 90, nowMs: NOW });

  it('today counts every unexpired app, and CPU only where it is readable', () => {
    expect(p.today).toEqual({ apps: 5, instances: 3 + 2 + 1 + 2 + 2, cpu: 3 * 2 + 2 * 4 + 8 + 2 * 1.5 });
    expect(p.points[0].date).toBe('2026-09-25');
  });

  it('drops apps on the day they expire, if nothing renews', () => {
    expect(p.points[6].instances).toBe(10);           // the week apps still run on day 6
    expect(p.points[7].instances).toBe(5);            // gone on day 7: 3 + 2 (encrypted game)
    expect(p.points[7].cpu).toBe(25 - 6);             // the game had no readable CPU to lose
    expect(p.points[30].instances).toBe(1);           // only the yearly app is left
    expect(p.drops.d30).toEqual({ instances: 9, cpu: 25 - 8 });
  });

  it('never rises, and stops at the horizon', () => {
    for (let i = 1; i < p.points.length; i++) {
      expect(p.points[i].instances).toBeLessThanOrEqual(p.points[i - 1].instances);
      expect(p.points[i].cpu).toBeLessThanOrEqual(p.points[i - 1].cpu);
    }
    expect(p.points).toHaveLength(91);
  });

  it('reports its own coverage instead of implying completeness', () => {
    expect(p.coverage).toEqual({ cpuReadableApps: 4, cpuUnreadableApps: 1, unknownExpiry: 1 });
  });

  it('names the week that loses the most', () => {
    expect(p.biggestDrop).toMatchObject({ from: '2026-09-25', to: '2026-10-02', instances: 5 });
  });

  it('returns null rather than a zero projection when it cannot compute', () => {
    expect(computeUtilizationProjection(null, HEIGHT)).toBeNull();
    expect(computeUtilizationProjection(SPECS, 0)).toBeNull();
  });
});

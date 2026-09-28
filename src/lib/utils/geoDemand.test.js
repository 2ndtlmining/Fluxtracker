import { describe, it, expect } from 'vitest';
import { cpuDemandVsSupply, isUnderSupplied } from './geoDemand.js';

// Issue #463: demand vs supply in CPU cores, not app and node counts.

describe('cpuDemandVsSupply', () => {
  const cpu = {
    EU: { cores: 750, locked: 150 },   // 75% of capacity, 50% of demand, 20% in use
    NA: { cores: 200, locked: 120 },   // 20% of capacity, 40% of demand, 60% in use
    AS: { cores: 50, locked: 30 }
  };

  it('compares each continent\'s share of capacity with its share of demand', () => {
    const { continents } = cpuDemandVsSupply(cpu);
    const na = continents.find(c => c.code === 'NA');
    expect(na).toMatchObject({ capacityPercent: 20, demandPercent: 40, inUsePercent: 60, cores: 200, lockedCores: 120 });
    expect(continents.find(c => c.code === 'EU')).toMatchObject({ capacityPercent: 75, demandPercent: 50, inUsePercent: 20 });
  });

  it('weighs a heavy app on a big node more than a small one (the point of #463)', () => {
    // Same node count per continent, very different load: counts would call these equal.
    const { continents } = cpuDemandVsSupply({ EU: { cores: 100, locked: 5 }, NA: { cores: 100, locked: 45 } });
    expect(continents.map(c => c.demandPercent)).toEqual([10, 90]);
  });

  it('reports the network-wide share in use', () => {
    expect(cpuDemandVsSupply(cpu).networkInUsePercent).toBe(30);
  });

  it('leaves out continents with neither capacity nor demand, in a fixed order', () => {
    expect(cpuDemandVsSupply(cpu).continents.map(c => c.code)).toEqual(['EU', 'NA', 'AS']);
  });

  it('is empty, with no network figure, for no data', () => {
    expect(cpuDemandVsSupply({})).toEqual({ continents: [], networkInUsePercent: null });
    expect(cpuDemandVsSupply(undefined).continents).toEqual([]);
  });
});

describe('isUnderSupplied', () => {
  it('flags demand at least 1.5x its capacity share, and at least 1% of demand', () => {
    expect(isUnderSupplied({ demandPercent: 34.8, capacityPercent: 21.2 })).toBe(true);
    expect(isUnderSupplied({ demandPercent: 59.7, capacityPercent: 74.5 })).toBe(false);
    expect(isUnderSupplied({ demandPercent: 0.7, capacityPercent: 0.3 })).toBe(false);
  });
});

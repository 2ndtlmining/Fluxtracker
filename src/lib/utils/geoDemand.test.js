import { describe, it, expect } from 'vitest';
import { allowedContinents, continentDemand, demandVsSupply } from './geoDemand.js';

const H = 1_000_000;
const spec = (geolocation, instances = 3, extra = {}) => ({ height: H - 10, expire: 1000, geolocation, instances, ...extra });

describe('allowedContinents', () => {
  it('reads continent and country/region allow entries, ignoring exclusions', () => {
    expect(allowedContinents(['acEU', 'acNA_US_Texas', 'acNA', 'a!cAS'])).toEqual(['EU', 'NA']);
    expect(allowedContinents(['a!cAS'])).toEqual([]);
    expect(allowedContinents(undefined)).toEqual([]);
  });
});

describe('continentDemand', () => {
  it('splits each app\'s instances across the continents it allows', () => {
    const d = continentDemand([spec(['acEU', 'acNA'], 4), spec(['acAS_JP'], 3)], H);
    expect(d.instances).toEqual({ EU: 2, NA: 2, AS: 3 });
    expect(d.restrictedApps).toBe(2);
  });

  it('leaves out unrestricted, exclude-only and expired apps -- and counts what it left out', () => {
    const d = continentDemand([
      spec([]),                                      // runs anywhere
      spec(['a!cAS']),                               // exclude-only
      spec(['acEU'], 3, { height: H - 2000 }),       // expired
      spec(['acEU'], 5)
    ], H);
    expect(d).toEqual({ instances: { EU: 5 }, restrictedApps: 1, excludeOnlyApps: 1, runningApps: 3 });
  });
});

describe('demandVsSupply', () => {
  it('puts each continent\'s demand share beside its node share', () => {
    const rows = demandVsSupply({ EU: 5, AS: 5 }, { EU: 90, NA: 10 });
    expect(rows).toEqual([
      { code: 'EU', name: 'Europe', demandPercent: 50, nodePercent: 90, nodes: 90 },
      { code: 'NA', name: 'North America', demandPercent: 0, nodePercent: 10, nodes: 10 },
      { code: 'AS', name: 'Asia', demandPercent: 50, nodePercent: 0, nodes: 0 }
    ]);
  });

  it('is empty with no data rather than dividing by zero', () => {
    expect(demandVsSupply({}, {})).toEqual([]);
  });
});

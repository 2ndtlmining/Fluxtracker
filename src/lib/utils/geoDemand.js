// Geolocation demand vs supply (issues #268, #463). Pure.
//
// Measured in CPU cores, per continent. Supply is the cores the continent's nodes benchmark;
// demand is the cores apps have locked on them. Both come from each node's own report, so
// every running app counts -- encrypted or not, region-locked or not.
//
// This replaced a count-based view (#268) that compared region-locked app INSTANCES with
// NODES: one small app on a big node weighed the same as a heavy one, and apps that did not
// restrict their region were invisible (#463, owner, 2026-09-28).

import { CPU_CONTINENTS } from '../config.js';

const pct = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : null);

/**
 * One row per continent with any capacity or demand:
 *   capacityPercent  share of the network's CPU cores that are on this continent
 *   demandPercent    share of the network's locked CPU that is on this continent
 *   inUsePercent     how much of this continent's own CPU is locked (null with no cores)
 * plus the network-wide share in use.
 *
 * @param {Record<string, {cores: number, locked: number}>} cpu per continent code
 */
export function cpuDemandVsSupply(cpu) {
  const totals = Object.values(cpu ?? {}).reduce(
    (t, c) => ({ cores: t.cores + (c.cores || 0), locked: t.locked + (c.locked || 0) }),
    { cores: 0, locked: 0 }
  );
  const continents = CPU_CONTINENTS
    .map(({ code, name }) => {
      const c = cpu?.[code] ?? { cores: 0, locked: 0 };
      return {
        code,
        name,
        cores: Math.round(c.cores || 0),
        lockedCores: Math.round(c.locked || 0),
        capacityPercent: pct(c.cores || 0, totals.cores) ?? 0,
        demandPercent: pct(c.locked || 0, totals.locked) ?? 0,
        inUsePercent: pct(c.locked || 0, c.cores || 0)
      };
    })
    .filter(row => row.cores > 0 || row.lockedCores > 0);
  return { continents, networkInUsePercent: pct(totals.locked, totals.cores) };
}

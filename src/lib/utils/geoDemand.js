// Geographic demand vs supply (issue #268). Pure.
//
// Demand: where customers allow their apps to run. A spec's `geolocation` list carries
// allow entries -- `acEU` (a continent), `acNA_US_Texas` (a country or region inside one) --
// and exclusions (`a!cAS`). Only ALLOW lists say where an app wants to be: a spec that only
// excludes somewhere can run almost anywhere, so it is not demand for a particular place and
// is left out (and counted, so the card can say so). Each app's instances are split evenly
// across the continents it allows.
//
// Supply: nodes per continent, from the node list's own geolocation (one entry per node, so
// these are node counts, not IP counts).

export const CONTINENTS = [
  { code: 'EU', name: 'Europe' },
  { code: 'NA', name: 'North America' },
  { code: 'AS', name: 'Asia' },
  { code: 'OC', name: 'Oceania' },
  { code: 'SA', name: 'South America' },
  { code: 'AF', name: 'Africa' }
];

/** Continent codes a spec's geolocation list allows, e.g. ['EU', 'NA']; [] = no allow list. */
export function allowedContinents(geolocation) {
  const codes = new Set();
  for (const entry of geolocation ?? []) {
    const m = /^ac([A-Z]{2})/.exec(String(entry));
    if (m) codes.add(m[1]);
  }
  return [...codes];
}

/**
 * Instances wanted per continent across running, region-locked apps.
 * @returns {{instances: Record<string, number>, restrictedApps: number, excludeOnlyApps: number, runningApps: number}}
 */
export function continentDemand(specs, currentHeight) {
  const instances = {};
  let restrictedApps = 0;
  let excludeOnlyApps = 0;
  let runningApps = 0;
  for (const spec of specs ?? []) {
    const height = Number(spec?.height);
    const expire = Number(spec?.expire);
    if (!Number.isFinite(height) || !Number.isFinite(expire) || height + expire <= currentHeight) continue;
    runningApps++;
    const allowed = allowedContinents(spec.geolocation);
    if (allowed.length === 0) {
      if ((spec.geolocation ?? []).length > 0) excludeOnlyApps++;
      continue;
    }
    restrictedApps++;
    const count = Number(spec.instances) > 0 ? Number(spec.instances) : 1;
    for (const code of allowed) instances[code] = (instances[code] ?? 0) + count / allowed.length;
  }
  return { instances, restrictedApps, excludeOnlyApps, runningApps };
}

/**
 * One row per continent: share of region-locked demand beside share of nodes, as
 * percentages of the located total. Continents with neither are left out.
 */
export function demandVsSupply(demandInstances, nodeCounts) {
  const demandTotal = Object.values(demandInstances ?? {}).reduce((a, b) => a + b, 0);
  const nodeTotal = Object.values(nodeCounts ?? {}).reduce((a, b) => a + b, 0);
  const pct = (part, whole) => (whole > 0 ? Math.round((1000 * part) / whole) / 10 : 0);
  return CONTINENTS
    .map(({ code, name }) => ({
      code,
      name,
      demandPercent: pct(demandInstances?.[code] ?? 0, demandTotal),
      nodePercent: pct(nodeCounts?.[code] ?? 0, nodeTotal),
      nodes: nodeCounts?.[code] ?? 0
    }))
    .filter(row => row.demandPercent > 0 || row.nodePercent > 0);
}

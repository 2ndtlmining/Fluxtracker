// How busy CPU is, in words (issues #445, #463). One rule for every surface: the Cloud
// Resources badge (the whole network) and the Geolocation Demand card (each continent).
// Names and thresholds are the owner's decision on #445 (2026-09-27).

export const DEMAND_LEVELS = [
  { key: 'low', label: 'Low demand', short: 'Low', icon: '⚪', below: 25 },
  { key: 'moderate', label: 'Moderate demand', short: 'Moderate', icon: '🟡', below: 50 },
  { key: 'high', label: 'High demand', short: 'High', icon: '🟠', below: 75 },
  { key: 'very-high', label: 'Very high demand', short: 'Very high', icon: '🔴', below: Infinity }
];

/** The level for a CPU-in-use percentage, or null when there is no reading. */
export function demandLevel(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(Number(percent))) return null;
  return DEMAND_LEVELS.find(level => Number(percent) < level.below);
}

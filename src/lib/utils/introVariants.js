// Per-app art variants (issue #281). Dragonwilds alone is ~60% of deployments, so the header
// kept playing the same dragon. A game can now carry several intros, and each app gets one
// picked by a hash of its name: the same app always plays the same art (so the smoke harness
// can pin a fixture to a variant), and different apps spread across all of them.

/** djb2 over the app name -- small, stable, and good enough to spread timestamped names. */
function hashName(name) {
  let hash = 5381;
  for (const char of String(name ?? '')) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash;
}

/** The variant for this app: deterministic per name, one of `variants`. */
export function pickVariant(name, variants) {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  return variants[hashName(name) % variants.length];
}

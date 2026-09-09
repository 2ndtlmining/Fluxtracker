// Small pure utility backing BusiestNodeCard's resource utilization bars.
// The bars themselves are plain CSS (a filled div sized to this percentage) rather
// than unicode block characters -- a monospace font renders the filled glyph (full
// block) and the empty glyph (light shade) at different visual weights, which read
// as mismatched, oddly-sized bars. A CSS width is exact regardless of font.

/** Percentage of `total` that `used` represents, clamped to [0, 100]. 0 for a missing/zero total. */
export function computeUtilizationPercent(used, total) {
  if (!total || total <= 0) return 0;
  const raw = (Math.max(0, used) / total) * 100;
  return Math.min(100, raw);
}

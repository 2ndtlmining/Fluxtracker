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

// Plain ASCII bar -- '=' filled / '-' empty inside brackets -- to match the terminal
// aesthetic (same reasoning as the header's [[ DOCKER ]] icon motifs: a real text
// character inherits the theme's color/glow, unlike a CSS-styled div or a unicode block
// glyph). '=' and '-' are both flat, single-cell ASCII characters with no font-dependent
// weight mismatch between the "filled" and "empty" glyphs -- the bug the original
// unicode block-character bars had (see git history on this file).
export function formatAsciiBar(percent, width = 16) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  const filled = Math.round((clamped / 100) * width);
  return `[${'='.repeat(filled)}${'-'.repeat(width - filled)}]`;
}

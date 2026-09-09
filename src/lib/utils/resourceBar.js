// Small pure utility for the terminal-style utilization bars on BusiestNodeResourcesCard.
// Kept separate from the component (and from terminalAnimation.js, which is specifically
// the fixed 6-row ASCII box's logic) since this is generic used/total -> bar formatting,
// usable by any card that wants the same block-character look.

/** Percentage of `total` that `used` represents, clamped to [0, 100]. 0 for a missing/zero total. */
export function computeUtilizationPercent(used, total) {
  if (!total || total <= 0) return 0;
  const raw = (Math.max(0, used) / total) * 100;
  return Math.min(100, raw);
}

const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';

/**
 * A block-character bar (e.g. "█████░░░░░") plus the rounded percentage it represents.
 * `width` is the bar's character count.
 */
export function formatUtilizationBar(used, total, width = 10) {
  const percent = computeUtilizationPercent(used, total);
  const filled = Math.round((percent / 100) * width);
  const bar = FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(Math.max(0, width - filled));
  return { bar, percent: Math.round(percent) };
}

// The one set of number formatters for the dashboard (issue #323).
//
// Before this, every card, the chart and the footer had its own: USD dropped its decimals
// between 1k and 10k while FLUX kept them, the chart axis wrote "12k" where the cards wrote
// "12.35K", the chart's USD had no thousands separator, the footer grouped block heights with
// spaces while the table used commas, and `toLocaleString()` without a locale made a de-DE
// visitor see "1.234,568" beside "2345.67" in the same card.
//
// Rules: a fixed en-US locale, upper-case K/M, and fixed decimals per unit. Non-finite input
// (null, undefined, NaN) formats as zero -- the cards decide separately whether a value is
// missing, and render a notice rather than calling these.

const formatters = new Map();

function numberFormat(decimals) {
  let nf = formatters.get(decimals);
  if (!nf) {
    nf = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    formatters.set(decimals, nf);
  }
  return nf;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** en-US grouping with exactly `decimals` fraction digits: 12345.6 -> "12,345.60" (2). */
export function formatNumber(value, decimals = 0) {
  // Intl keeps the sign of a value that rounds to zero ("-0.00"); drop it.
  return numberFormat(decimals).format(finite(value)).replace(/^-(?=[0.,]+$)/, '');
}

/**
 * Compact above 10,000, exact below: 1,234.5 -> "1,234.50", 12,345 -> "12.35K",
 * 1,234,567 -> "1.23M". `trim` drops trailing zeros ("12K", "1.5M", "9,999"),
 * for counts and axis ticks where ".00" is noise.
 */
export function formatCompact(value, decimals = 2, { trim = false } = {}) {
  const n = finite(value);
  const abs = Math.abs(n);
  let scaled;
  let suffix;
  if (abs >= 1_000_000) {
    scaled = n / 1_000_000;
    suffix = 'M';
  } else if (abs >= 10_000) {
    scaled = n / 1_000;
    suffix = 'K';
  } else {
    const exact = formatNumber(n, decimals);
    return trim && exact.includes('.') ? exact.replace(/\.?0+$/, '') : exact;
  }
  let text = numberFormat(decimals).format(scaled);
  if (trim && text.includes('.')) text = text.replace(/\.?0+$/, '');
  return text + suffix;
}

/** FLUX amount, no unit: two decimals, compact above 10k unless `compact: false`. */
export function formatFlux(value, { compact = true } = {}) {
  return compact ? formatCompact(value, 2) : formatNumber(value, 2);
}

/** USD amount with the sign before the "$": two decimals, compact above 10k by default. */
export function formatUsd(value, { compact = true } = {}) {
  const n = finite(value);
  const body = compact ? formatCompact(Math.abs(n), 2) : formatNumber(Math.abs(n), 2);
  return (n < 0 && body !== '0.00' ? '-$' : '$') + body;
}

/** Whole-number count: "12,345", or with `compact` "12.3K" / "1.5M" (trimmed). */
export function formatCount(value, { compact = false } = {}) {
  const n = Math.round(finite(value));
  return compact ? formatCompact(n, n >= 1_000_000 || n <= -1_000_000 ? 2 : 1, { trim: true }) : formatNumber(n, 0);
}

// ---------------------------------------------------------------------------------------
// Time left on an app's subscription, from blocks (30s each, 2,880 a day). Owner request:
// deployments run a week at the least, so "167h 59m" is the wrong unit -- anything over a
// day reads in days, then months, then years. Under a day (the Expiring Soon tab) keeps
// hours and minutes, where they matter.
const BLOCKS_PER_DAY = 2880;
const DAYS_PER_MONTH = 30.44;

export function formatBlocksLeft(blocks) {
  const b = Math.max(0, finite(blocks));
  if (b < BLOCKS_PER_DAY) {
    const totalMinutes = Math.round((b * 30) / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.round(b / BLOCKS_PER_DAY);
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 365) {
    const months = Math.round(days / DAYS_PER_MONTH);
    return `${months} months`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

/** Bytes as a short size for the header: "812 KB", "412 MB", "1.3 GB". */
export function formatBytes(bytes) {
  const b = finite(bytes);
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${formatNumber(b / 1024 ** 3, 1)} GB`;
}

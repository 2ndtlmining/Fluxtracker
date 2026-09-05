// Compact ASCII "FLUX" wordmark — the persistent header identity after boot.
// Kept as a single constant so it's easy to swap later without touching component logic.
export const FLUX_LOGO = ` ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`;

/** Row count and column width of FLUX_LOGO — the fixed box every animation frame fills. */
export const LOGO_LINES = FLUX_LOGO.split('\n');
export const LOGO_WIDTH = Math.max(...LOGO_LINES.map(line => line.length));

/**
 * The box is exactly the logo's row count — boot text, logo and sync frames all
 * live in the same fixed-height box, so the header never changes size.
 */
export const BOOT_LINE_COUNT = LOGO_LINES.length;

/** Row style kinds: terminal text (like the boot output) vs the logo's bright glyphs. */
export const ROW_KIND_TEXT = 'text';
export const ROW_KIND_LOGO = 'logo';

/**
 * Choose a visually reasonable starting block for the boot counter animation —
 * far enough back that the count-up reads as real progress, never below zero.
 */
export function pickBootStartBlock(targetBlock, range = 1100) {
  if (typeof targetBlock !== 'number' || !Number.isFinite(targetBlock)) return null;
  return Math.max(0, Math.floor(targetBlock - range));
}

/**
 * Interpolate the displayed block count between startBlock and targetBlock.
 * Ease-out cubic: fast at first, settles smoothly — always lands exactly on
 * targetBlock at progress===1, and never shows targetBlock before then (so the
 * "... OK" suffix always appears together with the final number, never early).
 */
export function computeAnimatedBlock(startBlock, targetBlock, progress) {
  if (typeof startBlock !== 'number' || typeof targetBlock !== 'number') return targetBlock ?? null;
  if (targetBlock <= startBlock) return targetBlock;

  const clamped = Math.max(0, Math.min(1, progress));
  if (clamped >= 1) return targetBlock;

  const eased = 1 - Math.pow(1 - clamped, 3);
  const value = Math.floor(startBlock + (targetBlock - startBlock) * eased);
  return Math.min(targetBlock - 1, value);
}

/**
 * Decide whether a freshly-polled block height should trigger the short sync
 * animation. False during boot (so the first fetch never fires a sync) and
 * false when there's no prior reading to compare against yet.
 */
export function shouldTriggerSync({ previousBlockHeight, newBlockHeight, bootComplete }) {
  if (!bootComplete) return false;
  if (typeof previousBlockHeight !== 'number' || typeof newBlockHeight !== 'number') return false;
  return newBlockHeight > previousBlockHeight;
}

/** If a new sync arrives while one is already animating, extend the target rather than overlap. */
export function mergeSyncTarget(currentTarget, newBlockHeight) {
  if (typeof currentTarget !== 'number') return newBlockHeight;
  if (typeof newBlockHeight !== 'number') return currentTarget;
  return Math.max(currentTarget, newBlockHeight);
}

/**
 * One condensed boot row holding api/database health, replacing the old two
 * dotted status lines so the boot output fits the six-row logo box.
 */
export function formatStatusLine(apiStatus, dbStatus) {
  const api = apiStatus === 'online' ? 'OK' : 'ERROR';
  const db = dbStatus === 'online' ? 'OK' : 'OFFLINE';
  return `> api ${api} | database ${db}`;
}

/**
 * Boot row showing real tracker data — the snapshot total from /api/header —
 * written only once the data is ready, so the number is always live.
 */
export function formatSnapshotLine(count) {
  const n = Number.isFinite(count) ? count.toLocaleString('en-US') : '...';
  return `daily snapshots... ${n} loaded`;
}

/**
 * Final boot line: build version and network stats condensed into one row so
 * the boot output fits the six-row logo box.
 */
export function formatSummaryLine(appVersion, codename, totalNodes, totalApps) {
  const version = [appVersion || '...', codename].filter(Boolean).join(' ');
  const nodes = Number.isFinite(totalNodes) ? totalNodes.toLocaleString('en-US') : '...';
  const apps = Number.isFinite(totalApps) ? totalApps.toLocaleString('en-US') : '...';
  return `version ${version} | ${nodes} nodes | ${apps} apps`;
}

/**
 * Sync counter row: X counts up from the previous block height to the freshly
 * polled one (boot-style), Y is the target. `... OK` is appended once X lands.
 */
export function formatSyncBlocksLine(current, target) {
  return `synched blocks ${current ?? '...'} / ${target ?? '...'}`;
}

/**
 * Sync row showing the tracker's real transaction total — read live from the
 * header data, never a placeholder.
 */
export function formatTransactionsLine(count) {
  const n = Number.isFinite(count) ? count.toLocaleString('en-US') : '...';
  return `${n} transactions loaded successfully`;
}

/**
 * Pool of single-width ASCII texture characters for the sync pattern. Symbols
 * only — no letters or digits, so the pattern never reads as real text.
 */
export const PATTERN_CHARS = ['+', '=', '-', '_', '~', '^', ':', ';', '.', ',', '*', '#', '%', '/', '\\', '|', '(', ')', '[', ']', '{', '}', '<', '>', '!', '?'];

/**
 * Pick the two characters a sync pattern is woven from — random on every call,
 * so each sync looks slightly different. The pair is always two distinct chars.
 * `random` is injectable for deterministic tests.
 */
export function pickPatternChars(random = Math.random) {
  const pick = () => PATTERN_CHARS[Math.floor(random() * PATTERN_CHARS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return [a, b];
}

/**
 * A checkerboard texture woven from two characters, one row per line,
 * alternating which character starts each row so adjacent rows read as a
 * distinct static/noise pattern rather than a solid stripe. Fills the exact
 * box the logo occupies during a sync. The character pair is random per call
 * unless one is passed in (tests pass a fixed pair).
 */
export function buildSyncPatternLines(count, width, chars = pickPatternChars()) {
  const [charA, charB] = chars;
  const lines = [];
  for (let row = 0; row < count; row++) {
    const rowStartsWithCharA = row % 2 === 0;
    let line = '';
    for (let col = 0; col < width; col++) {
      const colIsEven = col % 2 === 0;
      line += colIsEven === rowStartsWithCharA ? charA : charB;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Force `lines` to exactly `count` entries: truncate if there are too many,
 * otherwise cycle through `filler` (blank lines if none given) to pad it out.
 * Used so every phase of the sync animation fills the same fixed-height box.
 */
export function padLines(lines, count, filler = []) {
  if (lines.length >= count) return lines.slice(0, count);
  const result = [...lines];
  let i = 0;
  while (result.length < count) {
    result.push(filler.length > 0 ? filler[i % filler.length] : '');
    i++;
  }
  return result;
}

/**
 * Merge two equal-length line arrays into one animation frame: `revealedCount`
 * rows show `incomingLines`, the rest still show `baseLines`. Direction controls
 * which end of the box reveals first — 'top-down' or 'bottom-up'. This is the
 * single primitive behind every phase of the sync transition (logo -> pattern,
 * pattern -> text, text -> logo): only the two line-arrays and direction change.
 */
export function composeRevealFrame(baseLines, incomingLines, revealedCount, direction) {
  const count = baseLines.length;
  const clamped = Math.max(0, Math.min(count, revealedCount));
  const frame = [];
  for (let row = 0; row < count; row++) {
    const revealed = direction === 'bottom-up' ? row >= count - clamped : row < clamped;
    frame.push(revealed ? incomingLines[row] : baseLines[row]);
  }
  return frame;
}

/**
 * Row-style companion to composeRevealFrame: during a reveal each row shows the
 * incoming kind once revealed and the base kind before that, using the exact
 * same reveal logic so the two arrays stay perfectly aligned. Lets the template
 * style revealed logo rows (bright glyphs) differently from text rows mid-frame.
 */
export function composeRevealKinds(baseKinds, incomingKinds, revealedCount, direction) {
  const count = baseKinds.length;
  const clamped = Math.max(0, Math.min(count, revealedCount));
  const kinds = [];
  for (let row = 0; row < count; row++) {
    const revealed = direction === 'bottom-up' ? row >= count - clamped : row < clamped;
    kinds.push(revealed ? incomingKinds[row] : baseKinds[row]);
  }
  return kinds;
}

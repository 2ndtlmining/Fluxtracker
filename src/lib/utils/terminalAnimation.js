// Compact ASCII "FLUX" wordmark — the persistent header identity after boot.
// Kept as a single constant so it's easy to swap later without touching component logic.
export const FLUX_LOGO = ` ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`;

/** Row count and column width of FLUX_LOGO — the fixed box every sync-animation frame fills. */
export const LOGO_LINES = FLUX_LOGO.split('\n');
export const LOGO_WIDTH = Math.max(...LOGO_LINES.map(line => line.length));

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

export function formatNetworkLine(totalNodes, totalApps) {
  const nodes = Number.isFinite(totalNodes) ? totalNodes.toLocaleString('en-US') : '...';
  const apps = Number.isFinite(totalApps) ? totalApps.toLocaleString('en-US') : '...';
  return `network ${nodes} nodes | apps ${apps}`;
}

export function formatVersionLine(appVersion, codename) {
  const version = appVersion || '...';
  return codename ? `version ${version} ${codename} loaded` : `version ${version} loaded`;
}

/**
 * Build the terminal lines for the sync animation. Enumerates each new block
 * individually when there are few (the common case — one poll cycle rarely
 * misses more than a handful of blocks); condenses to a single range line
 * otherwise so the animation never grows unbounded.
 */
export function buildSyncBlockLines(previousBlockHeight, newBlockHeight) {
  if (typeof previousBlockHeight !== 'number' || typeof newBlockHeight !== 'number') return [];
  if (newBlockHeight <= previousBlockHeight) return [];

  const MAX_LINES = 6;
  const total = newBlockHeight - previousBlockHeight;

  if (total <= MAX_LINES) {
    const lines = [];
    for (let b = previousBlockHeight + 1; b <= newBlockHeight; b++) {
      lines.push(`loading new blocks ${b}`);
    }
    return lines;
  }

  return [`loading new blocks ${previousBlockHeight + 1}–${newBlockHeight}`];
}

/** Extra sync-flavor lines used to pad the status text out to a full box — never fake data, just filler. */
export const SYNC_FILLER_LINES = ['syncing mempool...', 'verifying chain state...'];

/**
 * A checkerboard "+=+=+=" texture, one row per line, alternating which character
 * starts each row so adjacent rows read as a distinct static/noise pattern rather
 * than a solid stripe. Fills the exact box the logo occupies during a sync.
 */
export function buildSyncPatternLines(count, width) {
  const lines = [];
  for (let row = 0; row < count; row++) {
    const rowStartsWithPlus = row % 2 === 0;
    let line = '';
    for (let col = 0; col < width; col++) {
      const colIsEven = col % 2 === 0;
      line += colIsEven === rowStartsWithPlus ? '+' : '=';
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

// Compact ASCII "FLUX" wordmark — the persistent header identity after boot.
// Kept as a single constant so it's easy to swap later without touching component logic.
export const FLUX_LOGO = ` ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`;

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

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
 * The box is exactly the logo's row count — boot text, logo and idle-rotation frames
 * all live in the same fixed-height box, so the header never changes size.
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
 * Force `lines` to exactly `count` entries: truncate if there are too many,
 * otherwise cycle through `filler` (blank lines if none given) to pad it out.
 * Used so every phase of the animation fills the same fixed-height box.
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
 * single primitive behind every wipe (boot text -> logo, and every idle-rotation
 * transition): only the two line-arrays and direction change.
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

// ============================================
// IDLE ROTATION: LATEST EXPIRING / LATEST DEPLOYED
// ============================================
//
// Once boot finishes, the box cycles Logo -> Latest Expiring -> Latest Deployed -> Logo
// -> ... (skipping any slot with no data) instead of parking on the logo indefinitely.
// This replaced two earlier things: the block-sync animation (a random two-character
// texture plus numbers already shown in the header's stats bar -- no new information)
// and the one-off "new deployment detected" flash (event-driven, so it could sit idle
// for a long time with nothing to show). See docs/superpowers/specs -- issue #104.

/** The exact rule determineAppType() already uses elsewhere in this codebase. */
export function isGitDeployment(repo) {
  return typeof repo === 'string' && repo.toLowerCase().includes('runonflux/orbit');
}

/** Deterministic truncation so a name/repo can't overflow the fixed box. */
export function truncateForBox(text, maxWidth = LOGO_WIDTH - 2) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxWidth) return text;
  return text.slice(0, Math.max(0, maxWidth - 3)) + '...';
}

/** Single-line ASCII glyphs -- whale for docker, octocat for git -- centered to LOGO_WIDTH. */
function centerInBox(text, width = LOGO_WIDTH) {
  if (text.length >= width) return text.slice(0, width);
  const totalPad = width - text.length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export const DOCKER_ICON_LINE = centerInBox('🐳 DOCKER 🐳'); // 🐳 whale, matches Docker's own mascot
export const GIT_ICON_LINE = centerInBox('🐙 GITHUB 🐙'); // 🐙 octopus, closest common emoji to the octocat
export const EXPIRING_ICON_LINE = centerInBox('⏳ EXPIRING ⏳'); // hourglass -- distinct from either deploy icon

const FIELD_LABEL_WIDTH = 9; // "  NAME   ".length -- every field prefix is this wide

function formatDetailLine(label, value) {
  const prefix = `  ${label.padEnd(6)} `;
  const available = Math.max(1, LOGO_WIDTH - FIELD_LABEL_WIDTH);
  return prefix + truncateForBox(String(value), available);
}

// Space-separated, not " | "-joined: the RES row is the tightest fit in the box (three
// values in ~25 available chars after the label prefix), and every separator character
// is one a real resource value doesn't get to keep.
function formatResourceSummary(cpu, ram, hdd) {
  const parts = [];
  if (cpu) parts.push(`${cpu} CPU`);
  if (ram) parts.push(ram >= 1000 ? `${(ram / 1000).toFixed(1)}G RAM` : `${ram}M RAM`);
  if (hdd) parts.push(hdd >= 1000 ? `${(hdd / 1000).toFixed(1)}T SSD` : `${hdd}G SSD`);
  return parts.join(' ');
}

// Mirrors CarouselCard.svelte's formatBlocksAsTime (30s/block, same as config.js's
// BLOCKS_PER_DAY = 2880) -- kept local rather than shared since this box's rendering
// has its own width/label constraints the carousel doesn't.
function formatBlocksAsTime(blocks) {
  const totalMinutes = Math.round(blocks * 30 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * The most recently deployed app (lowest blockAge) from the /api/carousel/deployed
 * list -- that endpoint sorts alphabetically, not by recency, so the caller can't just
 * take stats[0]. Null when the list is empty (nothing deployed in the last 24h).
 */
export function pickLatestDeployed(deployedApps) {
  if (!Array.isArray(deployedApps) || deployedApps.length === 0) return null;
  return deployedApps.reduce((latest, app) =>
    (app.blockAge ?? Infinity) < (latest.blockAge ?? Infinity) ? app : latest
  );
}

/**
 * The soonest-to-expire app from the /api/carousel/expiring list -- that endpoint is
 * already sorted most-urgent-first, so this is just stats[0]. Null when empty.
 */
export function pickLatestExpiring(expiringApps) {
  if (!Array.isArray(expiringApps) || expiringApps.length === 0) return null;
  return expiringApps[0];
}

/**
 * The combined deployment-detail frame (issue #98's layout): icon row, then
 * NAME/REPO/INST/RES -- each omitted (not left blank) when its data isn't real -- then
 * the same icon row again. Missing rows are dropped and the remainder padded at the END
 * of the middle section, so real content is never followed by a gap.
 */
export function formatDeploymentFrame(deployment) {
  const icon = isGitDeployment(deployment.repo) ? GIT_ICON_LINE : DOCKER_ICON_LINE;
  const instances = Number.isFinite(deployment.instances) ? deployment.instances : null;
  const resources = formatResourceSummary(deployment.cpu, deployment.ram, deployment.hdd);

  const detailLines = [formatDetailLine('NAME', deployment.name || 'unknown')];
  if (deployment.repo) detailLines.push(formatDetailLine('REPO', deployment.repo));
  if (instances !== null) detailLines.push(formatDetailLine('INST', instances));
  if (resources) detailLines.push(formatDetailLine('RES', resources));

  const middleRowCount = BOOT_LINE_COUNT - 2;
  const middle = padLines(detailLines, middleRowCount);
  return [icon, ...middle, icon];
}

/**
 * The symmetric "latest expiring" frame -- same shape as formatDeploymentFrame, but an
 * hourglass icon and an EXPIRE row (time until expiry) in place of REPO, since a repo
 * distinction isn't meaningful here.
 */
export function formatExpiringFrame(app) {
  const instances = Number.isFinite(app.instances) ? app.instances : null;
  const resources = formatResourceSummary(app.cpu, app.ram, app.hdd);
  const expiresIn = Number.isFinite(app.blocksUntilExpiry) ? formatBlocksAsTime(app.blocksUntilExpiry) : null;

  const detailLines = [formatDetailLine('NAME', app.name || 'unknown')];
  if (expiresIn) detailLines.push(formatDetailLine('EXPIRE', expiresIn));
  if (instances !== null) detailLines.push(formatDetailLine('INST', instances));
  if (resources) detailLines.push(formatDetailLine('RES', resources));

  const middleRowCount = BOOT_LINE_COUNT - 2;
  const middle = padLines(detailLines, middleRowCount);
  return [EXPIRING_ICON_LINE, ...middle, EXPIRING_ICON_LINE];
}

/**
 * Reduced-motion equivalent of formatDeploymentFrame: name + instance count, no
 * icon/repo/resources -- those exist to fill an animated sequence, not to carry
 * information a static reader needs.
 */
export function formatDeploymentReducedMotionLines(deployment) {
  const name = truncateForBox(deployment?.name || 'unknown');
  const instances = Number.isFinite(deployment?.instances) ? deployment.instances : null;
  return padLines([
    '  LATEST DEPLOYMENT',
    '',
    `  ${name}`,
    instances !== null ? `  ${instances} ${instances === 1 ? 'INSTANCE' : 'INSTANCES'}` : ''
  ], BOOT_LINE_COUNT);
}

/** Reduced-motion equivalent of formatExpiringFrame. */
export function formatExpiringReducedMotionLines(app) {
  const name = truncateForBox(app?.name || 'unknown');
  const expiresIn = Number.isFinite(app?.blocksUntilExpiry) ? formatBlocksAsTime(app.blocksUntilExpiry) : null;
  return padLines([
    '  EXPIRING SOON',
    '',
    `  ${name}`,
    expiresIn !== null ? `  in ${expiresIn}` : ''
  ], BOOT_LINE_COUNT);
}

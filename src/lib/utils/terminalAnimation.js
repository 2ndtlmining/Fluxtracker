import { formatNumber } from './format.js';
import { PLAIN_SKY } from './seasons.js';

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
// The idle-rotation deploy/expire frames' icon bookend rows (item 4 of the
// decentralization follow-ups): orange for an expiring app, green for a new
// deployment, so color reinforces the icon glyph rather than every rotation frame
// reading as the same plain terminal text. Middle detail rows (NAME/REPO/etc.) stay
// ROW_KIND_TEXT -- only the icon rows carry the accent.
export const ROW_KIND_EXPIRING = 'expiring';
export const ROW_KIND_DEPLOYED = 'deployed';

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

/** Deterministic truncation so a name/repo can't overflow the fixed box. */
export function truncateForBox(text, maxWidth = LOGO_WIDTH - 2) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxWidth) return text;
  return text.slice(0, Math.max(0, maxWidth - 3)) + '...';
}

// Plain ASCII, not emoji: an emoji glyph renders in its own fixed color and ignores the
// box's `color`/`text-shadow` styling, so it shows up as a flat, un-glowing sticker against
// the monochrome cyan terminal text everywhere else -- it reads as visually broken, not
// distinctive.
//
// Issue #127: #119 shipped these as a single bracketed word ("[[ DOCKER ]]"/"<< GITHUB >>"
// for a deployment, "!! EXPIRING !!" for an expiry) with only color distinguishing them --
// judged "looks bad" once seen live. Reworked as full-width directional-arrow banners:
// arrows converge inward for a deployment (something arriving) and diverge outward for an
// expiry (something departing/urgent) -- a motif distinct per event type, not just a color
// swap. The docker-vs-git distinction is dropped from this row entirely: the REPO row
// already shows the real image/repo string, so the icon row's job shifts from "app type"
// to "event type" only. Each is exactly LOGO_WIDTH (34) chars -- verified in
// terminalAnimation.test.js, not built via padding/centering since the arrow run length on
// each side already sums to the exact width.
export const DEPLOYED_ICON_LINE = '>>>>>>>> NEW APP DEPLOYED <<<<<<<<';
// Issue #286: a large deployment's opening bookend -- exactly as wide as the normal one.
export const LARGE_ICON_LINE = '>>>>>>>> LARGE DEPLOYMENT <<<<<<<<';

/**
 * A large deployment (issue #286) -- 10+ instances or 8+ CPU. NOT isEnterprise: ~85% of
 * specs are enterprise because the game sites encrypt them, so it says nothing about size.
 * Encrypted specs report 0 CPU, so for them only the instance count can qualify.
 */
export function isLargeDeployment(app) {
  return (Number.isFinite(app?.instances) && app.instances >= 10)
    || (Number.isFinite(app?.cpu) && app.cpu >= 8);
}
export const EXPIRING_ICON_LINE = '<<<<<<<<<<<< EXPIRING >>>>>>>>>>>>';

// ── Gamepad frame (issue #177) ────────────────────────────────────────────────────────
//
// Games are by far the most common identifiable deployment on the network (348 app
// components against 103 crypto and 33 WordPress), so a game deployment gets its own
// full-box frame before the detail frame: an ASCII controller that plays itself for a
// couple of seconds, then wipes to NAME/AGO/INST/RES as usual.
//
// Every control is exactly 3 columns in BOTH states -- d-pad `[^]` pressed `{^}`, button
// `(o)` pressed `(*)` -- and the pressed state is spliced in BY COLUMN rather than by
// string replacement. That is what makes the box impossible to break: a substitution whose
// replacement differs in width by even one character would move the right-hand wall, and
// the box height/width is load-bearing here (CLAUDE.md: the box must never depend on
// content). terminalAnimation.test.js asserts a single distinct row width across every
// frame of the sequence.
const PAD_INNER = 25;                       // columns between the two side walls
const PAD_TOP = ' ' + '_'.repeat(PAD_INNER) + ' ';
// Built from a char code rather than written literally: a lone backslash in this file has
// been a repeated source of escaping mistakes, and the art is load-bearing for box width.
const PAD_EDGE = String.fromCharCode(92); // backslash
const PAD_SHOULDERS = '/' + ' '.repeat(PAD_INNER) + PAD_EDGE;
const PAD_BOTTOM = PAD_EDGE + '_'.repeat(PAD_INNER) + '/';
const padWall = row => '|' + row.padEnd(PAD_INNER).slice(0, PAD_INNER) + '|';

// Interior rows authored at rest; controls are overwritten in place by column.
const PAD_ROWS = [
  PAD_TOP,
  PAD_SHOULDERS,
  padWall('   [^]           (o) (o)'),
  padWall('  [<] [>]'),
  padWall('   [v]           (o) (o)'),
  PAD_BOTTOM
];

// row index -> { control: start column in that row }
const PAD_CONTROL_COLUMNS = {
  2: { DU: 4, BY: 18, BB: 22 },
  3: { DL: 3, DR: 7 },
  4: { DD: 4, BX: 18, BA: 22 }
};

const PAD_AT_REST = { DU: '[^]', DD: '[v]', DL: '[<]', DR: '[>]', BY: '(o)', BB: '(o)', BX: '(o)', BA: '(o)' };
const PAD_PRESSED = { DU: '{^}', DD: '{v}', DL: '{<}', DR: '{>}', BY: '(*)', BB: '(*)', BX: '(*)', BA: '(*)' };

// Hand-authored rather than random: it reads as someone actually playing (move, jump,
// turn, attack) instead of as noise, and a fixed sequence is assertable -- the header smoke
// harness can check exact frames, which a random one could not without seeding.
export const GAMEPAD_SEQUENCE = [
  [],
  ['DR'],
  ['DR', 'BA'],
  ['BA'],
  ['DL'],
  ['DL', 'BB'],
  ['DU', 'BX'],
  []
];

export const GAMEPAD_FRAME_COUNT = GAMEPAD_SEQUENCE.length;

function spliceAt(row, column, text) {
  return row.slice(0, column) + text + row.slice(column + text.length);
}

/**
 * One frame of the self-playing gamepad, as BOOT_LINE_COUNT rows.
 * @param {number} step index into GAMEPAD_SEQUENCE; wraps, so callers can just count up.
 */
export function formatGamepadFrame(step = 0) {
  const pressed = new Set(GAMEPAD_SEQUENCE[((step % GAMEPAD_FRAME_COUNT) + GAMEPAD_FRAME_COUNT) % GAMEPAD_FRAME_COUNT]);
  const artWidth = PAD_ROWS[0].length;
  const leftPad = Math.max(0, Math.floor((LOGO_WIDTH - artWidth) / 2));

  return PAD_ROWS.map((row, index) => {
    const controls = PAD_CONTROL_COLUMNS[index];
    let out = row;
    if (controls) {
      for (const [control, column] of Object.entries(controls)) {
        out = spliceAt(out, column, (pressed.has(control) ? PAD_PRESSED : PAD_AT_REST)[control]);
      }
    }
    return ' '.repeat(leftPad) + out;
  });
}

/**
 * Row kinds for a gamepad frame. The whole controller carries the green deployment accent
 * -- unlike the detail frames, where only the bookend rows are accented, here the art IS
 * the event marker, so accenting a subset would read as a rendering fault.
 */
export function gamepadFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_DEPLOYED);
}

// ── Valheim longship (issue #180) ─────────────────────────────────────────────────────
//
// The first per-game skin. A Valheim deployment sails a longship across moving water
// instead of playing the shared controller; every other game keeps the controller, which
// stays the fallback for any game with no art of its own.
//
// Two things make the motion, and both are length-preserving by construction -- which is
// the whole trick, because the box must never depend on content (CLAUDE.md):
//
//   1. The water is TWO wave rows ROTATED by a different amount each step. Rotating a
//      string can't change its length, so no amount of animation can move the box wall.
//   2. The ship is OVERLAID onto a blank LOGO_WIDTH canvas by column, skipping its own
//      spaces so the waves show through around the hull. Overlay writes in place and never
//      appends, so the canvas stays exactly LOGO_WIDTH wide whatever the art does.
//
// terminalAnimation.test.js asserts a single distinct row width and row count across every
// frame of the sequence, and that consecutive frames actually differ on the wave rows.

/** Rotate a string left by `by` characters. Length-preserving -- see note above. */
export function rotateStrip(strip, by) {
  if (!strip.length) return strip;
  const offset = ((by % strip.length) + strip.length) % strip.length;
  return strip.slice(offset) + strip.slice(0, offset);
}

/** Build a wave strip of exactly LOGO_WIDTH columns from a repeating pattern. */
export function waveStrip(pattern) {
  return pattern.repeat(Math.ceil(LOGO_WIDTH / pattern.length)).slice(0, LOGO_WIDTH);
}

const BSLASH_V = String.fromCharCode(92);

// Two different periods so the rows never line up into one marching stripe -- the near
// water reads as faster than the far water, which is what sells the parallax.
const SEA_FAR = waveStrip('~~^~~~-~');
const SEA_NEAR = waveStrip('~-~~~^~~~');

// The ship, authored row by row. Rows are NOT padded to a common width on purpose: each is
// overlaid at its own column, so only the canvas has a width, and the art can never set it.
const SHIP_EDGE = String.fromCharCode(92); // backslash -- never written literally here
const SHIP_ROWS = [
  '___|___',
  '|=======|',
  '___|=======|___',
  SHIP_EDGE + '__o__o__o__o__/'
];
// Left column per ship row, chosen so every row is centred on the hull's midpoint.
const SHIP_COLUMNS = [13, 12, 9, 9];

// Bob pattern: the hull rides at row offset 0 or 1, changing every two steps. At offset 1
// the hull sits ON the far-water row and is overlaid into it, which reads as the ship
// settling into the swell rather than floating above it.
const SHIP_BOB = [0, 0, 1, 1, 0, 0, 1, 1];

// Two gulls drifting across the sky at different rates. They are not decoration for its own
// sake: when the ship bobs down it vacates the top row, and a frame with a genuinely empty
// row is the one thing the header smoke harness rejects outright. The gulls guarantee every
// row of every frame has content, whatever the hull is doing. Columns are taken modulo the
// canvas width, so they can never land outside the box.
// Both drift right, starting clear of the mast so neither is painted over by the sail.
// The gull glyph itself comes from ctx.sky (seasons.js, issue #287).
const GULL_COLUMNS = [2, 22];
const GULL_DRIFT = [1, 1];

export const VALHEIM_FRAME_COUNT = SHIP_BOB.length;

/**
 * Overlay `art` onto `row` starting at `column`, skipping spaces in the art so whatever is
 * underneath (the water) shows through the gaps in the ship. Never changes row length:
 * anything that would land past the right edge is dropped.
 */
export function overlayAt(row, column, art) {
  const out = row.split('');
  for (let i = 0; i < art.length; i++) {
    const target = column + i;
    if (target < 0 || target >= out.length) continue;
    if (art[i] === ' ') continue;
    out[target] = art[i];
  }
  return out.join('');
}

/**
 * One frame of the longship, as BOOT_LINE_COUNT rows of exactly LOGO_WIDTH columns.
 * @param {number} step index into the sequence; wraps, so callers can just count up.
 */
export function formatValheimFrame(step = 0, ctx = {}, shipOffset = 0, { oars = false } = {}) {
  const sky = ctx?.sky ?? PLAIN_SKY;
  const index = ((step % VALHEIM_FRAME_COUNT) + VALHEIM_FRAME_COUNT) % VALHEIM_FRAME_COUNT;
  const bob = SHIP_BOB[index];

  const blank = ' '.repeat(LOGO_WIDTH);
  const rows = Array(BOOT_LINE_COUNT).fill(blank);

  // Water fills the bottom two rows. The near row rotates the other way and at half the
  // rate of the far row, so the two never march in step.
  rows[BOOT_LINE_COUNT - 2] = rotateStrip(SEA_FAR, index);
  rows[BOOT_LINE_COUNT - 1] = rotateStrip(SEA_NEAR, -Math.floor(index / 2));

  // Sky first, so the ship's mast paints over a gull rather than the other way round.
  // Drift is driven by the WRAPPED index, not the raw step: every frame has to be a pure
  // function of step % VALHEIM_FRAME_COUNT, or the sequence never repeats and a caller that
  // just counts up forever slowly desynchronises the sky from the hull.
  if (oars) {
    // The variant's raven: one bird, flying the other way from the gulls.
    rows[0] = overlayAt(rows[0], (26 - 2 * index + LOGO_WIDTH) % (LOGO_WIDTH - 2), RAVEN);
  } else {
    GULL_COLUMNS.forEach((start, gull) => {
      const column = (start + GULL_DRIFT[gull] * index) % LOGO_WIDTH;
      rows[0] = overlayAt(rows[0], column, sky.bird);
    });
  }

  SHIP_ROWS.forEach((art, shipRow) => {
    const target = shipRow + bob;
    if (target >= BOOT_LINE_COUNT) return;
    rows[target] = overlayAt(rows[target], SHIP_COLUMNS[shipRow] + shipOffset, art);
  });

  if (oars) {
    // Oars under the shields, dipping and lifting on alternate steps -- into the water row
    // below the hull, which is where an oar belongs.
    const oarRow = SHIP_ROWS.length + bob;
    if (oarRow < BOOT_LINE_COUNT) {
      OAR_COLUMNS.forEach(column => {
        rows[oarRow] = overlayAt(rows[oarRow], column + shipOffset, index % 2 === 0 ? '/' : '|');
      });
    }
  }

  return rows;
}

// Issue #281 variant: the same longship rowed by its crew, with a raven overhead. Half of
// Valheim deployments play this one (picked per app name in the component).
const RAVEN = BSLASH_V + 'v/';
const OAR_COLUMNS = [12, 15, 18, 21];

export function formatValheimOarsFrame(step = 0, ctx = {}) {
  return formatValheimFrame(step, ctx, 0, { oars: true });
}

// Issue #182 outro: the longship sails off the right edge (overlayAt drops what passes the
// wall). It stops with its bow still in the box, so no row it vacates is ever left empty.
const VALHEIM_DEPART = [0, 3, 6, 9, 12, 15, 18, 20];

export function formatValheimOutro(step = 0, ctx = {}) {
  const index = ((step % VALHEIM_FRAME_COUNT) + VALHEIM_FRAME_COUNT) % VALHEIM_FRAME_COUNT;
  return formatValheimFrame(index, ctx, VALHEIM_DEPART[index]);
}

/**
 * Row kinds for a longship frame. Same call as the gamepad's: the whole frame carries the
 * green deployment accent, because here the art IS the event marker -- accenting only part
 * of it would read as a rendering fault.
 */
export function valheimFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_DEPLOYED);
}

// =======================================================================================
// Issue #199 -- RuneScape: Dragonwilds. A dragon gliding over scrolling clouds.
//
// Structurally the longship with clouds for water and a dragon for a hull, which is the
// point: that shape is already shipped, tested and proven against the box invariants, so
// this is art plus a registry entry rather than new frame-assembly logic.
//
// The registry key is the exact string 'RuneScape: Dragonwilds' -- what
// resolveGameFromAppName() returns. GAME_INTROS.Runescape silently falls through to the
// gamepad with no error, so the key is spelled out in the component, not derived.
// =======================================================================================

// Backslash, never written literally -- this broke the gamepad art twice, and the dragon's
// wings are nearly all backslash.
const BSLASH = String.fromCharCode(92);

// Clouds take the water's role: two rows, two periods, so they never march in step.
const CLOUD_FAR = waveStrip('~~-~~~.~');
const CLOUD_NEAR = waveStrip('~.~~~-~~~');

// Wing tips, swapped between two poses to read as a flap: arched UP on one beat and DOWN
// on the next, with the body held still between them. The body is what keeps the shape
// readable at 34 columns while the wings do the moving.
const WING_UP = '/' + BSLASH + '      /' + BSLASH;
const WING_DOWN = BSLASH + '/      ' + BSLASH + '/';

// Body rows, authored at their own columns. Not padded to a common width on purpose: each
// is overlaid at its own column, so only the canvas has a width and the art cannot set it.
const DRAGON_BODY = '___/  ' + BSLASH + '____/  ' + BSLASH + '___';
const DRAGON_HEAD = '<__o';
const DRAGON_TAIL = BSLASH + '~~';

const DRAGON_UPPER_WING_COLUMN = 6;
const DRAGON_BODY_COLUMN = 2;
const DRAGON_HEAD_COLUMN = 1;
const DRAGON_TAIL_COLUMN = 22;
const DRAGON_LOWER_WING_COLUMN = 6;

// Same bob as the hull: rides at row offset 0 or 1, changing every two steps.
const DRAGON_BOB = [0, 0, 1, 1, 0, 0, 1, 1];

// Sky furniture, load-bearing rather than decorative: when the dragon bobs down it vacates
// the top rows, and a frame with a genuinely empty row is the one thing the header smoke
// harness rejects outright. The sun is fixed; the two wisps drift at different rates so the
// sky is never static either. Columns are taken modulo the canvas width, so they can never
// land outside the box.
// Sun and wisp glyphs come from ctx.sky (seasons.js, issue #287).
const SUN_COLUMN = 28;
// Row 0's wisp always drifts. Row 1's is drawn ONLY when the dragon has bobbed down and
// vacated that row -- it exists to keep the row non-empty, and drawing it while the dragon
// is up puts a cloud straight through the wing.
const WISP_ROWS = [0, 1];
const WISP_COLUMNS = [4, 12];
const WISP_DRIFT = [1, 2];
const WISP_ONLY_WHEN_BOBBED = [false, true];

export const DRAGON_FRAME_COUNT = DRAGON_BOB.length;

/**
 * One frame of the gliding dragon, as BOOT_LINE_COUNT rows of exactly LOGO_WIDTH columns.
 * @param {number} step index into the sequence; wraps, so callers can just count up.
 */
export function formatDragonFrame(step = 0, ctx = {}, flightOffset = 0) {
  const sky = ctx?.sky ?? PLAIN_SKY;
  const index = ((step % DRAGON_FRAME_COUNT) + DRAGON_FRAME_COUNT) % DRAGON_FRAME_COUNT;
  const bob = DRAGON_BOB[index];
  const wingsUp = index % 2 === 0;

  const blank = ' '.repeat(LOGO_WIDTH);
  const rows = Array(BOOT_LINE_COUNT).fill(blank);

  // Clouds fill the bottom two rows, the near one rotating the other way and at half the
  // rate, so the two never line up into one marching stripe.
  rows[BOOT_LINE_COUNT - 2] = rotateStrip(CLOUD_FAR, index);
  rows[BOOT_LINE_COUNT - 1] = rotateStrip(CLOUD_NEAR, -Math.floor(index / 2));

  // Sky first, so the dragon paints over a wisp rather than the other way round. Drift is
  // driven by the WRAPPED index, not the raw step: every frame must be a pure function of
  // step % DRAGON_FRAME_COUNT, or a caller that counts up forever slowly desynchronises the
  // sky from the body.
  rows[0] = overlayAt(rows[0], SUN_COLUMN, sky.sun);
  WISP_ROWS.forEach((row, wisp) => {
    if (WISP_ONLY_WHEN_BOBBED[wisp] && bob === 0) return;
    const column = (WISP_COLUMNS[wisp] + WISP_DRIFT[wisp] * index) % LOGO_WIDTH;
    rows[row] = overlayAt(rows[row], column, sky.wisp);
  });

  // The dragon occupies four rows from `1 + bob`: upper wing, body, head/tail, lower wing.
  const top = 1 + bob;
  const place = (offset, column, art) => {
    const target = top + offset;
    if (target >= BOOT_LINE_COUNT) return;
    rows[target] = overlayAt(rows[target], column + flightOffset, art);
  };

  place(0, DRAGON_UPPER_WING_COLUMN, wingsUp ? WING_UP : WING_DOWN);
  place(1, DRAGON_BODY_COLUMN, DRAGON_BODY);
  place(2, DRAGON_HEAD_COLUMN, DRAGON_HEAD);
  place(2, DRAGON_TAIL_COLUMN, DRAGON_TAIL);
  place(3, DRAGON_LOWER_WING_COLUMN, wingsUp ? WING_DOWN : WING_UP);

  return rows;
}

/**
 * Row kinds for a dragon frame. Same call as the longship's: the whole frame carries the
 * green deployment accent, because here the art IS the event marker.
 */
export function dragonFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_DEPLOYED);
}

// Issue #182 outro: the dragon flies off to the right, wings still beating; it ends with its
// tail still in the box, so no row it vacates is ever left empty.
const DRAGON_DEPART = [0, 2, 4, 7, 10, 13, 16, 18];

export function formatDragonOutro(step = 0, ctx = {}) {
  const index = ((step % DRAGON_FRAME_COUNT) + DRAGON_FRAME_COUNT) % DRAGON_FRAME_COUNT;
  return formatDragonFrame(index, ctx, DRAGON_DEPART[index]);
}

// =======================================================================================
// Issue #199 -- Minecraft. A structure assembles itself out of blocks, torch last.
//
// Chosen over the cheaper minecart because the MOTION means the same thing as the event:
// a deployment is a server being built, and this literally builds one. The blocky [#]
// texture is also Minecraft's most transferable trait into a 34-column monospace box.
//
// One registry key covers Java and Bedrock -- resolveGameFromAppName() returns 'Minecraft'
// for all four of minecraftj / minecraftb / minecraftserver / minecraftbedrockserver.
// =======================================================================================

const BLOCK = '[#]';
const GROUND = '#'.repeat(LOGO_WIDTH);

// The build, as a list of parts with the step each one appears on. Cumulative: a part is
// drawn on its step and every step after, so block count never decreases and the structure
// only ever grows. A step that removed blocks would read as the opposite of a deployment.
//
// Row indices are from the TOP of the box; the ground is the last row and the foundation
// sits directly on it.
// The first foundation blocks are present from step 0, not step 1: the foundation row sits
// directly on the ground, and clouds are sky furniture that cannot plausibly cover it, so
// an empty opening frame there is both wrong-looking and rejected by the smoke harness.
const BUILD_PARTS = [
  { step: 0, row: BOOT_LINE_COUNT - 2, column: 9, art: BLOCK.repeat(3) },
  { step: 1, row: BOOT_LINE_COUNT - 2, column: 3, art: BLOCK.repeat(7) },
  { step: 2, row: BOOT_LINE_COUNT - 3, column: 14, art: BLOCK.repeat(2) },
  { step: 3, row: BOOT_LINE_COUNT - 3, column: 8, art: BLOCK.repeat(2) },
  { step: 4, row: BOOT_LINE_COUNT - 4, column: 14, art: BLOCK.repeat(2) },
  { step: 5, row: BOOT_LINE_COUNT - 4, column: 8, art: BLOCK.repeat(2) }
];

// The torch lights last, on the final two steps, and flickers between two glyphs so the
// last beat of the sequence is not a dead hold. Asserted to appear only in the back half:
// a torch lit before the walls are up would read as a rendering fault.
const TORCH_STEP = 6;
const TORCH_ROW = BOOT_LINE_COUNT - 3;
const TORCH_COLUMN = 6;
const TORCH_GLYPHS = ['i', '!'];

// Sky furniture across the upper rows -- load-bearing for exactly the reason the gulls are.
// In the early steps the build has not reached the upper rows yet, and a frame with a
// genuinely empty row is rejected outright by the smoke harness. The sun is fixed; the
// clouds drift at different rates so the sky reads as alive while the build is still low.
// Sun and cloud glyphs come from ctx.sky (seasons.js, issue #287).
const MC_SUN_COLUMN = 2;
// `untilStep` is the step the build reaches that row. Past it the cloud stops being drawn,
// because a wisp drifting through a finished wall reads as corruption rather than sky --
// and by then the blocks themselves keep the row non-empty, which is the only job the
// cloud had. The two top rows never get blocks, so their clouds run for the whole sequence.
const MC_CLOUDS = [
  { row: 0, column: 19, drift: 1, untilStep: Infinity },
  { row: 1, column: 8, drift: 2, untilStep: Infinity },
  { row: 2, column: 24, drift: 1, untilStep: 4 },
  { row: 3, column: 1, drift: 2, untilStep: 2 }
];

export const MINECRAFT_FRAME_COUNT = 8;

/**
 * One frame of the block build, as BOOT_LINE_COUNT rows of exactly LOGO_WIDTH columns.
 * @param {number} step index into the sequence; wraps, so callers can just count up.
 */
export function formatMinecraftFrame(step = 0, ctx = {}) {
  const sky = ctx?.sky ?? PLAIN_SKY;
  const index = ((step % MINECRAFT_FRAME_COUNT) + MINECRAFT_FRAME_COUNT) % MINECRAFT_FRAME_COUNT;

  const blank = ' '.repeat(LOGO_WIDTH);
  const rows = Array(BOOT_LINE_COUNT).fill(blank);

  // Ground first and always -- the one row that is never empty by construction.
  rows[BOOT_LINE_COUNT - 1] = GROUND;

  // Sky next, so blocks paint over a cloud rather than the other way round. Drift uses the
  // WRAPPED index so the frame stays a pure function of step % MINECRAFT_FRAME_COUNT.
  rows[0] = overlayAt(rows[0], MC_SUN_COLUMN, sky.sun);
  for (const cloud of MC_CLOUDS) {
    if (index >= cloud.untilStep) continue;
    const column = (cloud.column + cloud.drift * index) % LOGO_WIDTH;
    rows[cloud.row] = overlayAt(rows[cloud.row], column, sky.cloud);
  }

  // The build, cumulative: every part whose step has been reached is drawn.
  for (const part of BUILD_PARTS) {
    if (index < part.step) continue;
    rows[part.row] = overlayAt(rows[part.row], part.column, part.art);
  }

  // Torch last, flickering on the final beats.
  if (index >= TORCH_STEP) {
    const glyph = TORCH_GLYPHS[(index - TORCH_STEP) % TORCH_GLYPHS.length];
    rows[TORCH_ROW] = overlayAt(rows[TORCH_ROW], TORCH_COLUMN, glyph);
  }

  return rows;
}

/**
 * Row kinds for a Minecraft frame. Same call as the longship's -- the whole frame carries
 * the green deployment accent, because the art IS the event marker.
 */
export function minecraftFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_DEPLOYED);
}

// Issue #182 outro: the finished build stands while the torch gutters out and the sun sets
// behind it -- the server is still there, its time is what is running down.
const MC_SET_SUN_COLUMN = 28;
const MC_SUN_ROWS = [0, 0, 1, 1, 2, 2, 3, 3];
const MC_TORCH_OUT = ['i', '!', 'i', '.', '.', ' ', ' ', ' '];

export function formatMinecraftOutro(step = 0, ctx = {}) {
  const sky = ctx?.sky ?? PLAIN_SKY;
  const index = ((step % MINECRAFT_FRAME_COUNT) + MINECRAFT_FRAME_COUNT) % MINECRAFT_FRAME_COUNT;
  const rows = Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
  rows[BOOT_LINE_COUNT - 1] = GROUND;
  // The two top rows keep their drifting clouds -- they never get blocks, and they must
  // never be empty.
  for (const cloud of MC_CLOUDS.filter(c => c.untilStep === Infinity)) {
    rows[cloud.row] = overlayAt(rows[cloud.row], (cloud.column + cloud.drift * index) % LOGO_WIDTH, sky.cloud);
  }
  for (const part of BUILD_PARTS) rows[part.row] = overlayAt(rows[part.row], part.column, part.art);
  rows[TORCH_ROW] = overlayAt(rows[TORCH_ROW], TORCH_COLUMN, MC_TORCH_OUT[index]);
  // Sun last, so it sinks in front of a cloud rather than behind it.
  rows[MC_SUN_ROWS[index]] = overlayAt(rows[MC_SUN_ROWS[index]], MC_SET_SUN_COLUMN, sky.sun);
  return rows;
}

// =======================================================================================
// Palworld -- a Pal on the grass, watching a sphere arc in.
//
// Second by live instances (227 against Dragonwilds' 258) and until now the only game in
// the top four with no art of its own, so every Palworld deployment played the shared
// controller. Adding it takes per-game coverage from 61% to 93% of running game instances.
//
// Structurally the longship again: two ground strips rotated at different periods for
// parallax, a creature overlaid onto a fixed-width canvas with the same two-row bob, and
// sky furniture that exists to keep rows non-empty rather than for decoration. That shape
// is shipped, tested and proven against the box invariants, so this is art plus a registry
// entry rather than new frame-assembly logic.
//
// The registry key is 'Palworld', which is what resolveGameFromAppName() returns for the
// `palworld` app-name prefix -- app names, not repotags, because most Palworld deployments
// are enterprise-encrypted and carry no readable image.
// =======================================================================================

// Grass, in the water's role. Two different periods so the rows never march in step.
const GRASS_FAR = waveStrip('..^..,..');
const GRASS_NEAR = waveStrip('.,..^...,');

// The Pal, authored row by row. Rows are NOT padded to a common width on purpose: each is
// overlaid at its own column, so only the canvas has a width and the art can never set it.
const PAL_EARS = '(' + BSLASH + '_/)';
const PAL_FACE = '(o.o)';
const PAL_FEET = '(")_(")';
const PAL_ROWS = [PAL_EARS, PAL_FACE, PAL_FEET];
// Left column per row, chosen so the three rows centre on the body.
const PAL_COLUMNS = [23, 23, 22];

// Same bob as the hull and the dragon: rides at row offset 0 or 1, changing every two
// steps. At offset 1 the feet land ON the far grass row and are overlaid into it, which
// reads as the Pal standing in the grass rather than hovering above it.
const PAL_BOB = [0, 0, 1, 1, 0, 0, 1, 1];
const PAL_TOP_ROW = 1;

// The sphere arcs in from the left: one column further along each step, on a path that
// rises and falls. Both arrays are indexed by the WRAPPED step, so the throw repeats
// exactly rather than drifting out of sync with the bob.
const SPHERE = '(o)';
const SPHERE_COLUMNS = [1, 4, 7, 10, 12, 14, 16, 18];
const SPHERE_ROWS = [3, 2, 1, 1, 1, 2, 3, 3];

// Sky furniture, load-bearing rather than decorative: a frame with a genuinely empty row is
// the one thing the header smoke harness rejects outright. Row 0 always carries a drifting
// wisp because the Pal never reaches it. Row 1's is drawn ONLY when the Pal has bobbed down
// and vacated that row -- drawing it otherwise puts a cloud through the Pal's ears.
// The top wisp's glyph comes from ctx.sky (seasons.js, issue #287).
const WISP_TOP_COLUMN = 5;
const WISP_TOP_DRIFT = 2;
const WISP_SECOND = '~';
const WISP_SECOND_COLUMN = 30;

export const PALWORLD_FRAME_COUNT = PAL_BOB.length;

/**
 * One frame of the Pal and the sphere, as BOOT_LINE_COUNT rows of exactly LOGO_WIDTH.
 * @param {number} step index into the sequence; wraps, so callers can just count up.
 */
export function formatPalworldFrame(step = 0, ctx = {}, { walkOffset = 0, sphere = true, catches = false } = {}) {
  const sky = ctx?.sky ?? PLAIN_SKY;
  const index = ((step % PALWORLD_FRAME_COUNT) + PALWORLD_FRAME_COUNT) % PALWORLD_FRAME_COUNT;
  const bob = PAL_BOB[index];

  const blank = ' '.repeat(LOGO_WIDTH);
  const rows = Array(BOOT_LINE_COUNT).fill(blank);

  // Grass fills the bottom two rows, the near one rotating the other way and at half the
  // rate, so the two never line up into one marching stripe.
  rows[BOOT_LINE_COUNT - 2] = rotateStrip(GRASS_FAR, index);
  rows[BOOT_LINE_COUNT - 1] = rotateStrip(GRASS_NEAR, -Math.floor(index / 2));

  // Sky before the Pal, so the Pal paints over a wisp rather than the other way round.
  rows[0] = overlayAt(rows[0], (WISP_TOP_COLUMN + WISP_TOP_DRIFT * index) % LOGO_WIDTH, sky.wisp);
  if (bob === 1) {
    rows[1] = overlayAt(rows[1], WISP_SECOND_COLUMN, WISP_SECOND);
  }

  // The sphere, before the Pal for the same reason -- a sphere that landed on the Pal's
  // face would read as a rendering fault rather than a throw.
  if (sphere && catches) {
    const [row, column] = CATCH_PATH[index];
    rows[row] = overlayAt(rows[row], column, SPHERE);
  } else if (sphere) {
    rows[SPHERE_ROWS[index]] = overlayAt(rows[SPHERE_ROWS[index]], SPHERE_COLUMNS[index], SPHERE);
  }

  PAL_ROWS.forEach((art, palRow) => {
    const target = PAL_TOP_ROW + palRow + bob;
    if (target >= BOOT_LINE_COUNT) return;
    // Caught it: the Pal is delighted for the last two steps.
    const face = catches && palRow === 1 && index >= CATCH_STEP ? PAL_HAPPY : art;
    rows[target] = overlayAt(rows[target], PAL_COLUMNS[palRow] + walkOffset, face);
  });

  return rows;
}

// Issue #182 outro: no sphere this time -- the Pal walks off to the right and is last seen
// at the wall, so the rows it leaves still have it in them.
const PAL_DEPART = [0, 1, 2, 3, 4, 5, 6, 7];

// Issue #281 variant: the sphere arcs in and the Pal catches it -- the throw lands beside
// its face on the last steps, and the face lights up. Half of Palworld deployments play this.
// [row, column] per step; the last two sit beside the face at the bob's lower position.
const CATCH_PATH = [[3, 1], [2, 4], [1, 7], [1, 10], [1, 13], [2, 16], [3, 19], [3, 19]];
const CATCH_STEP = 6;
const PAL_HAPPY = '(^.^)';

export function formatPalworldCatchFrame(step = 0, ctx = {}) {
  return formatPalworldFrame(step, ctx, { catches: true });
}

export function formatPalworldOutro(step = 0, ctx = {}) {
  const index = ((step % PALWORLD_FRAME_COUNT) + PALWORLD_FRAME_COUNT) % PALWORLD_FRAME_COUNT;
  return formatPalworldFrame(index, ctx, { walkOffset: PAL_DEPART[index], sphere: false });
}

/** Every outro (issue #182) is the expiring accent across the whole frame. */
export function outroFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_EXPIRING);
}

/**
 * Row kinds for a Palworld frame. Same call as the longship's and the gamepad's: the whole
 * frame carries the green deployment accent, because here the art IS the event marker --
 * accenting only part of it would read as a rendering fault.
 */
export function palworldFrameKinds() {
  return Array(BOOT_LINE_COUNT).fill(ROW_KIND_DEPLOYED);
}

const FIELD_LABEL_WIDTH = 9; // "  NAME   ".length -- every field prefix is this wide

function formatDetailLine(label, value, width = LOGO_WIDTH) {
  const prefix = `  ${label.padEnd(6)} `;
  const available = Math.max(1, width - FIELD_LABEL_WIDTH);
  return prefix + truncateForBox(String(value), available);
}

/** NAME / AGO / INST / RES for a deployment, each omitted when its data is not real. */
function deploymentDetailLines(deployment, width = LOGO_WIDTH) {
  const instances = Number.isFinite(deployment.instances) ? deployment.instances : null;
  const resources = describeResources(deployment);
  const lines = [formatDetailLine('NAME', deployment.name || 'unknown', width)];
  if (Number.isFinite(deployment.blockAge)) lines.push(formatDetailLine('AGO', `${formatBlocksAsTime(deployment.blockAge)} ago`, width));
  if (instances !== null) lines.push(formatDetailLine('INST', instances, width));
  if (resources) lines.push(formatDetailLine('RES', resources, width));
  return lines;
}

/** NAME / EXPIRE / INST / RES for an expiring app, each omitted when its data is not real. */
function expiringDetailLines(app, width = LOGO_WIDTH) {
  const instances = Number.isFinite(app.instances) ? app.instances : null;
  const resources = describeResources(app);
  const lines = [formatDetailLine('NAME', app.name || 'unknown', width)];
  if (Number.isFinite(app.blocksUntilExpiry)) lines.push(formatDetailLine('EXPIRE', formatBlocksAsTime(app.blocksUntilExpiry), width));
  if (instances !== null) lines.push(formatDetailLine('INST', instances, width));
  if (resources) lines.push(formatDetailLine('RES', resources, width));
  return lines;
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

// Enterprise specs are encrypted, so their resources are unreadable -- and that is most
// deployments (106 of 134 in one 24h sample). Leaving the RES row out left a blank row in
// the middle of the frame; saying the spec is private is the real reading.
export const ENTERPRISE_RESOURCES = 'private (enterprise)';

/** The RES value for an app: its resources, the enterprise note, or '' (row omitted). */
export function describeResources(app) {
  const summary = formatResourceSummary(app?.cpu, app?.ram, app?.hdd);
  if (summary) return summary;
  return app?.isEnterprise ? ENTERPRISE_RESOURCES : '';
}

// Mirrors CarouselCard.svelte's formatBlocksAsTime (30s/block, same as config.js's
// BLOCKS_PER_DAY = 2880) -- kept local rather than shared since this box's rendering
// has its own width/label constraints the carousel doesn't.
export function formatBlocksAsTime(blocks) {
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
 * The combined deployment-detail frame (issue #98's layout, reworked by #127): icon row,
 * then NAME/AGO/INST/RES -- each omitted (not left blank) when its data isn't real -- then
 * the same icon row again. Missing rows are dropped and the remainder padded at the END
 * of the middle section, so real content is never followed by a gap.
 *
 * REPO is deliberately not one of these four: there are only BOOT_LINE_COUNT - 2 = 4 middle
 * slots, and AGO (time since deployment) is #127's new required content -- the repo/image
 * string this replaced is still visible on the carousel, and the icon row's job is "event
 * type" now, not "app type" (see DEPLOYED_ICON_LINE).
 */
export function formatDeploymentFrame(deployment, rank = null) {
  const detailLines = deploymentDetailLines(deployment);
  const middleRowCount = BOOT_LINE_COUNT - 2;
  const middle = padLines(detailLines, middleRowCount);
  return [isLargeDeployment(deployment) ? LARGE_ICON_LINE : DEPLOYED_ICON_LINE, ...middle, formatDeployedCounterLine(rank)];
}

/**
 * The deployment frame's closing bookend. With a rank from pickNextDeployed() (issue #283)
 * it says where this app sits in the day -- `>>>>>> #12 OF 125 IN 24H <<<<<<` -- which is
 * what makes the rotation through the whole list legible. Without one, the plain banner.
 * Always exactly LOGO_WIDTH columns, same arrows as DEPLOYED_ICON_LINE.
 *
 * @param {{position: number, total: number}|null} rank
 */
export function formatDeployedCounterLine(rank) {
  if (!rank || !Number.isFinite(rank.position) || !Number.isFinite(rank.total) || rank.total < 1) {
    return DEPLOYED_ICON_LINE;
  }
  const label = ` #${rank.position} OF ${rank.total} IN 24H `;
  if (label.length > LOGO_WIDTH - 2) return DEPLOYED_ICON_LINE;
  const left = Math.floor((LOGO_WIDTH - label.length) / 2);
  return '>'.repeat(left) + label + '<'.repeat(LOGO_WIDTH - label.length - left);
}

/**
 * Row kinds for formatDeploymentFrame's output: only the first/last (icon bookend)
 * rows carry the green ROW_KIND_DEPLOYED accent -- the middle NAME/AGO/INST/RES rows
 * stay ROW_KIND_TEXT, same plain terminal text as everywhere else.
 */
export function deploymentFrameKinds() {
  const kinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  kinds[0] = ROW_KIND_DEPLOYED;
  kinds[BOOT_LINE_COUNT - 1] = ROW_KIND_DEPLOYED;
  return kinds;
}

/**
 * The symmetric "latest expiring" frame -- same shape as formatDeploymentFrame, but the
 * orange diverging-arrows EXPIRING_ICON_LINE and an EXPIRE row (time until expiry) in
 * place of AGO, since expiry (not deployment recency) is the relevant time here.
 */
export function formatExpiringFrame(app) {
  const detailLines = expiringDetailLines(app);
  const middleRowCount = BOOT_LINE_COUNT - 2;
  const middle = padLines(detailLines, middleRowCount);
  return [EXPIRING_ICON_LINE, ...middle, EXPIRING_ICON_LINE];
}

/**
 * Row kinds for formatExpiringFrame's output: only the first/last (icon bookend)
 * rows carry the orange ROW_KIND_EXPIRING accent -- the middle NAME/EXPIRE/INST/RES
 * rows stay ROW_KIND_TEXT, same plain terminal text as everywhere else.
 */
export function expiringFrameKinds() {
  const kinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  kinds[0] = ROW_KIND_EXPIRING;
  kinds[BOOT_LINE_COUNT - 1] = ROW_KIND_EXPIRING;
  return kinds;
}

/**
 * Reduced-motion equivalent of formatDeploymentFrame: name + time-since-deployment +
 * instance count, no icon/resources -- those exist to fill an animated sequence, not to
 * carry information a static reader needs. Issue #127 explicitly decided this DOES gain
 * the new time-since content (the second line was blank before), for consistency with
 * formatExpiringReducedMotionLines already showing its own time-until-expiry below.
 */
export function formatDeploymentReducedMotionLines(deployment) {
  const name = truncateForBox(deployment?.name || 'unknown');
  const instances = Number.isFinite(deployment?.instances) ? deployment.instances : null;
  const deployedAgo = Number.isFinite(deployment?.blockAge)
    ? `${formatBlocksAsTime(deployment.blockAge)} ago`
    : null;
  return padLines([
    '  LATEST DEPLOYMENT',
    deployedAgo !== null ? `  ${deployedAgo}` : '',
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

// ---------------------------------------------------------------------------------------
// Pause marker (issue #282). While the pointer is over the header the rotation holds, and
// the box says so: `[ paused ]` replaces the last row's final columns, so the width -- and
// therefore the header -- never changes.
export const PAUSED_MARKER = '[ paused ]';

export function markPaused(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return lines;
  const width = Math.max(LOGO_WIDTH, ...lines.map(line => String(line).length));
  const last = String(lines.at(-1)).padEnd(width).slice(0, width - PAUSED_MARKER.length);
  return [...lines.slice(0, -1), last + PAUSED_MARKER];
}

// ---------------------------------------------------------------------------------------
// Wide detail frames (desktop, issue #345). One frame about one app, using the whole width:
// the narrow frame's NAME / AGO-or-EXPIRE / INST / RES on the left, and on the right what it
// has no room for -- what the app is (game and which one, or service), its image, and what
// was paid for it and when. No second panel repeating the same app, and nothing that is not
// about the app on screen. Mobile keeps the narrow frame.

// The left column is 4 wider than the narrow box so a full timestamped app name fits:
// projectzomboid<13 digits> is 27 characters, and the narrow frame cuts it to 25.
const WIDE_LEFT_WIDTH = LOGO_WIDTH + 4;
const WIDE_GAP = 2;
const WIDE_RIGHT_WIDTH = 40;
export const WIDE_WIDTH = WIDE_LEFT_WIDTH + WIDE_GAP + WIDE_RIGHT_WIDTH;
const DASH = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatWideField(label, value) {
  const prefix = `${label.padEnd(6)} `;
  return prefix + truncateForBox(String(value), WIDE_RIGHT_WIDTH - prefix.length);
}

/** A bookend row across the full wide frame, label centred: `>>>> NEW APP DEPLOYED <<<<`. */
function wideBookend(label, left, right) {
  const text = ` ${label} `;
  const leftCount = Math.floor((WIDE_WIDTH - text.length) / 2);
  return left.repeat(leftCount) + text + right.repeat(WIDE_WIDTH - text.length - leftCount);
}

/** 'game:Valheim' -> ['GAME', 'Valheim']; 'service:wordpress' -> ['SERVICE', 'wordpress']. */
function typeField(introKey) {
  if (typeof introKey === 'string' && introKey.includes(':')) {
    const [family, name] = introKey.split(/:(.*)/s);
    if (family === 'game') return ['GAME', name];
    if (family === 'service') return ['SERVICE', name];
  }
  return ['TYPE', 'app'];
}

// ':latest' is the default tag and says nothing; dropping it keeps a typical repotag inside
// the column instead of cutting its name short.
function imageValue(app) {
  if (app?.repo) return app.repo.replace(/:latest$/, '');
  return app?.isEnterprise ? 'private (enterprise)' : DASH;
}

/** '2026-09-16' -> 'Sep 16'. */
function shortDate(isoDate) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(isoDate || '');
  return m ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : null;
}

/**
 * The PAID value: FLUX, USD and the date on one row. A deployment only has a payment row
 * after the next revenue sync, so "not synced yet" is a real state, not a failure -- and
 * nothing here ever shows a zero.
 *
 * @param {{status: 'loading'|'none'|'ok'|'error', amount?: number, usd?: number,
 *          date?: string}|null|undefined} payment
 */
function paymentValue(payment) {
  if (!payment || payment.status === 'loading') return 'checking…';
  if (payment.status === 'error') return DASH;
  if (payment.status === 'none') return 'not synced yet';
  return [
    `${formatNumber(payment.amount, 2)} FLUX`,
    Number.isFinite(payment.usd) ? `$${formatNumber(payment.usd, 2)}` : null,
    shortDate(payment.date)
  ].filter(Boolean).join(' · ');
}

// The standard subscription lengths people pick, in blocks (30s blocks, 2,880 a day).
// Measured on the live registry 2026-09-24: 88000 x489, 20160 x159, 1056000 x113,
// 528000 x31, 264000 x26 -- everything else is a renewal-adjusted odd length.
const STANDARD_TERMS = [
  [20160, '1 week'],
  [88000, '1 month'],
  [264000, '3 months'],
  [528000, '6 months'],
  [1056000, '1 year']
];

/** 88000 -> '1 month'; within 2% of a standard length reads as it; else '~38 days'. */
export function formatTerm(expireBlocks) {
  if (!Number.isFinite(expireBlocks) || expireBlocks <= 0) return null;
  const standard = STANDARD_TERMS.find(([blocks]) => Math.abs(expireBlocks - blocks) <= blocks * 0.02);
  if (standard) return standard[1];
  const days = Math.round(expireBlocks / 2880);
  return days >= 1 ? `~${days} day${days === 1 ? '' : 's'}` : `~${formatBlocksAsTime(expireBlocks)}`;
}

/**
 * The TERM value. Deployed: the length and the day it ends ("1 month · ends Oct 24"), which
 * is what says whether this is a trial week or a year's commitment. Expiring: the length
 * alone -- the EXPIRE row beside it already says when.
 */
function termValue(app, { withEnd, nowMs }) {
  const term = formatTerm(app?.expireBlocks);
  if (!term) return DASH;
  if (!withEnd || !Number.isFinite(app?.blocksUntilExpiry) || !Number.isFinite(nowMs)) return term;
  const end = new Date(nowMs + app.blocksUntilExpiry * 30 * 1000);
  // A year's term ends on almost the same day next year: without the year, "1 year · ends
  // Sep 26" read as two days away. Any end outside the current year carries it.
  const year = end.getUTCFullYear() !== new Date(nowMs).getUTCFullYear() ? ` ${end.getUTCFullYear()}` : '';
  return `${term} · ends ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()}${year}`;
}

function wideMiddle(leftLines, app, extras, { withEnd }) {
  const [typeLabel, typeValue] = typeField(extras?.introKey);
  const right = [
    formatWideField(typeLabel, typeValue),
    formatWideField('IMAGE', imageValue(app)),
    formatWideField('PAID', paymentValue(extras?.payment)),
    formatWideField('TERM', termValue(app, { withEnd, nowMs: extras?.nowMs }))
  ];
  const left = padLines(leftLines, BOOT_LINE_COUNT - 2);
  return left.map((line, i) => String(line).padEnd(WIDE_LEFT_WIDTH + WIDE_GAP) + right[i]);
}

/**
 * Desktop deployed frame: the narrow frame's rows plus type, image and payment.
 * @param {{introKey?: string|null, payment?: object|null, nowMs?: number}} extras  nowMs dates the TERM end
 */
export function formatDeploymentFrameWide(deployment, rank = null, extras = {}) {
  const ranked = rank && Number.isFinite(rank.position) && Number.isFinite(rank.total) && rank.total >= 1;
  return [
    wideBookend(isLargeDeployment(deployment) ? 'LARGE DEPLOYMENT' : 'NEW APP DEPLOYED', '>', '<'),
    ...wideMiddle(deploymentDetailLines(deployment, WIDE_LEFT_WIDTH), deployment, extras, { withEnd: true }),
    wideBookend(ranked ? `#${rank.position} OF ${rank.total} IN 24H` : 'NEW APP DEPLOYED', '>', '<')
  ];
}

/** Desktop expiring frame: the narrow frame's rows plus type, image and payment. */
export function formatExpiringFrameWide(app, extras = {}) {
  const bookend = wideBookend('EXPIRING', '<', '>');
  return [bookend, ...wideMiddle(expiringDetailLines(app, WIDE_LEFT_WIDTH), app, extras, { withEnd: false }), bookend];
}

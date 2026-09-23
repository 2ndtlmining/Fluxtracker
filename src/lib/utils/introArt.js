// Header intro art, batch 1 (issues #272-#275): Deploy with Git (Orbit), Project Zomboid,
// Folding@home and crypto nodes.
//
// Same contract as every intro in terminalAnimation.js:
//   - a frame is BOOT_LINE_COUNT rows of exactly LOGO_WIDTH columns, built by rotating
//     fixed-length strips and overlaying art onto a blank canvas, so nothing can move the
//     box wall
//   - no row is ever empty (the header smoke harness rejects it outright)
//   - a frame is a pure function of the step, so the art never flickers between renders
//   - the only numbers shown are real ones taken from ctx; anything that merely animates
//     (hash glyphs, nonces, progress bars) is not presented as a measurement
import { formatNumber } from './format.js';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  rotateStrip,
  waveStrip,
  overlayAt
} from './terminalAnimation.js';

// Accent kinds for the new art. Games stay green (ROW_KIND_DEPLOYED); services take a colour
// of their own so a service intro never reads as a game.
export const ROW_KIND_PURPLE = 'purple';
export const ROW_KIND_BLUE = 'blue';
export const ROW_KIND_GOLD = 'gold';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;

function wrap(step) {
  return ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
}

function blankRows() {
  return Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
}

function centre(text) {
  const clipped = text.slice(0, LOGO_WIDTH);
  const left = Math.floor((LOGO_WIDTH - clipped.length) / 2);
  return (' '.repeat(left) + clipped).padEnd(LOGO_WIDTH);
}

const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);

// =======================================================================================
// #272 Deploy with Git (Orbit): a feature branch grows, merges into main, and a push fills
// a progress bar -- which is what actually happened: code was pushed and deployed.
// =======================================================================================

// Main's commits march left. 24 columns is a whole number of '*---' periods, so the
// rotation has no seam; the label and the right margin stay put.
const GIT_MAIN = '*---'.repeat(6);
const GIT_BRANCH_COLUMN = 13;   // the '\' leaving main
const GIT_FEAT_COLUMN = 14;     // the branch's first commit
const GIT_MERGE_COLUMN = 28;    // the '/' rejoining main
const GIT_MERGE_STEP = 6;
const GIT_BAR_WIDTH = 22;

export const ORBIT_FRAME_COUNT = FRAME_COUNT;

export function formatOrbitFrame(step = 0) {
  const index = wrap(step);
  const merged = index >= GIT_MERGE_STEP;
  const rows = blankRows();

  rows[0] = ('  main  ' + rotateStrip(GIT_MAIN, index)).padEnd(LOGO_WIDTH);
  // The merge commit, with its own edges so it never butts against a marching commit.
  if (merged) rows[0] = overlayAt(rows[0], GIT_MERGE_COLUMN, '-@-');

  rows[1] = overlayAt(rows[1], GIT_BRANCH_COLUMN, BSLASH);
  if (merged) rows[1] = overlayAt(rows[1], GIT_MERGE_COLUMN, '/');

  // The branch grows one commit per step for its first three steps, then holds; once
  // merged, its tail runs up to the merge.
  const commits = Math.min(index, 3);
  const branch = '*' + '---*'.repeat(commits) + (merged ? '-' : '');
  rows[2] = overlayAt('  feat'.padEnd(LOGO_WIDTH), GIT_FEAT_COLUMN, branch);

  // The push is on its way: marching dots until the merge, then the destination.
  rows[3] = merged
    ? overlayAt(rows[3], 22, '[ orbit ]')
    : overlayAt(rows[3], 18, rotateStrip('.  .  .  >  ', index * 2).slice(0, 12));

  rows[4] = '  $ git push flux main'.padEnd(LOGO_WIDTH);

  // Fills column by column over the sequence; OK on the last step.
  const done = index === FRAME_COUNT - 1;
  const filled = done ? GIT_BAR_WIDTH : Math.round((GIT_BAR_WIDTH * (index + 1)) / FRAME_COUNT);
  const bar = '='.repeat(Math.max(0, filled - 1)) + (done ? '=' : '>') + ' '.repeat(GIT_BAR_WIDTH - filled);
  rows[5] = `  [${bar}] ${done ? 'OK' : `${Math.round((100 * (index + 1)) / FRAME_COUNT)}%`}`.padEnd(LOGO_WIDTH);

  return rows;
}

export const orbitFrameKinds = kindsOf(ROW_KIND_PURPLE);

// =======================================================================================
// #273 Project Zomboid: a zombie shambles toward a boarded-up house and stops at the boards
// -- this is a successful deployment, so nothing breaks (the creeper's reasoning, #199).
// =======================================================================================

const ZOMBOID_SKY = centre('.  *     DAY 1     *   .');
const ZOMBOID_HOUSE = [
  ' ___________',
  '|=|=|=|=|=|=|',
  '|=|=|=|=|=|=|',
  '|_|_|_|_|_|_|'
];
const ZOMBOID_HOUSE_COLUMN = 2;
const ZOMBOID_GRASS = waveStrip(',,,,..');
// Head, arms, body, legs. The legs alternate between two poses of equal width, so the
// sprite's footprint is the same in every frame.
const ZOMBIE_TOP = ['_o_', '/|' + BSLASH, ' | '];
const ZOMBIE_LEGS = ['/ ' + BSLASH, '|' + BSLASH + ' '];
// One column nearer each step, then stopped at the boards (the wall ends at column 14).
const ZOMBIE_COLUMNS = [22, 21, 20, 19, 18, 17, 16, 16];

export const ZOMBOID_FRAME_COUNT = FRAME_COUNT;

export function formatZomboidFrame(step = 0) {
  const index = wrap(step);
  const rows = blankRows();
  rows[0] = ZOMBOID_SKY;
  ZOMBOID_HOUSE.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], ZOMBOID_HOUSE_COLUMN, art); });
  rows[BOOT_LINE_COUNT - 1] = rotateStrip(ZOMBOID_GRASS, index);

  const column = ZOMBIE_COLUMNS[index];
  const sprite = [...ZOMBIE_TOP, ZOMBIE_LEGS[index % 2]];
  sprite.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], column, art); });
  return rows;
}

// A game: the green deployment accent, like every other game intro.
export const zomboidFrameKinds = kindsOf('deployed');

// =======================================================================================
// #274 Folding@home: a rotating double helix -- the largest single service on the network.
// Five period-4 strips rotated by the step, so the strands travel and twist; 'o' and 'O'
// swap between the two strands each step to fake depth. No "work unit" counter: there is
// no real figure to show, and the header never invents one.
// =======================================================================================

// 36 columns is a whole number of periods, so rotating then slicing to 34 has no seam.
const helixStrip = pattern => pattern.repeat(9);
const HELIX_PATTERNS = ['  X ', ' / ' + BSLASH, 'o   ', ' ' + BSLASH + ' /', '  Y '];
const FOLD_BAR_WIDTH = 8;

export const FOLDING_FRAME_COUNT = FRAME_COUNT;

export function formatFoldingFrame(step = 0) {
  const index = wrap(step);
  const near = index % 2 === 0 ? 'O' : 'o';
  const far = index % 2 === 0 ? 'o' : 'O';
  const rows = HELIX_PATTERNS.map(pattern => {
    const strip = helixStrip(pattern.replace('X', near).replace('Y', far));
    return rotateStrip(strip, index).slice(0, LOGO_WIDTH);
  });
  const filled = Math.min(FOLD_BAR_WIDTH, index + 1);
  const bar = '#'.repeat(filled) + '.'.repeat(FOLD_BAR_WIDTH - filled);
  rows.push(`  FOLDING@HOME  folding [${bar}]`.padEnd(LOGO_WIDTH));
  return rows;
}

export const foldingFrameKinds = kindsOf(ROW_KIND_BLUE);

// =======================================================================================
// #275 Crypto node: blocks chained together, the newest being mined, and the chain's REAL
// block height underneath. The hash glyphs and nonce only animate the mining -- they come
// from fixed tables (never Math.random), so a frame is a pure function of the step -- and
// the height is ctx.blockHeight, shown as-is: it does not tick up, because "height + 1"
// would be a block that does not exist yet.
// =======================================================================================

const CHAIN_HASHES = ['a4f', '9c1', '07e', 'b52', '3d8'];
const MINING_GLYPHS = ['????', '#???', '?#??', '??#?', '???#', '?#?#', '#?#?', '????'];
const NONCES = [318, 552, 107, 849, 263, 690, 947, 431];
const CHAIN_SHIFT_STEP = 6;
const CHAIN_BORDER = '  ' + Array(4).fill('+----+').join('  ') + '  ';

export const CRYPTO_FRAME_COUNT = FRAME_COUNT;

/** @param {{blockHeight?: number|null}} ctx */
export function formatCryptoFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  // On the shift step the block being mined joins the chain, and every block moves left.
  const first = index >= CHAIN_SHIFT_STEP ? 1 : 0;
  const cells = CHAIN_HASHES.slice(first, first + 3).map(hash => `|#${hash}|`);
  cells.push(`|${MINING_GLYPHS[index]}|`);

  const height = Number.isFinite(ctx.blockHeight) ? formatNumber(ctx.blockHeight) : '—';
  return [
    CHAIN_BORDER,
    ('  ' + cells.join('--')).padEnd(LOGO_WIDTH),
    CHAIN_BORDER,
    `nonce ${NONCES[index]}  `.padStart(LOGO_WIDTH),
    `  height ${height}   mining...`.padEnd(LOGO_WIDTH),
    centre('$$$ NEW NODE SYNCING CHAIN $$$')
  ];
}

export const cryptoFrameKinds = kindsOf(ROW_KIND_GOLD);

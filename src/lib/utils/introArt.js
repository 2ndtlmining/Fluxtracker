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
  ROW_KIND_TEXT,
  ROW_KIND_EXPIRING,
  ROW_KIND_DEPLOYED,
  EXPIRING_ICON_LINE,
  rotateStrip,
  waveStrip,
  overlayAt,
  formatBlocksAsTime
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

export function formatZomboidFrame(step = 0, _ctx = {}, columns = ZOMBIE_COLUMNS) {
  const index = wrap(step);
  const rows = blankRows();
  rows[0] = ZOMBOID_SKY;
  ZOMBOID_HOUSE.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], ZOMBOID_HOUSE_COLUMN, art); });
  rows[BOOT_LINE_COUNT - 1] = rotateStrip(ZOMBOID_GRASS, index);

  const column = columns[index];
  const sprite = [...ZOMBIE_TOP, ZOMBIE_LEGS[index % 2]];
  sprite.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], column, art); });
  return rows;
}

// A game: the green deployment accent, like every other game intro.
export const zomboidFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Issue #182 outro: the zombie turns from the boards and shambles off to the right.
const ZOMBIE_DEPART = [16, 18, 20, 22, 24, 26, 28, 30];

export function formatZomboidOutro(step = 0) {
  return formatZomboidFrame(step, {}, ZOMBIE_DEPART);
}

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

// =======================================================================================
// #182 fallback: a fuse burning toward the app. Every expiring app without an outro of its
// own -- most non-game apps, and games without art -- plays this. The spark travels right
// to left along a fixed-length fuse (a moving column, never a changing string length); the
// burnt part turns to '-', and the app block goes dark when the spark arrives. The row
// under it is the REAL time left, from the app's blocksUntilExpiry.
// Keeps the EXPIRING bookends on rows 0 and 5, so it reads as part of the expiring frame.
// =======================================================================================

const FUSE_START = 9;                    // first fuse column, right after the block
const FUSE_END = LOGO_WIDTH - 3;         // last fuse column
const FUSE_SPARK_COLUMNS = [31, 28, 25, 22, 19, 16, 13, 9];
const FUSE_SPARKLES = [".'", "'.", '*.', '.*', "'.", ".'", '*.', '  '];
const FUSE_BOX_EDGE = '  +-----+';

export const FUSE_FRAME_COUNT = FRAME_COUNT;

/** @param {{app?: {blocksUntilExpiry?: number}}} ctx */
export function formatFuseFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const spark = FUSE_SPARK_COLUMNS[index];
  const arrived = index === FRAME_COUNT - 1;

  let fuse = '';
  for (let column = FUSE_START; column <= FUSE_END; column++) {
    if (column === spark && !arrived) fuse += '*';
    else fuse += column < spark ? '=' : '-';
  }
  const block = arrived ? '| ... |' : '| APP |';
  const left = ctx.app?.blocksUntilExpiry;
  const timeLeft = Number.isFinite(left) ? `${formatBlocksAsTime(Math.max(0, left))} left` : 'time running out';

  return [
    EXPIRING_ICON_LINE,
    overlayAt(FUSE_BOX_EDGE.padEnd(LOGO_WIDTH), Math.max(FUSE_START, spark - 1), FUSE_SPARKLES[index]),
    ('  ' + block + fuse).slice(0, LOGO_WIDTH).padEnd(LOGO_WIDTH),
    FUSE_BOX_EDGE.padEnd(LOGO_WIDTH),
    `  ${timeLeft}`.padEnd(LOGO_WIDTH),
    EXPIRING_ICON_LINE
  ];
}

/** Bookends in the expiring accent, the burning fuse in plain terminal text. */
export function fuseFrameKinds() {
  const kinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  kinds[0] = ROW_KIND_EXPIRING;
  kinds[BOOT_LINE_COUNT - 1] = ROW_KIND_EXPIRING;
  return kinds;
}

// =======================================================================================
// #181 fallback: a crane lowers a container onto a stack. Every deployment without art of
// its own plays this -- it animates what actually happened (a container landed) rather
// than a mascot. The stack is the app's REAL instance count, 1 to 3 cells of fixed width,
// so the art reports something true about the deployment.
// =======================================================================================

const CRANE_CELL = '[#]';
const CRANE_STACK_COLUMN = 12;
const CRANE_TOWER_COLUMN = 3;
const CRANE_JIB = ('  _|' + '='.repeat(LOGO_WIDTH - 8)).padEnd(LOGO_WIDTH);
const CRANE_GROUND = ('  ' + '='.repeat(LOGO_WIDTH - 4)).padEnd(LOGO_WIDTH);
// The container's row on each step until it lands (row 4); then the empty hook's row as it
// rises back up, and on the last two steps the trolley runs back along the jib.
const CRANE_LOAD_ROWS = [1, 2, 3];
const CRANE_HOOK_ROWS = [null, null, null, 3, 2, 1, 1, 1];
const CRANE_TROLLEY_SHIFT = [0, 0, 0, 0, 0, 0, 3, 6];
const CRANE_DUST = [null, null, null, '.   .', "'   '", null, null, null];

export const CRANE_FRAME_COUNT = FRAME_COUNT;

/** @param {{app?: {instances?: number}}} ctx */
export function formatCraneFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const instances = Number.isFinite(ctx.app?.instances) ? ctx.app.instances : 1;
  const cells = Math.min(3, Math.max(1, instances));
  const landing = CRANE_STACK_COLUMN + CRANE_CELL.length * (cells - 1);
  const hook = landing + 1 + CRANE_TROLLEY_SHIFT[index];

  const rows = blankRows();
  // Jib across the top with the trolley over the hook; the tower down the left keeps
  // rows 1-4 non-empty whatever the load is doing.
  rows[0] = overlayAt(CRANE_JIB, hook - 1, '[_]');
  for (let row = 1; row < BOOT_LINE_COUNT - 1; row++) rows[row] = overlayAt(rows[row], CRANE_TOWER_COLUMN, '|');
  rows[BOOT_LINE_COUNT - 1] = CRANE_GROUND;

  const landed = index >= CRANE_LOAD_ROWS.length;
  const stackCount = landed ? cells : cells - 1;
  for (let i = 0; i < stackCount; i++) {
    rows[4] = overlayAt(rows[4], CRANE_STACK_COLUMN + CRANE_CELL.length * i, CRANE_CELL);
  }

  if (!landed) {
    const loadRow = CRANE_LOAD_ROWS[index];
    for (let row = 1; row < loadRow; row++) rows[row] = overlayAt(rows[row], hook, '|');
    rows[loadRow] = overlayAt(rows[loadRow], landing, CRANE_CELL);
  } else {
    const hookRow = CRANE_HOOK_ROWS[index];
    for (let row = 1; row < hookRow; row++) rows[row] = overlayAt(rows[row], hook, '|');
    rows[hookRow] = overlayAt(rows[hookRow], hook, 'J');
    // Dust on the row above the stack, so it can never overwrite a neighbouring container.
    if (CRANE_DUST[index]) rows[3] = overlayAt(rows[3], landing - 1, CRANE_DUST[index]);
  }
  return rows;
}

export const craneFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

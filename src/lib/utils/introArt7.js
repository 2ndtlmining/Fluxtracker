// Header intro art, batch 7 (issue #518): Hytale, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intro is green
// (ROW_KIND_DEPLOYED); the outro is keyed like the intro and plays in orange
// (outroFrameKinds, applied by the component).
import { PLAIN_SKY } from './seasons.js';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH7_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Hytale: an adventurer with a sword walks out of a blocky grove towards a tower that
// builds itself block by block, and plants a flag on it. The outro: the Void tears open at
// the right edge, creeps along the ground and eats the tower from the top down while the
// adventurer runs back to the trees.
// =======================================================================================

// Rows 0-4, against the left edge: a voxel tree.
const TREE = [' ### ', '#####', ' ### ', '  |  ', '  |  '];
const GRASS = '"=#="=#'.repeat(5);
// Rows 2-4. Facing right with the sword out front, and facing left (running away).
const HERO_RIGHT = [' o', '/|=-'];
const HERO_LEFT = ['  o', '-=|' + BSLASH];
const HERO_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
const TOWER_COLUMN = 27;
const BLOCK = '[][]';
const FLAG = ' |>';
const VOID = '{%}';

function hytaleScene() {
  const rows = blankRows();
  TREE.forEach((art, i) => { rows[i] = overlayAt(rows[i], 0, art); });
  rows[5] = GRASS.slice(0, LOGO_WIDTH);
  return rows;
}

// Stacks `height` blocks up from row 4; a finished tower (4 blocks) carries the flag on row 0.
function towerOf(rows, height, flag) {
  for (let b = 0; b < height; b++) rows[4 - b] = overlayAt(rows[4 - b], TOWER_COLUMN, BLOCK);
  if (flag) rows[0] = overlayAt(rows[0], TOWER_COLUMN, FLAG);
}

function heroAt(rows, column, art, step) {
  rows[2] = overlayAt(rows[2], column, art[0]);
  rows[3] = overlayAt(rows[3], column, art[1]);
  rows[4] = overlayAt(rows[4], column, HERO_LEGS[step % 2]);
}

// The tower's height each step: a block every other frame, flag on the last.
const BUILD = [1, 1, 2, 2, 3, 3, 4, 4];

export function formatHytaleFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = hytaleScene();
  rows[0] = overlayAt(rows[0], 7 + (index % 4) * 3, skyOf(ctx).wisp);
  towerOf(rows, BUILD[index], index === FRAME_COUNT - 1);
  heroAt(rows, 7 + index * 2, HERO_RIGHT, index);
  return rows;
}

export const hytaleFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The tower's height each step as the Void eats it from the top.
const DECAY = [4, 4, 3, 3, 2, 2, 1, 0];

export function formatHytaleOutro(step = 0) {
  const index = wrap(step);
  const rows = hytaleScene();
  towerOf(rows, DECAY[index], index < 2);
  // The rift stays open at the right edge; its corruption spreads left along the grass.
  rows[3] = overlayAt(rows[3], LOGO_WIDTH - VOID.length, VOID);
  const reach = (index + 1) * 3;
  rows[5] = rows[5].slice(0, LOGO_WIDTH - reach) + '~%'.repeat(reach).slice(0, reach);
  heroAt(rows, 21 - index * 2, HERO_LEFT, index);
  return rows;
}

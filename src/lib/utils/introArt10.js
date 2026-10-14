// Header intro art, batch 10 (issue #525): Unturned, live on the Flux games hub.
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
export const BATCH10_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Unturned: a survivor walks out of the pines to a supply crate, loots it and shoulders
// the backpack, then boards up a barricade plank by plank. The outro: the horde shambles
// in from the right, tears the planks down top first, and the survivor runs for the trees.
// =======================================================================================

// Rows 1-4, against the left edge: a blocky pine.
const PINE = ['  A  ', ' /A' + BSLASH + ' ', '/AAA' + BSLASH, '  H  '];
const GRASS = ",.'\",.'".repeat(5).slice(0, LOGO_WIDTH);
// Rows 2-4: the survivor, without and then with the backpack (the 'D' on the back).
const SURVIVOR = [' o ', '/|' + BSLASH];
const SURVIVOR_PACKED = [' o ', 'D|' + BSLASH];
const SURVIVOR_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
// Fleeing left: the pack on the other side.
const SURVIVOR_FLEE = [' o ', '/|D'];
const CRATE_COLUMN = 12;
const CRATE_SHUT = '[+]';
const CRATE_OPEN = '[ ]';
const BARRICADE_COLUMN = 24;
const PLANK = '|=|=|';
// Rows 2-4, facing left with its arms out: a zombie, two shambling strides.
const ZOMBIE = [' o', '=|'];
const ZOMBIE_LEGS = ['/ ' + BSLASH, '|' + BSLASH + ' '];

function unturnedScene() {
  const rows = blankRows();
  PINE.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], 0, art); });
  rows[5] = GRASS;
  return rows;
}

function figureAt(rows, column, top, legs) {
  rows[2] = overlayAt(rows[2], column, top[0]);
  rows[3] = overlayAt(rows[3], column, top[1]);
  rows[4] = overlayAt(rows[4], column, legs);
}

// Planks stacked up from row 4, `count` of them.
function barricadeOf(rows, count) {
  for (let p = 0; p < count; p++) rows[4 - p] = overlayAt(rows[4 - p], BARRICADE_COLUMN, PLANK);
}

// The intro: walk to the crate (0-2), loot it (3), carry the pack to the barricade site
// and nail up three planks (4-7).
const SURVIVOR_COLUMN = [5, 7, 9, 9, 15, 19, 19, 19];
const PLANKS = [0, 0, 0, 0, 0, 1, 2, 3];

export function formatUnturnedFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = unturnedScene();
  rows[0] = overlayAt(rows[0], 8 + (index % 4) * 3, skyOf(ctx).wisp);
  rows[1] = overlayAt(rows[1], 30 - (index % 4) * 2, skyOf(ctx).wisp);
  rows[4] = overlayAt(rows[4], CRATE_COLUMN, index >= 3 ? CRATE_OPEN : CRATE_SHUT);
  // The loot, popping out of the opened crate.
  if (index === 3) rows[3] = overlayAt(rows[3], CRATE_COLUMN, ' + ');
  barricadeOf(rows, PLANKS[index]);
  figureAt(rows, SURVIVOR_COLUMN[index], index >= 4 ? SURVIVOR_PACKED : SURVIVOR,
    SURVIVOR_LEGS[index % 2]);
  // The hammer swing while building.
  if (index >= 5) rows[2] = overlayAt(rows[2], 22, index % 2 ? '/' : '-');
  return rows;
}

export const unturnedFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: two zombies close in from the right edge, the planks come down top first,
// and the survivor turns and runs for the pines.
// The horde holds at the barricade's face (column 30) until the last plank is down.
const STANDING = [3, 3, 2, 2, 1, 1, 0, 0];
const LEAD_COLUMN = [31, 30, 30, 30, 30, 30, 26, 22];
const FLEE_COLUMN = [19, 19, 17, 14, 11, 8, 6, 6];

export function formatUnturnedOutro(step = 0) {
  const index = wrap(step);
  const rows = unturnedScene();
  rows[4] = overlayAt(rows[4], CRATE_COLUMN, CRATE_OPEN);
  barricadeOf(rows, STANDING[index]);
  // A fallen plank on the grass for every one torn down.
  for (let p = STANDING[index]; p < 3; p++) rows[4] = overlayAt(rows[4], 15 + 3 * p, '_=_');
  const lead = LEAD_COLUMN[index];
  figureAt(rows, lead, ZOMBIE, ZOMBIE_LEGS[index % 2]);
  figureAt(rows, lead + 4, ZOMBIE, ZOMBIE_LEGS[(index + 1) % 2]);
  figureAt(rows, FLEE_COLUMN[index], index >= 2 ? SURVIVOR_FLEE : SURVIVOR_PACKED,
    SURVIVOR_LEGS[index % 2]);
  // A moan from the horde.
  rows[1] = overlayAt(rows[1], 22 + (index % 2) * 2, index % 2 ? 'uhh' : 'rrr');
  rows[0] = overlayAt(rows[0], 10 + (index % 4) * 3, PLAIN_SKY.wisp);
  return rows;
}

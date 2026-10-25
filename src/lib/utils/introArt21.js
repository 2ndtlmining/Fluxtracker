// Header intro art, batch 21: Sons of the Forest, live on the Flux games hub.
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
export const BATCH21_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Sons of the Forest: every game opens the same way. A helicopter searching the island
// goes down over the forest and the player crawls out of the wreck. The intro is that
// crash: the helicopter spins down out of the sky trailing smoke, hits the ground in a
// burst short of the pines, and the survivor crawls out, stands and raises his axe. The
// outro is the island's cannibals: eyes open in the pines, painted men come out of the
// trees with spears, the survivor hides in the wreck, and they stamp out his fire.
// (Arma Reforger's helicopter lands; this one does not.)
// =======================================================================================

// Rows 1-4, against the right edge: two pines, the island's forest.
const PINE = ['  ^  ', ' /^' + BSLASH + ' ', '/^^^' + BSLASH, '  |  '];
const PINES = [24, 29];

// Row 5: the forest floor, the scene's signature: it is in every frame of both sequences,
// and nothing else in the header draws it.
const FLOOR = ',.^.,_'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The helicopter in autorotation: rotor over cabin, the cabin turning to face the other
// way each frame as it spins down. The cabin row is the one the header smoke watches.
const ROTORS = [' -=+=- ', ' =-+-= '];
const SPIN = ['=-[_o]>', '<[o_]-='];
// The impact, three rows.
const BURST = [BSLASH + ' | /', '-*#*-', '/ | ' + BSLASH];
// The wreck on the ground: the rotor snapped, the cabin on its side, and empty -- or with
// the survivor hiding in it.
const WRECK = [' _' + BSLASH + '_', '[x_]-/'];
const HIDING = '[o_]-/';

// The survivor: head on row 3, body on row 4, legs on the floor row.
const SURVIVOR = [' o ', '/|' + BSLASH];
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
// Standing with his axe raised: its head above his hand.
const AXE_UP = ['  P', ' o/', '/| '];

// A cannibal: painted head, a spear held out to the left, the way he walks.
const CANNIBAL = ['  @ ', '<-/|' + BSLASH];

// The campfire, two flames, and the smoke left when it is stamped out.
const FIRE = ['}{', '{}'];

function world(ctx) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 28, sky.sun);
  for (const column of PINES) draw(rows, 1, column, PINE);
  rows[5] = FLOOR;
  return rows;
}

function survivor(rows, column, stride = 0) {
  draw(rows, 3, column, SURVIVOR);
  put(rows, 5, column, STRIDES[stride % 2]);
}

function cannibal(rows, column, stride) {
  draw(rows, 3, column, CANNIBAL);
  put(rows, 5, column + 2, STRIDES[stride % 2]);
}

// Per intro frame: the helicopter comes in from the left trailing smoke (0-1), spinning,
// and drops (2-3); it hits the ground in a burst (4); the wreck smokes (5-7) while the
// survivor crawls out (5), stands (6) and raises his axe (7).
const INTRO_HELI = [[-1, 0], [4, 0], [9, 1], [13, 2], null, null, null, null];
const CRASH = 16;

export function formatSonsOfTheForestFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx);
  const heli = INTRO_HELI[index];
  if (heli !== null) {
    const [column, top] = heli;
    put(rows, top, column, ROTORS[index % 2]);
    put(rows, top + 1, column, SPIN[index % 2]);
    // The smoke trail, behind it and up the way it came.
    put(rows, top + 1, column - 3, '~~');
    if (top > 0) put(rows, top - 1, column - 6, '~');
  }
  if (index === 4) draw(rows, 2, CRASH, BURST);
  if (index > 4) {
    draw(rows, 3, CRASH, WRECK);
    // Smoke rising off the wreck, wavering a column each frame.
    put(rows, 1, CRASH + 2 + (index % 2), '(');
    put(rows, 2, CRASH + 3 - (index % 2), ')');
  }
  if (index === 5) put(rows, 4, CRASH - 3, 'o_/');
  if (index === 6) survivor(rows, CRASH - 4);
  if (index === 7) {
    draw(rows, 2, CRASH - 4, AXE_UP);
    put(rows, 5, CRASH - 4, STRIDES[0]);
  }
  return rows;
}

export const sonsOfTheForestFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the survivor stands at his fire by the wreck (0); eyes open in the
// pines (1-2); a cannibal steps out of the trees and he sees him (3); more come on and he
// runs for the wreck (4) and hides in it (5-7); they reach the fire (6) and stamp it out,
// and the first raises his spear over the camp (7).
const OUTRO_WRECK = 1;
const OUTRO_FIRE = 12;
const OUTRO_EYES = [[], [[2, 26]], [[2, 26], [3, 31]], [], [], [], [], []];
const OUTRO_CANNIBALS = [[], [], [], [26], [22, 28], [18, 25], [14, 21], [14, 20]];
const OUTRO_SURVIVOR = [16, 16, 16, 16, 8, null, null, null];

export function formatSonsOfTheForestOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx);
  draw(rows, 3, OUTRO_WRECK, WRECK);
  if (index >= 5) put(rows, 4, OUTRO_WRECK, HIDING);
  if (index < 6) put(rows, 4, OUTRO_FIRE, FIRE[index % 2]);
  else put(rows, 3, OUTRO_FIRE + index - 6, '~');
  for (const [row, column] of OUTRO_EYES[index]) put(rows, row, column, '**');
  const at = OUTRO_SURVIVOR[index];
  // Standing still at the fire; running, he strides.
  if (at !== null) survivor(rows, at, index === 4 ? 1 : 0);
  if (index === 3) put(rows, 2, at + 1, '!');
  OUTRO_CANNIBALS[index].forEach((column, i) => cannibal(rows, column, index + i));
  if (index === 7) put(rows, 2, OUTRO_CANNIBALS[7][0] + 3, '/');
  return rows;
}

// Header intro art, batch 11 (issue #526): Don't Starve Together, live on the Flux games hub.
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
export const BATCH11_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Don't Starve Together: at dusk, Wilson walks in with an armful of logs, lights a
// campfire, and the Crock Pot beside it starts to steam. The outro: night falls -- the
// dark closes in from both edges, the fire gutters out, and eyes open in the dark.
// =======================================================================================

// Tufts of grass, a twig, a tuft.
const GROUND = "v,.'v.,'".repeat(5).slice(0, LOGO_WIDTH);
// Rows 1-4: Wilson -- the spiked hair is the giveaway.
const WILSON = ['VVV', ' o ', '/|' + BSLASH];
const WILSON_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
const LOGS = '=';
const FIRE_COLUMN = 15;
// The fire: unlit logs, a spark, then two flicker phases; rows 3-4.
const FIRE_UNLIT = ['   ', '>X<'];
const FIRE_SPARK = [' * ', '>X<'];
const FIRE_LIT = [['(^)', '>X<'], [')^(', '>X<']];
const POT_COLUMN = 22;
// Rows 2-4: the Crock Pot, lid, belly and its three legs.
const CROCK_POT = [' ___ ', '(___)', '/ | ' + BSLASH];
// Rising steam, drifting as it climbs.
const STEAM = ['s', ' s', 's '];
const EYES = 'o o';
const DARK = ':';

function dstScene() {
  const rows = blankRows();
  rows[5] = GROUND;
  CROCK_POT.forEach((art, i) => { rows[2 + i] = overlayAt(rows[2 + i], POT_COLUMN, art); });
  return rows;
}

function wilsonAt(rows, column, step) {
  rows[1] = overlayAt(rows[1], column, WILSON[0]);
  rows[2] = overlayAt(rows[2], column, WILSON[1]);
  rows[3] = overlayAt(rows[3], column, WILSON[2]);
  rows[4] = overlayAt(rows[4], column, WILSON_LEGS[step % 2]);
}

function fireOf(rows, art) {
  rows[3] = overlayAt(rows[3], FIRE_COLUMN, art[0]);
  rows[4] = overlayAt(rows[4], FIRE_COLUMN, art[1]);
}

// The intro: Wilson walks in carrying logs (0-2), sets them down and strikes a spark (3),
// the fire catches (4-7) and the pot steams from step 5.
const WILSON_COLUMN = [0, 3, 6, 9, 10, 10, 10, 10];

export function formatDstFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = dstScene();
  // Dusk: the sun sinks towards the horizon on the right.
  rows[index < 4 ? 0 : 1] = overlayAt(rows[index < 4 ? 0 : 1], 27 + (index % 4), skyOf(ctx).sun);
  rows[0] = overlayAt(rows[0], 4 + (index % 4) * 3, skyOf(ctx).wisp);
  wilsonAt(rows, WILSON_COLUMN[index], index);
  if (index < 3) {
    // The armful of logs, carried in front.
    rows[3] = overlayAt(rows[3], WILSON_COLUMN[index] + 3, LOGS.repeat(2));
  } else {
    fireOf(rows, index === 3 ? FIRE_SPARK : FIRE_LIT[index % 2]);
    if (index === 3) rows[4] = overlayAt(rows[4], FIRE_COLUMN, FIRE_UNLIT[1]);
  }
  // Steam from the lid, climbing a row each step from 5.
  if (index >= 5) {
    for (let r = 1; r >= 7 - index - 1 && r >= 0; r--) {
      rows[r] = overlayAt(rows[r], POT_COLUMN + 2, STEAM[(index + r) % STEAM.length]);
    }
  }
  return rows;
}

export const dstFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the dark advances from both edges, the fire shrinks to embers and goes out,
// and once the dark is deep enough two pairs of eyes open in it.
const DARK_WIDTH = [0, 2, 4, 6, 8, 10, 13, 17];
const FIRE_OUT = [
  ['(^)', '>X<'], [')^(', '>X<'], [' ^ ', '>X<'], [' ^ ', '>X<'],
  [' . ', '>X<'], [' . ', '>X<'], ['   ', '>.<'], ['   ', '___']
];

export function formatDstOutro(step = 0) {
  const index = wrap(step);
  const rows = dstScene();
  wilsonAt(rows, 10, index);
  fireOf(rows, FIRE_OUT[index]);
  rows[0] = overlayAt(rows[0], 6 + (index % 4) * 3, PLAIN_SKY.wisp);
  // The dark: whole columns from each edge, ground included.
  const width = DARK_WIDTH[index];
  for (let r = 0; r < BOOT_LINE_COUNT; r++) {
    rows[r] = overlayAt(rows[r], 0, DARK.repeat(width));
    rows[r] = overlayAt(rows[r], LOGO_WIDTH - width, DARK.repeat(width));
  }
  // Eyes in the dark once it is three columns deep; they blink on odd steps.
  if (width >= 4) {
    const open = index % 2 === 0 ? EYES : '- -';
    rows[2] = overlayAt(rows[2], 0, ' '.repeat(0) + open);
    rows[1] = overlayAt(rows[1], LOGO_WIDTH - 3, open);
  }
  return rows;
}

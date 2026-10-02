// Header intro art, batch 5 (issue #505): 7 Days to Die, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real -- so no day
// counter, even though the game is named for one. Intro is green (ROW_KIND_DEPLOYED); the
// outro is keyed like the intro and plays in orange (outroFrameKinds, applied by the
// component).
import { PLAIN_SKY } from './seasons.js';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH5_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// 7 Days to Die: a survivor hammers spikes into the barricade in front of their shack while
// zombies shamble in from the right and pile up against it -- the base holds. The outro is
// the seventh night: a blood moon rises, the spikes break one by one and the horde pours
// through to the door.
// =======================================================================================

// Rows 1-4.
const SHACK = ['  ____', ' /____' + BSLASH, ' |[] |', ' |__[|'];
const SURVIVOR_COLUMN = 8;
// The hammer up, then down on the spikes.
const SURVIVOR_POSES = [
  [' o T', '/|/', '/ ' + BSLASH],
  [' o', '/|' + BSLASH + '_T', '/ ' + BSLASH]
];
const BARRICADE_COLUMN = 13;
// Rows 2-4: sharpened stakes pointing out at the horde.
const SPIKES = ['>-', '>=', '>-'];
const BROKEN_SPIKES = ['  ', ' /', '_.'];
// Arms out in front, lurching left. Two leg poses so the shamble shows.
const ZOMBIE = ['_o', ' |' + BSLASH];
const ZOMBIE_LEGS = ['/ |', ' /' + BSLASH];
const DIRT = '_.,__,.__,._'.repeat(3);

function zombieAt(rows, column, step) {
  if (column === null || column >= LOGO_WIDTH) return;
  rows[2] = overlayAt(rows[2], column, ZOMBIE[0]);
  rows[3] = overlayAt(rows[3], column, ZOMBIE[1]);
  rows[4] = overlayAt(rows[4], column, ZOMBIE_LEGS[step % 2]);
}

function sevenDaysScene({ spikesLeft, survivorPose }) {
  const rows = blankRows();
  SHACK.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], 0, art); });
  SPIKES.forEach((art, i) => {
    rows[2 + i] = overlayAt(rows[2 + i], BARRICADE_COLUMN, i < spikesLeft ? art : BROKEN_SPIKES[i]);
  });
  if (survivorPose !== null) {
    SURVIVOR_POSES[survivorPose].forEach((art, i) => {
      rows[2 + i] = overlayAt(rows[2 + i], SURVIVOR_COLUMN, art);
    });
  }
  rows[5] = DIRT.slice(0, LOGO_WIDTH);
  return rows;
}

// The horde's columns each step: shambling in, then stopped by the stakes at column 16.
const INTRO_HORDE = [
  [26, null], [24, 32], [22, 30], [20, 28], [18, 26], [16, 24], [16, 22], [16, 20]
];

export function formatSevenDaysFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = sevenDaysScene({ spikesLeft: SPIKES.length, survivorPose: index % 2 });
  rows[0] = overlayAt(rows[0], 4, skyOf(ctx).sun);
  rows[0] = overlayAt(rows[0], 14 + (index % 4) * 3, skyOf(ctx).wisp);
  INTRO_HORDE[index].forEach(column => zombieAt(rows, column, index));
  return rows;
}

export const sevenDaysFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The blood moon climbs across row 0: [column, glyph]. Always this, never the season's sky
// -- the seventh night is the point of the scene.
const BLOOD_MOON = [[30, '.'], [28, '(.'], [26, '(@)'], [24, '(@)'], [22, '(@)'], [20, '(@)'], [18, '(@)'], [16, '(@)']];
// Stakes still standing each step, and the horde's columns: it hits the barricade,
// breaks it and reaches the shack door.
const OUTRO_SPIKES = [3, 3, 2, 2, 1, 1, 0, 0];
const OUTRO_HORDE = [
  [16, 20, 24], [16, 19, 23], [16, 19, 22], [15, 18, 22], [14, 18, 21], [12, 16, 20], [9, 13, 17], [7, 11, 15]
];

export function formatSevenDaysOutro(step = 0) {
  const index = wrap(step);
  // The survivor has already gone inside and barred the door.
  const rows = sevenDaysScene({ spikesLeft: OUTRO_SPIKES[index], survivorPose: null });
  const [column, moon] = BLOOD_MOON[index];
  rows[0] = overlayAt(rows[0], column, moon);
  rows[0] = overlayAt(rows[0], 2, index % 2 ? '!' : ' ');
  OUTRO_HORDE[index].forEach(c => zombieAt(rows, c, index));
  return rows;
}

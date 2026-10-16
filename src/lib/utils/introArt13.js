// Header intro art, batch 13 (issue #535): The Isle (Evrima), live on the Flux games hub.
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
export const BATCH13_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// The Isle: on the island's shore an egg wobbles, cracks and hatches. The hatchling grows
// -- Evrima's players start small and grow up -- into an adult that roars. The outro: the
// adult turns into the sea and the tide comes in over the beach.
// =======================================================================================

// Row 5: the beach between two stretches of sea. `covered` columns of sand from the right
// are under water, for the outro's tide.
const SAND = 24;
const shore = (covered = 0) =>
  '~~/' + '.'.repeat(SAND - covered) + BSLASH + '~'.repeat(6 + covered);

// Rows 1-4, near the left edge: a palm. Its crown is the scene's signature.
const PALM_COLUMN = 3;
const PALM = [' ' + BSLASH + '|/ ', '--*--', '  |  ', '  |  '];

// Rows 3-4: the egg, whole, wobbling, then cracked; and its two halves once open.
const EGG_COLUMN = 18;
const EGG = [' .-. ', '(   )'];
const EGG_CRACKED = [' .^. ', '( v )'];
const SHELL_LEFT = '(_';
const SHELL_RIGHT = '_)';

// Facing right. The hatchling is two rows, the juvenile two, the adult three. A closed jaw
// is `o>`, an open one `o<`: the shape of a mouth seen from the side.
const HATCHLING = ['_o>', ' ^ '];
const JUVENILE = ['__/o>', ' /' + BSLASH + '  '];
const ADULT = ['   __o>', '_/__/  ', '  /' + BSLASH + '/' + BSLASH];
const ADULT_ROAR = ['   __o<', '_/__/  ', '  /' + BSLASH + '/' + BSLASH];
const ROAR = ')))';
const ADULT_COLUMN = EGG_COLUMN + 5;

function island(ctx, index, covered = 0) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  // Wisps drift right to left; the sun stays put.
  rows[0] = overlayAt(rows[0], 20 - (index % 4) * 3, sky.wisp);
  rows[0] = overlayAt(rows[0], 2 + (index % 4) * 2, sky.wisp);
  rows[0] = overlayAt(rows[0], 29, sky.sun);
  PALM.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], PALM_COLUMN, art); });
  rows[5] = shore(covered);
  return rows;
}

function draw(rows, top, column, art) {
  art.forEach((line, i) => { rows[top + i] = overlayAt(rows[top + i], column, line); });
}

// The intro: the egg sits (0), wobbles (1), cracks (2), hatches (3), the hatchling steps
// out (4), grows to a juvenile (5) and an adult (6), and the adult roars (7).
export function formatTheIsleFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = island(ctx, index);
  if (index === 0) draw(rows, 3, EGG_COLUMN, EGG);
  else if (index === 1) draw(rows, 3, EGG_COLUMN - 1, EGG);
  else if (index === 2) draw(rows, 3, EGG_COLUMN, EGG_CRACKED);
  else {
    // The shell lies open where the egg was from the hatching on.
    rows[4] = overlayAt(rows[4], EGG_COLUMN - 2, SHELL_LEFT);
    rows[4] = overlayAt(rows[4], EGG_COLUMN + 5, SHELL_RIGHT);
    if (index === 3) draw(rows, 3, EGG_COLUMN + 1, HATCHLING);
    else if (index === 4) draw(rows, 3, EGG_COLUMN + 4, HATCHLING);
    else if (index === 5) draw(rows, 3, EGG_COLUMN + 7, JUVENILE);
    else {
      // Grown around its head: the adult's head is where the juvenile's was.
      draw(rows, 2, ADULT_COLUMN, index === 7 ? ADULT_ROAR : ADULT);
      if (index === 7) rows[2] = overlayAt(rows[2], ADULT_COLUMN + 7, ROAR);
    }
  }
  return rows;
}

export const theIsleFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the adult walks into the sea on the right while the tide covers the beach
// from the right, until only the palm stands above the water.
const OUTRO_ADULT = [23, 26, 29, 32, 35, 38, 41, 44];
const OUTRO_TIDE = [0, 0, 3, 7, 11, 15, 20, 24];

export function formatTheIsleOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = island(ctx, index, OUTRO_TIDE[index]);
  draw(rows, 2, OUTRO_ADULT[index], ADULT);
  return rows;
}

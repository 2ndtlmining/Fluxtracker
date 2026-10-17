// Header intro art, batch 15 (issue #538): Euro Truck Simulator 2 and American Truck
// Simulator, live on the Flux games hub as one product and tracked as one game.
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
export const BATCH15_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Truck Simulator: a convoy job. A trailer waits at the roadside; a cab reverses in from
// the right and couples to it, its headlights come on, and the rig pulls away down the
// road. The outro: the lights go out, the cab uncouples and drives off alone, and the
// trailer is left standing.
// =======================================================================================

// Rows 1-3: the trailer, then the cab that couples to its front. The trailer's wheels are
// the scene's signature: it is in every frame of both sequences.
const TRAILER = [' ________ ', '|        |', "'-oo---oo'"];
const TRAILER_WIDTH = TRAILER[0].length;
const TRAILER_COLUMN = 12;
const CAB = [' __  ', '|__' + BSLASH + '_', "'-o-'"];
const CAB_WIDTH = CAB[0].length;
const COUPLED = TRAILER_COLUMN + TRAILER_WIDTH;
// Row 2, just ahead of the cab's bonnet.
const HEADLIGHTS = '=-';
// Row 0, over the cab's stack as the engine pulls.
const EXHAUST = ['o', '.o'];

// Row 4 is the road's edge under the wheels; row 5 its centre line, which scrolls past
// once the rig is moving.
const ROAD_EDGE = '='.repeat(LOGO_WIDTH);
const centreLine = offset => '--  '.repeat(LOGO_WIDTH).slice(offset % 4, (offset % 4) + LOGO_WIDTH);

function world(ctx, index, roadOffset) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  // The sun stays put on the left; two wisps drift towards each other past it.
  rows[0] = overlayAt(rows[0], 1, sky.sun);
  rows[0] = overlayAt(rows[0], 18 - (index % 4) * 2, sky.wisp);
  rows[0] = overlayAt(rows[0], 6 + (index % 4) * 2, sky.wisp);
  rows[4] = ROAD_EDGE;
  rows[5] = centreLine(roadOffset);
  return rows;
}

function draw(rows, top, column, art) {
  art.forEach((line, i) => {
    if (top + i >= 0 && top + i < BOOT_LINE_COUNT) rows[top + i] = overlayAt(rows[top + i], column, line);
  });
}

// The cab: drawn at its column, with its headlights on or off.
function drawCab(rows, column, lit) {
  draw(rows, 1, column, CAB);
  if (lit) draw(rows, 2, column + CAB_WIDTH, [HEADLIGHTS]);
}

// Per intro frame: the cab reverses in from the right edge (0-3) and couples (4); the
// headlights come on and the stack puffs (5); the rig pulls away and the road rolls (6-7).
const INTRO_CAB_COLUMN = [29, 27, 25, 23, COUPLED, COUPLED, COUPLED, COUPLED];
const INTRO_RIG_SHIFT = [0, 0, 0, 0, 0, 0, 2, 4];

export function formatTruckSimFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const shift = INTRO_RIG_SHIFT[index];
  const rows = world(ctx, index, shift / 2);
  draw(rows, 1, TRAILER_COLUMN + shift, TRAILER);
  const cab = INTRO_CAB_COLUMN[index] + shift;
  drawCab(rows, cab, index >= 5);
  if (index >= 5) draw(rows, 0, cab + 1, [EXHAUST[index === 5 ? 0 : 1]]);
  return rows;
}

export const truckSimFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the coupled rig's lights go out (1), the cab pulls away from the trailer and
// off the right edge (2-5), and only the trailer is left by the road (6-7).
const OUTRO_CAB_COLUMN = [COUPLED, COUPLED, 24, 27, 30, 33, null, null];

export function formatTruckSimOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index, 0);
  draw(rows, 1, TRAILER_COLUMN, TRAILER);
  const cab = OUTRO_CAB_COLUMN[index];
  if (cab !== null) drawCab(rows, cab, index === 0);
  return rows;
}

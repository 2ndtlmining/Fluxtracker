// Header intro art, batch 16 (issue #540): Team Fortress 2, live on the Flux games hub.
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
export const BATCH16_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Team Fortress 2: the Engineer builds a sentry. He drops his toolbox, and each swing of
// the wrench adds a stage -- tripod, body, top, barrel -- until it is up and firing. The
// outro: a sapper goes on, it sparks, the barrel droops, it blows up, and the Engineer is
// left with the scrap.
// =======================================================================================

// Rows 1-3: the Engineer. His boots are the scene's signature: he is in every frame of
// both sequences.
const ENGINEER_COLUMN = 6;
const HEAD = '  @';
const BODY_ARM_DOWN = ' /|' + BSLASH;
const BODY_ARM_UP = ' /|';
// Row 1, beside his head: the raised arm and the wrench.
const WRENCH_UP = '_Y';
const BOOTS = '_/ ' + BSLASH + '_';

// Rows 1-3: the sentry, built bottom-up from the toolbox.
const SENTRY_COLUMN = 13;
const TOOLBOX = ' [==]';
const TRIPOD = ' /  ' + BSLASH;
const SENTRY_BODY = '[(o)]';
const SENTRY_TOP = ' .--.';
const BARREL = '==';
const BARREL_COLUMN = SENTRY_COLUMN + SENTRY_BODY.length;
// Row 2, the sentry's tracers, which scroll right while it fires.
const TRACER_COLUMN = BARREL_COLUMN + BARREL.length + 1;
const tracers = offset => '-  '.repeat(LOGO_WIDTH).slice(2 - (offset % 3), 2 - (offset % 3) + LOGO_WIDTH - TRACER_COLUMN);

// Rows 4-5: a brick floor, the two courses offset like a wall.
const BRICKS_A = '|__'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);
const BRICKS_B = '__|'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

function world(ctx, index) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  // The sun stays put on the right; a wisp drifts across the left.
  rows[0] = overlayAt(rows[0], 29, sky.sun);
  rows[0] = overlayAt(rows[0], 2 + (index % 4) * 2, sky.wisp);
  rows[4] = BRICKS_A;
  rows[5] = BRICKS_B;
  return rows;
}

const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };

function drawEngineer(rows, armUp) {
  put(rows, 1, ENGINEER_COLUMN, HEAD);
  put(rows, 2, ENGINEER_COLUMN, armUp ? BODY_ARM_UP : BODY_ARM_DOWN);
  if (armUp) put(rows, 1, ENGINEER_COLUMN + HEAD.length, WRENCH_UP);
  put(rows, 3, ENGINEER_COLUMN, BOOTS);
}

// Build stages: 0 toolbox, 1 tripod, 2 + body, 3 + top, 4 + barrel (built).
function drawSentry(rows, stage, barrel = BARREL) {
  if (stage === 0) { put(rows, 3, SENTRY_COLUMN, TOOLBOX); return; }
  put(rows, 3, SENTRY_COLUMN, TRIPOD);
  if (stage >= 2) put(rows, 2, SENTRY_COLUMN, SENTRY_BODY);
  if (stage >= 3) put(rows, 1, SENTRY_COLUMN, SENTRY_TOP);
  if (stage >= 4) put(rows, 2, BARREL_COLUMN, barrel);
}

// Per intro frame: the toolbox drops (0), each swing adds a stage (1-4), then the sentry
// fires and the Engineer stands back (5-7).
const INTRO_STAGE = [0, 1, 2, 3, 4, 4, 4, 4];

export function formatTf2Frame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  drawEngineer(rows, index >= 1 && index <= 4 && index % 2 === 1);
  drawSentry(rows, INTRO_STAGE[index]);
  if (index >= 5) put(rows, 2, TRACER_COLUMN, tracers(index));
  return rows;
}

export const tf2FrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the built sentry stops firing as a sapper goes on (0-1), sparks fly and the
// barrel droops (2-3), it blows up (4), smoke (5), and only scrap is left (6-7) while the
// Engineer raises his wrench too late.
const SPARK_COLUMNS = [null, 14, 17, 15];
const OUTRO_BARREL = [BARREL, BARREL, '=.', '.'];
const BLAST = [' ' + BSLASH + ' | /', '-- * --', ' / | ' + BSLASH];
const SMOKE = ['  ( )', '   .', ' . , .'];
const SCRAP = ' ,._, ';

export function formatTf2Outro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  drawEngineer(rows, index === 7);
  if (index <= 3) {
    drawSentry(rows, 4, OUTRO_BARREL[index]);
    if (index === 0) put(rows, 2, TRACER_COLUMN, tracers(0));
    if (index >= 1) put(rows, 3, SENTRY_COLUMN + 2, 'zz');
    if (SPARK_COLUMNS[index] !== null) put(rows, 0, SPARK_COLUMNS[index], '*');
  } else if (index === 4) {
    BLAST.forEach((line, i) => put(rows, 1 + i, SENTRY_COLUMN, line));
  } else if (index === 5) {
    SMOKE.forEach((line, i) => put(rows, 1 + i, SENTRY_COLUMN, line));
  } else {
    put(rows, 3, SENTRY_COLUMN, SCRAP);
  }
  return rows;
}

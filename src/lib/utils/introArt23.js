// Header intro art, batch 23: Abiotic Factor, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intro is green
// (ROW_KIND_DEPLOYED); the outro is keyed like the intro and plays in orange
// (outroFrameKinds, applied by the component).
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH23_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Abiotic Factor: science gone wrong, deep under the research facility. The intro is the
// experiment: a scientist in a hazmat suit walks to the console and starts it, the
// containment ring sparks and tears open into a portal, the alarm lamp goes, something
// looks out of it and the scientist raises a crowbar -- "CONTAINMENT BREACH". The outro is
// the facility shutting it down, the way a deployment's time runs out: something reaches
// out of the portal, the scientist runs back to the console and hits the lockdown, a blast
// shutter comes down over the ring and the lights go out -- "FACILITY LOCKDOWN".
// The facility is underground, so this scene draws no sky.
// =======================================================================================

// Row 0: the ceiling's pipe, with the lamp that turns into the alarm.
const CEILING = '='.repeat(LOGO_WIDTH);
const LAMP_AT = 15;
const LAMP_IDLE = '[o]';
const ALARM = ['[!]', '[*]'];
const LAMP_OUT = '[.]';

// Row 5: the facility's floor grating, the scene's signature: it is in every frame of both
// sequences, and nothing else in the header draws it.
const FLOOR = '=:=|'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// Rows 3-4, at the left: the experiment's console, its screen on row 3.
const CONSOLE_AT = 1;
const SCREEN = { idle: '[..]', run: '[>>]', alarm: '[!!]', dark: '[  ]' };
const DESK = '|__|';

// Rows 1-4, against the right edge: the containment ring. Its inside is two rows of four.
const RING_AT = 24;
const RING = ['  .--.  ', ' /    ' + BSLASH + ' ', ' ' + BSLASH + '    / ', "  '--'  "];
const INSIDE_AT = RING_AT + 2;
const SPARKS = ['*  *', ' ** '];
const OPENING = [' @@ ', ' @@ '];
const PORTAL = [['@%@%', '%@%@'], ['%@%@', '@%@%']];
const EYES = '<oo>';

// The blast shutter that seals the ring, one row lower each frame.
const SHUTTER_AT = RING_AT - 1;
const SHUTTER = '[########]';

// The scientist in his hazmat suit: helmet on row 3, suit on row 4, legs on the floor.
const HELMET = '(o)';
const SUIT = '/#' + BSLASH;
const PRESSING = '-#' + BSLASH;      // his arm out to the console
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
const STANDING = '/ ' + BSLASH;

const BREACH = 'CONTAINMENT BREACH';
const LOCKDOWN = 'FACILITY LOCKDOWN';
const BANNER_AT = 2;

function world(lamp) {
  const rows = blankRows();
  rows[0] = overlayAt(CEILING, LAMP_AT, lamp);
  draw(rows, 1, RING_AT, RING);
  draw(rows, 4, CONSOLE_AT, [DESK]);
  rows[5] = FLOOR;
  return rows;
}

const screen = (rows, state) => put(rows, 3, CONSOLE_AT, SCREEN[state]);
const inside = (rows, pair) => draw(rows, 2, INSIDE_AT, pair);

function scientist(rows, column, suit = SUIT, legs = STANDING) {
  put(rows, 3, column, HELMET);
  put(rows, 4, column, suit);
  put(rows, 5, column, legs);
}

// Per intro frame: the scientist walks in (0-1) to the console and starts it (2); the
// ring sparks (3) and opens (4) into a portal (5) while the alarm goes; something looks
// out of it (6-7) and he raises his crowbar under the banner.
const INTRO_WALK = [12, 8];
const INTRO_SCREEN = ['idle', 'idle', 'run', 'run', 'run', 'alarm', 'alarm', 'alarm'];

export function formatAbioticFactorFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(index >= 5 ? ALARM[index % 2] : LAMP_IDLE);
  screen(rows, INTRO_SCREEN[index]);
  if (index < 2) scientist(rows, INTRO_WALK[index], SUIT, STRIDES[index]);
  else if (index < 6) scientist(rows, 5, index === 2 ? PRESSING : SUIT);
  else {
    // The crowbar raised beside his helmet, its hook on top.
    scientist(rows, 5);
    put(rows, 3, 8, '|');
    put(rows, 2, 8, '_');
  }
  if (index === 3) inside(rows, SPARKS);
  if (index === 4) inside(rows, OPENING);
  if (index >= 5) inside(rows, PORTAL[index % 2]);
  if (index >= 6) put(rows, 3, INSIDE_AT, EYES);
  if (index >= 6) put(rows, 1, BANNER_AT, BREACH);
  return rows;
}

export const abioticFactorFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the portal is open under the alarm (0); something reaches out of it
// and the scientist runs (1-2) back to the console and hits the lockdown (3); the blast
// shutter comes down over the ring (4-6) and the lights go out (7).
const OUTRO_AT = [16, 12, 8, 5, 5, 5, 5, 5];
const REACH = [null, '~~~', '~~~~~~', '~~', null, null, null, null];
// How many of the ring's four rows the shutter covers, per frame.
const SHUTTER_DOWN = [0, 0, 0, 0, 1, 2, 4, 4];

export function formatAbioticFactorOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(index === 7 ? LAMP_OUT : ALARM[index % 2]);
  screen(rows, index === 7 ? 'dark' : 'alarm');
  // The portal swirls until the shutter has sealed it.
  if (index < 6) inside(rows, PORTAL[index % 2]);
  if (index < 4) put(rows, 3, INSIDE_AT, EYES);
  const reach = REACH[index];
  if (reach) put(rows, 4, RING_AT - reach.length, reach);
  const running = index === 1 || index === 2;
  scientist(rows, OUTRO_AT[index], index === 3 ? PRESSING : SUIT,
    running ? STRIDES[index % 2] : STANDING);
  for (let row = 1; row <= SHUTTER_DOWN[index]; row++) put(rows, row, SHUTTER_AT, SHUTTER);
  if (index >= 6) put(rows, 1, BANNER_AT, LOCKDOWN);
  return rows;
}

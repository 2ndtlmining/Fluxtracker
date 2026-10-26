// Header intro art, batch 22: Counter-Strike 2, live on the Flux games hub.
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
export const BATCH22_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Counter-Strike 2: the bomb round. The intro is the plant: a terrorist sprints from the
// crates to bombsite A, kneels, plants the bomb and runs back to cover while it blinks --
// "BOMB HAS BEEN PLANTED". The outro is the round running out, the way a deployment's
// time does: a counter-terrorist rushes in to defuse it, too late, the bomb goes off and
// the round ends "TERRORISTS WIN". (The bomb's light blinks; no timer digits are shown,
// as no number here would be real.)
// =======================================================================================

// Rows 1-4, against the right edge: the bombsite's wall with its painted A.
const SITE = ['.------.', '|  A   |', '|      |', '|______|'];
const SITE_AT = 26;

// Rows 3-4, at the left: the crates the round starts behind.
const CRATES = [[3, 2, '[+]'], [4, 1, '[+][+]']];

// Row 5: the sand of the site, the scene's signature: it is in every frame of both
// sequences, and nothing else in the header draws it.
const FLOOR = '_:._.:'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The bomb on the floor of the site, its light blinking. Its row is the one the header
// smoke watches.
const BOMB_AT = 21;
const BOMB = ['[:*]', '[:.]'];

// A player: head on row 3, body on row 4 with the rifle held the way he runs, legs on the
// floor row.
const RUN_RIGHT = [' o ', '/|-'];
const RUN_LEFT = [' o ', '-|' + BSLASH];
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
// Kneeling at the bomb, his hand on it: head on row 4, knee on the floor.
const KNEEL = [' o_', '/< '];
const KNEEL_AT = BOMB_AT - 3;

const PLANTED = 'BOMB HAS BEEN PLANTED';
const WIN = 'TERRORISTS WIN';
const BANNER_AT = 3;

// The blast, three rows round the bomb, then its cloud, then what drifts off it.
const BURST = [BSLASH + ' | /', '-=#=-', '/ | ' + BSLASH];
const CLOUD = [' (  ) ', '(    )', ' (__) '];
const SCORCH = '.#.';

function world(ctx) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 28, sky.sun);
  draw(rows, 1, SITE_AT, SITE);
  for (const [row, column, crate] of CRATES) put(rows, row, column, crate);
  rows[5] = FLOOR;
  return rows;
}

function runner(rows, column, body, stride) {
  draw(rows, 3, column, [' o ', body]);
  put(rows, 5, column, STRIDES[stride % 2]);
}

const kneel = rows => draw(rows, 4, KNEEL_AT, KNEEL);
const bomb = (rows, index) => put(rows, 4, BOMB_AT, BOMB[index % 2]);

// Per intro frame: the terrorist runs from the crates to the site (0-3), kneels and plants
// the bomb (4), and runs back (5-6) to crouch behind the crates (7) while it blinks.
const INTRO_RUN_RIGHT = [8, 11, 14, 17];
const INTRO_RUN_LEFT = { 5: 13, 6: 9 };

export function formatCounterStrikeFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx);
  if (index < 4) runner(rows, INTRO_RUN_RIGHT[index], RUN_RIGHT[1], index);
  if (index === 4) kneel(rows);
  if (index >= 4) bomb(rows, index);
  if (index in INTRO_RUN_LEFT) runner(rows, INTRO_RUN_LEFT[index], RUN_LEFT[1], index);
  if (index === 7) draw(rows, 4, 7, KNEEL.map(line => line.trimEnd().replace('_', ' ')));
  if (index >= 5) put(rows, 1, BANNER_AT, PLANTED);
  return rows;
}

export const counterStrikeFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the planted bomb blinks on the site (0); a counter-terrorist comes out
// from the crates (1) and runs for it (2-3), kneels to defuse it (4) -- too late: it goes
// off (5), its cloud rises (6) and drifts off a scorched site (7), and the round ends.
const OUTRO_RUN = [null, 8, 12, 16, null, null, null, null];

export function formatCounterStrikeOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx);
  if (index < 5) bomb(rows, index);
  const at = OUTRO_RUN[index];
  if (at !== null) runner(rows, at, RUN_RIGHT[1], index);
  if (index === 4) {
    kneel(rows);
    put(rows, 3, BOMB_AT + 1, '!!');
  }
  if (index === 5) draw(rows, 2, BOMB_AT - 1, BURST);
  if (index === 6) draw(rows, 2, BOMB_AT - 2, CLOUD);
  if (index === 7) {
    put(rows, 2, BOMB_AT, '~');
    put(rows, 3, BOMB_AT + 2, '~');
    put(rows, 4, BOMB_AT, SCORCH);
  }
  if (index >= 6) put(rows, 1, BANNER_AT, WIN);
  return rows;
}

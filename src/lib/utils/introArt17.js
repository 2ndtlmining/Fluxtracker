// Header intro art, batch 17 (issue #547): Vintage Story, live on the Flux games hub.
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
export const BATCH17_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const solid = (rows, row, column, art) => {
  rows[row] = rows[row].slice(0, column) + art + rows[row].slice(column + art.length);
};

// =======================================================================================
// Vintage Story: the game's emblem is a wheat wreath, and its tagline is "your seasons".
// The intro: a settler hoes a field beside his cabin, and the wheat grows from seed to
// ripe ears while the sun crosses the sky. The outro: the season turns -- the ears droop,
// the stalks fall flat, snow comes in, and the settler walks home and shuts the door.
// =======================================================================================

// Rows 1-3, right: the cabin. Its door is the scene's signature: it is in every frame of
// both sequences, and the chimney smoke above it is always rising.
const CABIN_COLUMN = 27;
const CABIN = ['  /' + BSLASH + '  ', ' /  ' + BSLASH + ' ', ' |[]| '];
const SMOKE_COLUMN = CABIN_COLUMN + 3;
const SMOKE = [' ,', ', ', ' .', '. '];

// Rows 1-3, left: the settler. With the hoe raised, or resting on the ground.
const SETTLER_COLUMN = 2;
const settler = hoeUp => hoeUp
  ? [' o /', '/|/', '/ ' + BSLASH]
  : [' o', '/|' + BSLASH + '_', '/ ' + BSLASH];

// The field: four crops between the settler and the cabin, each drawn on its centre
// column. Growth stages: 0 tilled, 1 seed, 2 sprout, 3 stalk, 4 ripe ears.
const CROP_COLUMNS = [10, 14, 18, 22];
const EARS = [BSLASH + '|/', '/|/', BSLASH + '|/', BSLASH + '|' + BSLASH];

function drawCrop(rows, column, stage, ears = EARS[0]) {
  if (stage === 1) put(rows, 3, column, '.');
  if (stage === 2) put(rows, 3, column, 'v');
  if (stage === 3) { put(rows, 3, column, '|'); put(rows, 2, column, 'v'); }
  if (stage === 4) { put(rows, 3, column, '|'); put(rows, 2, column, '|'); put(rows, 1, column - 1, ears); }
}

// Rows 4-5: the ploughed field, its furrows offset like the two courses of a wall.
const FURROWS_A = '-.'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);
const FURROWS_B = ':.'.repeat(LOGO_WIDTH).slice(1, LOGO_WIDTH + 1);

function world(ctx, index, { sunColumn } = {}) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 1 + (index % 2), sky.wisp);
  if (sunColumn !== undefined) rows[0] = overlayAt(rows[0], sunColumn, sky.sun);
  rows[0] = overlayAt(rows[0], SMOKE_COLUMN, SMOKE[index % SMOKE.length]);
  CABIN.forEach((line, i) => put(rows, 1 + i, CABIN_COLUMN, line));
  rows[4] = FURROWS_A;
  rows[5] = FURROWS_B;
  return rows;
}

// Per intro frame: the hoe goes in (0, 2), each frame the field grows a stage (0-4), then
// the ripe ears sway in the wind (5-7). The sun crosses the sky the whole time.
const INTRO_STAGE = [0, 1, 2, 3, 4, 4, 4, 4];

export function formatVintageStoryFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index, { sunColumn: 7 + index * 2 });
  settler(index === 0 || index === 2).forEach((line, i) => put(rows, 1 + i, SETTLER_COLUMN, line));
  const ears = EARS[index % EARS.length];
  for (const column of CROP_COLUMNS) drawCrop(rows, column, INTRO_STAGE[index], ears);
  return rows;
}

export const vintageStoryFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the ears droop as the sun sets (0-1), the stalks bend and fall flat (2-3),
// snow comes in, and the settler walks home across the field (4-6) and goes in (7).
const OUTRO_SETTLER_COLUMN = [SETTLER_COLUMN, SETTLER_COLUMN, SETTLER_COLUMN, SETTLER_COLUMN, 9, 16, 22, null];

// Snowflakes on rows 0-2, only in the open sky between the settler's start and the cabin,
// and only into empty cells. They fall: each frame the pattern moves down a row.
function snow(rows, index) {
  if (index < 3) return;
  for (let row = 0; row <= 2; row++) {
    const chars = rows[row].split('');
    for (let column = 6; column < CABIN_COLUMN; column++) {
      if (chars[column] === ' ' && (column * 3 + (row - index) * 5) % 7 === 0) chars[column] = '*';
    }
    rows[row] = chars.join('');
  }
}

export function formatVintageStoryOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index, index <= 1 ? { sunColumn: 21 + index * 3 } : {});
  for (const column of CROP_COLUMNS) {
    if (index === 0) drawCrop(rows, column, 4);
    else if (index === 1) drawCrop(rows, column, 4, '.|.');
    else if (index === 2) { put(rows, 3, column, '|'); put(rows, 2, column + 1, '/'); }
    else put(rows, 3, column - 1, index >= 6 ? '***' : '_/_');
  }
  // Drawn solid while he walks, so the flattened crop does not show through his legs.
  const at = OUTRO_SETTLER_COLUMN[index];
  if (at !== null) settler(false).forEach((line, i) => solid(rows, 1 + i, at, line.padEnd(4)));
  snow(rows, index);
  return rows;
}

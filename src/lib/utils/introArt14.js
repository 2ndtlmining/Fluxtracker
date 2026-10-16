// Header intro art, batch 14 (issue #533): tModLoader, live on the Flux games hub.
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
export const BATCH14_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// tModLoader: a mod is a piece that slots into Terraria. A jigsaw piece drops from the sky
// into a gap in the ground, clicks in, and the world loads it: sparks fly and the player
// raises a modded blade. The outro: the piece is lifted back out and floats away, and the
// player goes with it, leaving the gap.
// =======================================================================================

// Rows 4-5: grass over dirt, with a gap the width of the piece.
const GRASS = '"",'.repeat(12).slice(0, LOGO_WIDTH);
const DIRT = ':.:.'.repeat(9).slice(0, LOGO_WIDTH);
const PIECE_COLUMN = 18;
// Two rows: the knob on top, the socket underneath. Its top row is the scene's signature.
const PIECE = ['.-(_)-.', "'-( )-'"];
const PIECE_WIDTH = PIECE[0].length;

// Rows 1-3, right of the gap: a pine, so no row of the scene is ever empty.
const PINE_COLUMN = 27;
const PINE = ['  ^  ', ' /^' + BSLASH + ' ', '/_|_' + BSLASH];

const gap = row => row.slice(0, PIECE_COLUMN) + ' '.repeat(PIECE_WIDTH) + row.slice(PIECE_COLUMN + PIECE_WIDTH);

// Rows 2-3, left of the gap: the player. Its arm and blade change as the mod loads.
const PLAYER_COLUMN = 7;
const PLAYER = [' o ', '/|' + BSLASH];
const PLAYER_ARMED = [' o/==>', '/|    '];
// Three rows (1-3): the blade held up over the head.
const PLAYER_RAISED = ['   /', ' o/ ', '/|  '];

// Row 3, over the slotted piece: sparks as the mod loads.
const SPARKS = ['  *   *  ', '*  . . *', '.  * *  .'];

function world(ctx, index, slotted) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  // Two wisps drift towards each other, left of the piece's path; the sun stays put.
  rows[0] = overlayAt(rows[0], 15 - (index % 4) * 2, sky.wisp);
  rows[0] = overlayAt(rows[0], 1 + (index % 4) * 2, sky.wisp);
  rows[0] = overlayAt(rows[0], 29, sky.sun);
  PINE.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], PINE_COLUMN, art); });
  rows[4] = slotted ? GRASS : gap(GRASS);
  rows[5] = slotted ? DIRT : gap(DIRT);
  return rows;
}

function draw(rows, top, column, art) {
  art.forEach((line, i) => {
    if (top + i >= 0 && top + i < BOOT_LINE_COUNT) rows[top + i] = overlayAt(rows[top + i], column, line);
  });
}

// The piece's top row per intro frame: it falls from row 0 into the gap (rows 4-5) and
// stays there.
const INTRO_PIECE_TOP = [0, 1, 2, 3, 4, 4, 4, 4];

// The intro: the piece falls (0-3), clicks into the gap (4), sparks fly (5), the player
// draws a modded blade (6) and raises it (7).
export function formatTModLoaderFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index, false);
  draw(rows, INTRO_PIECE_TOP[index], PIECE_COLUMN, PIECE);
  if (index >= 5) draw(rows, 3, PIECE_COLUMN - 1, [SPARKS[index - 5]]);
  if (index === 7) draw(rows, 1, PLAYER_COLUMN, PLAYER_RAISED);
  else draw(rows, 2, PLAYER_COLUMN, index === 6 ? PLAYER_ARMED : PLAYER);
  return rows;
}

export const tModLoaderFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the piece rises out of the gap and off the top (0-5) while the player walks
// off to the left behind it (from 4), and only the open gap is left.
const OUTRO_PIECE_TOP = [4, 3, 2, 1, 0, -1, -2, -2];
const OUTRO_PLAYER_COLUMN = [7, 7, 7, 7, 5, 3, 1, null];

export function formatTModLoaderOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index, false);
  draw(rows, OUTRO_PIECE_TOP[index], PIECE_COLUMN, PIECE);
  const column = OUTRO_PLAYER_COLUMN[index];
  if (column !== null) draw(rows, 2, column, PLAYER);
  return rows;
}

// Header intro art, batch 20: Conan Exiles, live on the Flux games hub.
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
export const BATCH20_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Conan Exiles: every game opens the same way. The player is an exile, left tied to a
// cross in the desert to die, until Conan himself walks past and cuts the ropes. The
// intro is that opening: Conan strides in, raises his sword, cuts the exile down, and walks
// on while the exile raises his arms, free. The outro is the Exiled Lands' sandstorm: it
// rolls across the desert, the exile vanishes into it, and when it has passed there is a
// mound of sand by the empty cross and a vulture coming down.
// =======================================================================================

// Rows 0-4: the cross, its beam on row 1. Its post stands on the desert floor.
const CROSS = ['  |  ', '==|==', '  |  ', '  |  ', '  |  '];
const POST = 6;
const CROSS_COLUMN = POST - 2;
// Tied to the cross: arms along the beam, the post behind his body, legs hanging.
const TIED_ARMS = BSLASH + 'o/';
const TIED_LEGS = '/ ' + BSLASH;
// Cut free: the ropes at either side of the post are slashed.
const CUT_BEAM = '=x|x=';

// The exile once he is down: head on row 3, body on row 4, legs on the floor row; free,
// he raises both arms.
const EXILE = 8;

// Conan: a broader man than the exile (capital head, fur on his chest), his sword held low
// in front of him in the direction he walks, or raised over his head to strike.
const CONAN_BODY = '/#' + BSLASH;
const SWORD_LEFT = '<==+';
const SWORD_RIGHT = '+==>';
const RAISED_SWORD = ['^', '|', '+'];

// Row 5: the desert floor, the scene's signature: it is in every frame of both sequences,
// and nothing else in the header draws it.
const FLOOR = "_.:'':.".repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The sandstorm: a wall of blown sand over rows 0-4, with no gaps (a space would let the
// scene show through it).
const STORM = [':;:.;:', ';:.:;.', ':.;:;:', '.;:;.:', ';:;.:;'];
// The mound the storm leaves where the exile stood.
const MOUND = '.^.';

function world(ctx, index) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 1, sky.sun);
  rows[0] = overlayAt(rows[0], 28 - (index % 4) * 2, sky.wisp);
  draw(rows, 0, CROSS_COLUMN, CROSS);
  rows[5] = FLOOR;
  return rows;
}

function exile(rows, { tied = false, cheering = false } = {}) {
  if (tied) {
    put(rows, 1, POST - 1, TIED_ARMS);
    put(rows, 3, POST - 1, TIED_LEGS);
    return;
  }
  put(rows, 3, EXILE, cheering ? BSLASH + 'o/' : ' o ');
  put(rows, 4, EXILE, cheering ? ' | ' : '/|' + BSLASH);
  put(rows, 5, EXILE, '/ ' + BSLASH);
}

function conan(rows, column, sword) {
  put(rows, 3, column + 1, 'O');
  put(rows, 4, column, CONAN_BODY);
  put(rows, 5, column, '/ ' + BSLASH);
  if (sword === 'left') put(rows, 4, column - SWORD_LEFT.length, SWORD_LEFT);
  if (sword === 'right') put(rows, 4, column + CONAN_BODY.length, SWORD_RIGHT);
  if (sword === 'raised') {
    put(rows, 3, column, BSLASH);
    draw(rows, 0, column - 1, RAISED_SWORD);
  }
}

// Per intro frame: the exile hangs on the cross (0); Conan strides in from the right (1-3),
// raises his sword (4) and cuts the ropes (5), and the exile drops to the sand; Conan walks
// on (6-7) and the exile raises his arms, free (7).
const STRIKE = 16;
const INTRO_CONAN = [null, [29, 'left'], [22, 'left'], [STRIKE, 'left'], [STRIKE, 'raised'], [STRIKE, 'left'], [21, 'right'], [27, 'right']];

export function formatConanExilesFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  if (index < 5) exile(rows, { tied: true });
  else exile(rows, { cheering: index === 7 });
  if (index === 5) {
    put(rows, 1, CROSS_COLUMN, CUT_BEAM);
    put(rows, 2, POST - 2, "'");
    put(rows, 2, POST + 2, "'");
  }
  const at = INTRO_CONAN[index];
  if (at !== null) conan(rows, at[0], at[1]);
  return rows;
}

export const conanExilesFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the exile stands by the empty cross (0); the sandstorm rolls in from
// the right (1-3) and over him (4) and blows out to the left (5); a mound of sand is left
// where he stood (5-7), and a vulture comes down over it (6-7).
const OUTRO_STORM = [null, 28, 20, 12, 5, -2, null, null];
const OUTRO_VULTURE = [null, null, null, null, null, null, [1, 18], [2, 13]];

export function formatConanExilesOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  if (index < 4) exile(rows);
  else put(rows, 4, EXILE, MOUND);
  if (OUTRO_VULTURE[index] !== null) put(rows, OUTRO_VULTURE[index][0], OUTRO_VULTURE[index][1], 'v');
  if (OUTRO_STORM[index] !== null) draw(rows, 0, OUTRO_STORM[index], STORM);
  return rows;
}

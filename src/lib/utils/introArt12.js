// Header intro art, batch 12 (issue #530): Core Keeper, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intro is green
// (ROW_KIND_DEPLOYED); the outro is keyed like the intro and plays in orange
// (outroFrameKinds, applied by the component).
//
// Underground, so unlike the surface scenes there is no sky: `ctx` is accepted for the
// shared signature and not read.
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH12_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);

// =======================================================================================
// Core Keeper: deep underground, an explorer walks in carrying a glowing gem and sets it
// in the dormant Core, which wakes and sends light rippling through the cave. The outro:
// the Core dims, the explorer runs for it, and the cave comes down.
// =======================================================================================

// Row 0 the cave roof, row 1 its stalactites, row 5 the floor.
const ROOF = '##=#'.repeat(9).slice(0, LOGO_WIDTH);
const STALACTITES = [3, 11, 17];
const FLOOR = "#.#'".repeat(9).slice(0, LOGO_WIDTH);
// Rows 2-4: the Core, eye in the middle. Its eye is the only thing that changes.
const CORE_COLUMN = 24;
const CORE_WIDTH = 7;
const CORE_EYE_COLUMN = CORE_COLUMN + 3;
const coreArt = eye => [' .-^-. ', '[( ' + eye + ' )]', " '-v-' "];
const EYE_DORMANT = '-';
const EYE_GEM = '*';
const EYE_AWAKE = '@';
// Rows 2-4: the explorer, three wide.
const EXPLORER_HEAD = ' o ';
const EXPLORER_CHEER = BSLASH + 'o/';
const EXPLORER_BODY = '/|' + BSLASH;
const EXPLORER_CARRY = '/|-';
const EXPLORER_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
const GEM = '*';
const RUBBLE = '%';

function cave() {
  const rows = blankRows();
  rows[0] = ROOF;
  rows[1] = STALACTITES.reduce((row, c) => overlayAt(row, c, 'V'), rows[1]);
  rows[5] = FLOOR;
  return rows;
}

function coreOf(rows, eye) {
  coreArt(eye).forEach((art, i) => { rows[2 + i] = overlayAt(rows[2 + i], CORE_COLUMN, art); });
}

// Light rings on row 3, one column out from the Core per ring.
function ripplesOf(rows, rings) {
  for (let r = 1; r <= rings; r++) {
    rows[3] = overlayAt(rows[3], CORE_COLUMN - 1 - (r - 1) * 2, '(');
    rows[3] = overlayAt(rows[3], CORE_COLUMN + CORE_WIDTH + (r - 1) * 2, ')');
  }
}

function explorerAt(rows, column, step, { head = EXPLORER_HEAD, body = EXPLORER_BODY } = {}) {
  rows[2] = overlayAt(rows[2], column, head);
  rows[3] = overlayAt(rows[3], column, body);
  rows[4] = overlayAt(rows[4], column, EXPLORER_LEGS[step % 2]);
}

// The intro: the explorer walks in with the gem (0-3), holds it up and it floats to the
// Core (4), sits in the Core's eye (5), the Core wakes (6) and its light spreads (7).
const EXPLORER_COLUMN = [1, 4, 7, 10, 13, 13, 13, 13];

export function formatCoreKeeperFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = cave();
  const eye = index < 5 ? EYE_DORMANT : index === 5 ? EYE_GEM : EYE_AWAKE;
  coreOf(rows, eye);
  if (index >= 6) ripplesOf(rows, index - 5);
  // The light reaches the roof once the second ring is out.
  if (index === 7) rows[1] = overlayAt(rows[1], CORE_EYE_COLUMN - 2, BSLASH + ' | /');
  const column = EXPLORER_COLUMN[index];
  if (index < 4) {
    explorerAt(rows, column, index, { body: EXPLORER_CARRY });
    rows[3] = overlayAt(rows[3], column + 3, GEM);
  } else {
    explorerAt(rows, column, index, { head: index === 7 ? EXPLORER_CHEER : EXPLORER_HEAD });
  }
  // Mid-flight: the gem halfway between the explorer's hands and the Core's eye.
  if (index === 4) rows[2] = overlayAt(rows[2], 20, GEM);
  return rows;
}

export const coreKeeperFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the light rings fall back into the Core and its eye closes, the explorer runs
// off to the left, and rubble falls from the roof and piles up from the floor.
const OUTRO_EYE = [EYE_AWAKE, EYE_AWAKE, 'o', 'o', EYE_DORMANT, EYE_DORMANT, '.', '.'];
const OUTRO_RINGS = [2, 1, 0, 0, 0, 0, 0, 0];
const OUTRO_EXPLORER = [13, 9, 5, 1, -3, -7, -11, -15];
// How many rows of rubble cover the floor's upper side: rows 4, 3, 2, 1 in turn.
const RUBBLE_HEIGHT = [0, 0, 0, 1, 1, 2, 3, 4];

export function formatCoreKeeperOutro(step = 0) {
  const index = wrap(step);
  const rows = cave();
  coreOf(rows, OUTRO_EYE[index]);
  ripplesOf(rows, OUTRO_RINGS[index]);
  explorerAt(rows, OUTRO_EXPLORER[index], index);
  // Falling stones above the pile, in places that move with the step, clear of the Core
  // so its eye can be seen closing until the pile covers it.
  const height = RUBBLE_HEIGHT[index];
  for (let r = 1; r <= 4 - height; r++) {
    if (index === 0) break;
    for (let k = 0; k < r; k++) {
      rows[r] = overlayAt(rows[r], (index * 7 + r * 11 + k * 13) % (CORE_COLUMN - 1), RUBBLE);
    }
  }
  for (let h = 0; h < height; h++) rows[4 - h] = RUBBLE.repeat(LOGO_WIDTH);
  return rows;
}

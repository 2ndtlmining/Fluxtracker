// Header intro art, batch 9 (issue #524): Garry's Mod, live on the Flux games hub.
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
export const BATCH9_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Garry's Mod: on a flat construct floor, a player swings the physics gun's beam and
// stacks props into a tower -- crate, crate, barrel -- and crowns it with a melon. The
// outro: a red ERROR model drops in beside the tower, the props tumble off one by one and
// the player noclips up and out of the frame.
// =======================================================================================

// The construct map's grid floor.
const FLOOR = '_|__'.repeat(9).slice(0, LOGO_WIDTH);
// Rows 2-4: the player, physics gun held out to the right.
const PLAYER = [' o', '/|=='];
const PLAYER_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
// The beam's two shimmer phases.
const BEAM = ['~-', '-~'];
const TOWER_COLUMN = 22;
// Bottom to top, rows 4 to 1. The melon is the crown.
const PROPS = ['[X]', '[X]', '(=)', '(@)'];
const ERROR = 'ERROR';
const ERROR_COLUMN = 28;

function gmodScene() {
  const rows = blankRows();
  rows[5] = FLOOR;
  return rows;
}

function playerAt(rows, column, step) {
  rows[2] = overlayAt(rows[2], column, PLAYER[0]);
  rows[3] = overlayAt(rows[3], column, PLAYER[1]);
  rows[4] = overlayAt(rows[4], column, PLAYER_LEGS[step % 2]);
}

// Stacks the first `count` props up from row 4.
function towerOf(rows, count) {
  for (let p = 0; p < count; p++) rows[4 - p] = overlayAt(rows[4 - p], TOWER_COLUMN, PROPS[p]);
}

// The beam from the gun's muzzle (row 3, column 4) to `toColumn` on row 3, shimmering.
function beamTo(rows, toColumn, step) {
  const length = Math.max(0, toColumn - 4);
  rows[3] = overlayAt(rows[3], 4, BEAM[step % 2].repeat(length).slice(0, length));
}

// The intro: each prop rides the beam in on row 3 and settles onto the tower. `HELD` is
// where the carried prop is (null once the tower is finished); `PLACED` how many stand.
const HELD = [10, 16, 10, 16, 10, 16, 16, null];
const PLACED = [0, 0, 1, 1, 2, 2, 3, 4];

export function formatGmodFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = gmodScene();
  rows[0] = overlayAt(rows[0], 8 + (index % 4) * 3, skyOf(ctx).wisp);
  rows[1] = overlayAt(rows[1], 26 + (index % 4) * 2, skyOf(ctx).wisp);
  towerOf(rows, PLACED[index]);
  playerAt(rows, 0, index);
  const held = HELD[index];
  if (held !== null) {
    beamTo(rows, held, index);
    rows[2] = overlayAt(rows[2], held, PROPS[PLACED[index]]);
  } else {
    // Done: the beam reaches the tower and the melon sparkles.
    beamTo(rows, TOWER_COLUMN - 1, index);
    rows[0] = overlayAt(rows[0], TOWER_COLUMN, index % 2 ? ' * ' : '* *');
  }
  return rows;
}

export const gmodFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the ERROR model drops in beside the tower, the props fall away top first and
// roll left along the floor, and the player noclips up out of the top of the frame.
const ERROR_ROW = [1, 2, 3, 4, 4, 4, 4, 4];
const STANDING = [4, 4, 4, 3, 2, 1, 0, 0];
const PLAYER_TOP = [2, 2, 2, 1, 1, 0, -1, -2];

export function formatGmodOutro(step = 0) {
  const index = wrap(step);
  const rows = gmodScene();
  towerOf(rows, STANDING[index]);
  // The fallen props, lying on row 4 left of the tower, more each time one drops.
  for (let p = STANDING[index]; p < PROPS.length; p++) {
    rows[4] = overlayAt(rows[4], TOWER_COLUMN - 4 * (PROPS.length - p), PROPS[p]);
  }
  // The ERROR model, falling to the floor and settling there.
  rows[ERROR_ROW[index]] = overlayAt(rows[ERROR_ROW[index]], ERROR_COLUMN, ERROR);
  // Noclip: the player floats straight up, legs and all, from step 2.
  const top = PLAYER_TOP[index];
  const art = [PLAYER[0], PLAYER[1], PLAYER_LEGS[index % 2]];
  art.forEach((line, i) => {
    const row = top + i;
    if (row >= 0 && row <= 4) rows[row] = overlayAt(rows[row], 0, line);
  });
  // A noclip trail below the player once it has left the floor.
  for (let r = Math.max(0, top + 3); r <= 4; r++) rows[r] = overlayAt(rows[r], 1, ':');
  rows[0] = overlayAt(rows[0], 12 + (index % 4) * 3, PLAIN_SKY.wisp);
  return rows;
}

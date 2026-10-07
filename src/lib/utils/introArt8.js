// Header intro art, batch 8 (issue #521): Arma Reforger, live on the Flux games hub.
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
export const BATCH8_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Arma Reforger: a transport helicopter flies in over Everon's pines and sets down by a
// capture point; a soldier jumps out, runs to the pole and raises the flag. The outro: a
// tank rolls in from the right, the flag comes down, and the helicopter lifts off and
// flies away to the left.
// =======================================================================================

// Rows 0-4, against the left edge: a pine.
const PINE = ['  ^  ', ' /^' + BSLASH + ' ', '/^^^' + BSLASH, '  |  ', '  |  '];
const GROUND = "_.,_-'".repeat(6).slice(0, LOGO_WIDTH);
// Three rows: rotor (two blade positions, alternating), cabin, skids. Facing right, and
// mirrored for the flight out.
const ROTORS = ['  --=+=--', '  =--+--='];
const HELI_RIGHT = ['-+=[__o]', "   '-'-'"];
const HELI_LEFT = ['[o__]=+-', "'-'-'   "];
const ROTORS_LEFT = ['--=+=--', '=--+--='];
// Rows 2-4: head, arms, legs (two strides).
const SOLDIER = [' o ', '/|' + BSLASH];
const SOLDIER_LEGS = ['/ ' + BSLASH, ' |' + BSLASH];
// The capture point: a pole on rows 1-4 with the flag beside it.
const POLE_COLUMN = 31;
const FLAG = '>';
// Rows 2-4, facing left: barrel, hull, tracks.
const TANK = ['==[##]', ' /####' + BSLASH, ' (oooo)'];

function armaScene() {
  const rows = blankRows();
  PINE.forEach((art, i) => { rows[i] = overlayAt(rows[i], 0, art); });
  rows[5] = GROUND;
  return rows;
}

function poleOf(rows, flagRow) {
  for (let r = 1; r <= 4; r++) rows[r] = overlayAt(rows[r], POLE_COLUMN, '|');
  rows[flagRow] = overlayAt(rows[flagRow], POLE_COLUMN + 1, FLAG);
}

// The helicopter with its rotor on row `top`; skids end up on row top + 2.
function heliAt(rows, column, top, step, facingLeft = false) {
  const rotor = (facingLeft ? ROTORS_LEFT : ROTORS)[step % 2];
  const [cabin, skids] = facingLeft ? HELI_LEFT : HELI_RIGHT;
  rows[top] = overlayAt(rows[top], column, rotor);
  rows[top + 1] = overlayAt(rows[top + 1], column, cabin);
  rows[top + 2] = overlayAt(rows[top + 2], column, skids);
}

function soldierAt(rows, column, step) {
  rows[2] = overlayAt(rows[2], column, SOLDIER[0]);
  rows[3] = overlayAt(rows[3], column, SOLDIER[1]);
  rows[4] = overlayAt(rows[4], column, SOLDIER_LEGS[step % 2]);
}

// The helicopter's path in: across and down, landed (skids on row 4) from step 4.
const HELI_IN_COLUMN = [6, 9, 12, 15, 17, 17, 17, 17];
const HELI_IN_TOP = [0, 0, 1, 1, 2, 2, 2, 2];
// The flag's row: at the foot of the pole until the soldier reaches it, then up.
const FLAG_UP = [4, 4, 4, 4, 4, 3, 2, 1];

export function formatArmaFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = armaScene();
  rows[0] = overlayAt(rows[0], 20 + (index % 4) * 2, skyOf(ctx).wisp);
  poleOf(rows, FLAG_UP[index]);
  heliAt(rows, HELI_IN_COLUMN[index], HELI_IN_TOP[index], index);
  if (index >= 5) soldierAt(rows, 20 + index, index);
  return rows;
}

export const armaFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The outro: the flag comes down while the tank closes in, and the helicopter climbs out.
const FLAG_DOWN = [1, 1, 2, 2, 3, 3, 4, 4];
const HELI_OUT_COLUMN = [17, 17, 14, 11, 8, 5, 2, -1];
const HELI_OUT_TOP = [2, 1, 1, 0, 0, 0, 0, 0];

export function formatArmaOutro(step = 0) {
  const index = wrap(step);
  const rows = armaScene();
  heliAt(rows, HELI_OUT_COLUMN[index], HELI_OUT_TOP[index], index, true);
  const tank = 32 - index * 2;
  TANK.forEach((art, i) => { rows[2 + i] = overlayAt(rows[2 + i], tank, art); });
  // A tracer from the barrel every other step.
  if (index % 2 === 1) rows[2] = overlayAt(rows[2], tank - 4, '- -');
  // The pole stands in front of the tank as it rolls past.
  poleOf(rows, FLAG_DOWN[index]);
  return rows;
}

// Header intro art, batch 6 (issue #514): ARK: Survival Ascended, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intro is green
// (ROW_KIND_DEPLOYED); the outro is keyed like the intro and plays in orange
// (outroFrameKinds, applied by the component).
//
// Deliberately not the ARK Survival (Evolved) sauropod from introArt3.js: they are two
// games with two rows on the card, and the header should tell them apart too.
import { PLAIN_SKY } from './seasons.js';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH6_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// Paints `art` at `column` with its inner spaces opaque, so whatever it passes in front of
// does not show through -- the same trick as the ARK sauropod.
function solidAt(row, column, art) {
  const start = art.search(/\S/);
  if (start < 0) return row;
  const solid = art.slice(start).replace(/ /g, ' ');
  return overlayAt(row, column + start, solid).replace(/ /g, ' ');
}

// =======================================================================================
// ARK: Survival Ascended: a raptor sprints past an obelisk while a supply drop parachutes
// down onto the beach. The outro: a Rex stomps in from the right and crushes the drop.
// =======================================================================================

// Rows 0-4, against the left edge.
const OBELISK = [' /' + BSLASH, ' ||', ' ||', ' ||', '/__' + BSLASH];
// Rows 2-4, facing right. Two leg poses so the sprint shows.
const RAPTOR = ['   ,o>', '~-/_/'];
const RAPTOR_LEGS = ['  /' + BSLASH, '  |' + BSLASH];
const DROP_COLUMN = 28;
const CHUTE = '(^)';
const CRATE = '[+]';
const SMASHED_CRATE = '_x_';
const SAND = '_.,;__,._'.repeat(4);

function arkAscendedScene() {
  const rows = blankRows();
  OBELISK.forEach((art, i) => { rows[i] = overlayAt(rows[i], 0, art); });
  rows[5] = SAND.slice(0, LOGO_WIDTH);
  return rows;
}

function raptorAt(rows, column, step) {
  rows[2] = overlayAt(rows[2], column, RAPTOR[0]);
  rows[3] = overlayAt(rows[3], column, RAPTOR[1]);
  rows[4] = overlayAt(rows[4], column, RAPTOR_LEGS[step % 2]);
}

// The crate's row each step: it floats down under its chute, then lands on row 4 and its
// beacon beam stands over it.
const DROP_ROWS = [0, 1, 1, 2, 2, 3, 4, 4];

export function formatArkAscendedFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = arkAscendedScene();
  rows[0] = overlayAt(rows[0], 6 + (index % 4) * 3, skyOf(ctx).wisp);
  const dropRow = DROP_ROWS[index];
  if (dropRow < 4) {
    if (dropRow > 0) rows[dropRow - 1] = overlayAt(rows[dropRow - 1], DROP_COLUMN, CHUTE);
  } else {
    for (let r = 0; r < 4; r++) rows[r] = overlayAt(rows[r], DROP_COLUMN + 1, '|');
  }
  rows[dropRow] = overlayAt(rows[dropRow], DROP_COLUMN, CRATE);
  raptorAt(rows, 5 + index * 2, index);
  return rows;
}

export const arkAscendedFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Rows 1-4, facing left: the jaws, the body and tail, and two leg poses.
const REX = ['  ___', ' <__ ' + BSLASH + '___', '  vv' + BSLASH + '    ' + BSLASH + '~'];
const REX_LEGS = ['     |/  |', '     /|  ' + BSLASH];
// The Rex's column each step, stomping left across the beach.
const OUTRO_REX = [27, 24, 21, 18, 15, 12, 9, 6];

export function formatArkAscendedOutro(step = 0) {
  const index = wrap(step);
  const rows = arkAscendedScene();
  const column = OUTRO_REX[index];
  // The drop stands with its beam until the Rex stomps on it, then lies smashed.
  const crushed = column + 5 <= DROP_COLUMN + 1;
  if (crushed) {
    rows[4] = overlayAt(rows[4], DROP_COLUMN, SMASHED_CRATE);
  } else {
    for (let r = 0; r < 4; r++) rows[r] = overlayAt(rows[r], DROP_COLUMN + 1, '|');
    rows[4] = overlayAt(rows[4], DROP_COLUMN, CRATE);
  }
  // The ground shakes under each stomp.
  rows[0] = overlayAt(rows[0], 6, index % 2 ? '* *' : ' * ');
  REX.forEach((art, i) => { rows[1 + i] = solidAt(rows[1 + i], column, art); });
  rows[4] = solidAt(rows[4], column, REX_LEGS[index % 2]);
  return rows;
}

// Header intro art, batch 18 (issue #549): BeamMP, BeamNG.drive multiplayer, live on the
// Flux games hub.
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
export const BATCH18_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };

// =======================================================================================
// BeamMP: BeamNG.drive is a soft-body driving game, known for its crashes, and the BeamMP
// emblem is two cars meeting head-on inside a steering wheel. The intro: two cars race in
// from either side, meet in the middle, their bonnets crumple and sparks fly, and a wheel
// comes off and rolls away. The outro: the wrecks smoke, a tow truck reverses in, hooks one
// and hauls it off, and the other is left by the barrier.
// =======================================================================================

// Rows 1-3: a car facing right, and its mirror facing left. Crumpled, the bonnet folds
// back to a '}' and the car is two columns shorter.
const CAR_R = ['  ___   ', ' /_|_' + BSLASH + '__', "'-o---o'"];
const CAR_L = ['   ___  ', '__/_|_' + BSLASH + ' ', "'o---o-'"];
const WRECK_R = ['  ___ ', ' /_|_}', "'-o--o"];
const WRECK_L = [' ___  ', '{_|_' + BSLASH + ' ', "o--o-'"];
// The left-facing wreck once its front wheel has come off: the corner drags on the road.
const WRECK_L_BROKEN = [' ___  ', '{_|_' + BSLASH + ' ', "_--o-'"];
const CAR_WIDTH = CAR_R[0].length;
const WRECK_WIDTH = WRECK_R[0].length;

// Row 4: the crash barrier along the road's edge, the scene's signature: it is in every
// frame of both sequences, and nothing else in the header draws it. Row 5: the centre line.
const BARRIER = ']=['.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);
const CENTRE_LINE = '-- '.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The cars meet at this column: the right-facing car's nose touches the left-facing car's.
const IMPACT = 17;

function world(ctx, index) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 1, sky.sun);
  rows[0] = overlayAt(rows[0], 26 - (index % 4) * 2, sky.wisp);
  rows[4] = BARRIER;
  rows[5] = CENTRE_LINE;
  return rows;
}

function draw(rows, column, art) {
  art.forEach((line, i) => put(rows, 1 + i, column, line));
}

// Per intro frame: the cars close in at speed (0-2), hit (3), the sparks burst (4), and the
// wrecks rock back apart while a loose wheel rolls off to the right (5-7).
const INTRO_R = [0, 4, IMPACT - CAR_WIDTH - 1, IMPACT - WRECK_WIDTH, IMPACT - WRECK_WIDTH, 10, 9, 9];
const INTRO_L = [26, 22, IMPACT + 1, IMPACT, IMPACT, 18, 19, 19];
const SPARKS = [
  null,
  null,
  null,
  [[0, IMPACT - 2, BSLASH + '|/'], [1, IMPACT - 1, '*']],
  [[0, IMPACT - 6, '.  ' + BSLASH + ' | /  .'], [1, IMPACT - 1, '*'], [1, IMPACT - 7, '.'], [1, IMPACT + 6, '.']],
  [[0, IMPACT - 2, '. * .']],
  [[0, IMPACT - 1, '~ ~']],
  [[0, IMPACT, '~']]
];
const LOOSE_WHEEL = [null, null, null, null, null, 27, 29, 31];

export function formatBeamMpFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  const crashed = index >= 3;
  draw(rows, INTRO_R[index], crashed ? WRECK_R : CAR_R);
  draw(rows, INTRO_L[index], !crashed ? CAR_L : LOOSE_WHEEL[index] === null ? WRECK_L : WRECK_L_BROKEN);
  // Speed lines behind each car as they close in.
  if (index < 2) {
    put(rows, 2, INTRO_R[index] - 2, '==');
    put(rows, 2, INTRO_L[index] + CAR_WIDTH, '==');
  }
  for (const [row, column, art] of SPARKS[index] ?? []) put(rows, row, column, art);
  if (LOOSE_WHEEL[index] !== null) put(rows, 3, LOOSE_WHEEL[index], 'o');
  return rows;
}

export const beamMpFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Rows 1-3: the tow truck, facing right with its boom out behind it.
const TOW = [BSLASH + '   __ ', ' ' + BSLASH + '_|__' + BSLASH, " 'o--o'"];
const TOW_WIDTH = TOW[1].length;

// The outro: the wrecks sit smoking (0-1), the tow truck reverses in from the right (2-3),
// hooks the left-facing wreck (4), and hauls it off the right edge (5-6), leaving the
// other wreck alone by the barrier (7).
const OUTRO_HAULED = [IMPACT, IMPACT, IMPACT, IMPACT, IMPACT, 21, 25, null];
const OUTRO_TOW = [null, null, 30, 26, ...OUTRO_HAULED.slice(4).map(c => (c === null ? null : c + WRECK_WIDTH))];
const OUTRO_SMOKE = ['~', ' ~', '~', ' ~', '~', ' ~', '~', ' ~'];

export function formatBeamMpOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  const leftWreck = IMPACT - WRECK_WIDTH;
  draw(rows, leftWreck, WRECK_R);
  put(rows, 0, leftWreck + 3, OUTRO_SMOKE[index]);
  if (OUTRO_HAULED[index] !== null) draw(rows, OUTRO_HAULED[index], WRECK_L_BROKEN);
  const tow = OUTRO_TOW[index];
  if (tow !== null) {
    draw(rows, tow, TOW);
    // Hooked: the chain runs from the boom's tip down to the wreck's back bumper.
    if (index >= 4) put(rows, 2, tow - 1, '==');
  }
  return rows;
}

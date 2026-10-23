// Header intro art, batch 19 (issue #556): Soulmask, live on the Flux games hub.
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
export const BATCH19_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Soulmask: a survival game whose hero is chosen by an ancient mask that lends its wearer
// power, set in the jungle of the Cloud Mist Forest, and its emblem is a tribal mask. The
// intro: the mask drifts in over a tribesman, settles on his face, its eyes ignite, and he
// raises his spear. The outro: the eyes dim and go dark, the mask cracks and falls, the
// tribesman walks off, and moss grows over the mask where it lies.
// =======================================================================================

// The mask: a crest, two eyes either side of the bar down its middle, and a row of teeth.
// Its eyes are lit ('*'), dormant ('o') or dead ('.'); cracked, the crest splits.
const mask = (eye = 'o', crest = '/^|^' + BSLASH) => [crest, '|' + eye + '|' + eye + '|', BSLASH + 'vvv/'];
const CRACKED_CREST = '/^/^' + BSLASH;
const MASK_WIDTH = 5;

// The tribesman: a head on row 3, a body on row 4, legs on the ground row. Masked, the
// mask's teeth sit where his head was.
const BODY = '/|' + BSLASH;
const LEGS = '/ ' + BSLASH;
const HEAD = 'o';
// The spear, held upright beside him once the mask has woken: its tip clears the mask,
// and his arm reaches across to the shaft.
const SPEAR = ['^', '|', '|', '|', '|'];
const SPEAR_ARM = '_';

// Rows 1-4: a palm at either edge of the clearing.
const PALM = [BSLASH + BSLASH + '|//', ' ' + BSLASH + '|/ ', '  |  ', '  |  '];
const PALM_COLUMNS = [0, LOGO_WIDTH - PALM[0].length];

// Row 5: the jungle floor, the scene's signature: it is in every frame of both sequences,
// and nothing else in the header draws it.
const FLOOR = ".,;'".repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// Where the tribesman stands: his body starts here, his head is one column in, and the
// mask lines up over his head.
const STAND = 15;
const MASK_ON = STAND - 1;

function world(ctx, index) {
  const rows = blankRows();
  const sky = skyOf(ctx);
  rows[0] = overlayAt(rows[0], 1, sky.sun);
  rows[0] = overlayAt(rows[0], 28 - (index % 4) * 2, sky.wisp);
  for (const column of PALM_COLUMNS) draw(rows, 1, column, PALM);
  rows[5] = FLOOR;
  return rows;
}

function tribesman(rows, column, { masked = false, spear = false } = {}) {
  if (!masked) put(rows, 3, column + 1, HEAD);
  put(rows, 4, column, BODY);
  put(rows, 5, column, LEGS);
  if (spear) {
    put(rows, 4, column + 3, SPEAR_ARM);
    draw(rows, 0, column + 4, SPEAR);
  }
}

// Per intro frame: the mask drifts in from the left, high above the clearing (0-2), comes
// down onto his face (3), its eyes ignite (4), light pours out of them (5), and he raises
// his spear in its glow (6-7).
const INTRO_MASK = [[0, 6], [0, 10], [0, MASK_ON], [1, MASK_ON], [1, MASK_ON], [1, MASK_ON], [1, MASK_ON], [1, MASK_ON]];
const INTRO_EYES = ['o', 'o', 'o', 'o', '*', '*', '*', '*'];
const INTRO_GLOW = [
  null,
  null,
  null,
  null,
  [[0, MASK_ON + 2, '.']],
  [[0, MASK_ON, BSLASH + ' | /'], [2, MASK_ON - 3, '-- '], [2, MASK_ON + MASK_WIDTH, ' --']],
  // The spear stands on the right from here, so the glow fades on the left alone.
  [[0, MASK_ON + 1, '. .'], [2, MASK_ON - 2, '- ']],
  [[0, MASK_ON + 1, ' * '], [2, MASK_ON - 2, '. ']]
];

export function formatSoulmaskFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  const [maskRow, maskColumn] = INTRO_MASK[index];
  tribesman(rows, STAND, { masked: maskRow === 1 });
  draw(rows, maskRow, maskColumn, mask(INTRO_EYES[index]));
  for (const [row, column, art] of INTRO_GLOW[index] ?? []) put(rows, row, column, art);
  // Drawn last, so the glow never hides it.
  if (index >= 6) tribesman(rows, STAND, { masked: true, spear: true });
  return rows;
}

export const soulmaskFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the masked tribesman, eyes still lit (0), dimming (1) and dead (2); the
// mask cracks (3) and falls to the ground beside him (4); he walks off to the left (5-6)
// and is gone, leaving the mask under the moss (7).
const OUTRO_EYES = ['*', 'o', '.', '.', '.', '.', '.', '.'];
const OUTRO_STAND = [STAND, STAND, STAND, STAND, STAND, 11, 7, null];
// Where the fallen mask lies, its teeth on the ground row.
const FALLEN = [3, 20];
const OUTRO_MOSS = [null, null, null, null, null, null, ',', '~,~'];

export function formatSoulmaskOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(ctx, index);
  const stand = OUTRO_STAND[index];
  const worn = index < 4;
  if (stand !== null) tribesman(rows, stand, { masked: worn });
  const face = mask(OUTRO_EYES[index], index >= 3 ? CRACKED_CREST : undefined);
  if (worn) {
    draw(rows, 1, MASK_ON, face);
    if (index === 3) put(rows, 0, MASK_ON + 2, "'");
  } else {
    draw(rows, FALLEN[0], FALLEN[1], face);
    if (OUTRO_MOSS[index] !== null) put(rows, 2, FALLEN[1] + 1, OUTRO_MOSS[index]);
  }
  return rows;
}

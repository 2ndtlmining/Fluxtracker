// Header intro art, batch 27: Killing Floor 2, live on the Flux games hub.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intro is green
// (ROW_KIND_DEPLOYED); the outro is keyed like the intro and plays in orange
// (outroFrameKinds, applied by the component).
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH27_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Killing Floor 2: a squad holds a Horzine lab against waves of Zeds, the company's failed
// clones. The intro is one wave: a survivor holds the line with clots shambling in from
// the far end of the lab, opens up, drops the first, and the game's slow motion kicks in
// for the last kill -- "ZED TIME" -- then "WAVE CLEARED". The outro is the server's last
// wave: a Fleshpound walks in, soaks up the fire, enrages and charges, the gun clicks
// empty and it flattens them -- "SQUAD WIPED". (Zomboid and 7 Days to Die have zombies
// too; this is the only scene that is a firefight, and the only one with slow motion.)
// =======================================================================================

// Row 0: the lab's ceiling pipe. In every frame, so the top row is never empty.
const CEILING = '====o'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// Row 1: the strip lights hanging off it. They dim to embers in Zed Time.
const LAMPS_AT = [4, 19, 29];
const LAMP = { on: 'V', dim: '.' };

// Row 5: the lab floor, the scene's signature: it is in every frame of both sequences,
// nothing stands on it (the figures' feet are on row 4) and nothing else draws it.
const FLOOR = '-=._'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The survivor, rows 2-4, rifle pointed right at the Zeds.
const SURVIVOR_AT = 2;
const HEAD = ' O ';
const AIM = '/|=';
const RELOAD = '/|_';
const CHEER = BSLASH + '|/';
const LEGS = '/ ' + BSLASH;
const DOWN = 'o__';                     // flattened, on row 4
const MUZZLE = '-';

// A clot: head on row 2, reaching arms on row 3, legs on row 4. The '@' head is the row
// the header smoke watches, since it moves across the lab from frame to frame.
const CLOT = [' @ ', '<|' + BSLASH, '/ ' + BSLASH];
const HIT = '*';                        // the head shot, in place of the head
const CORPSE = 'x__';

// The Fleshpound: bigger, a glowing chest, and the same '@' head.
const FLESHPOUND = ['{@}', '<H>', '/ ' + BSLASH];
const RAGE_CHEST = '<*>';
const RAGE = '!!';

const ZED_TIME = ' ZED TIME ';
const CLEARED = ' WAVE CLEARED ';
const WIPED = ' SQUAD WIPED ';
const ZED_TIME_AT = 12;
const BANNER_AT = 10;

function world({ dim = false } = {}) {
  const rows = blankRows();
  rows[0] = CEILING;
  for (const column of LAMPS_AT) put(rows, 1, column, dim ? LAMP.dim : LAMP.on);
  rows[5] = FLOOR;
  return rows;
}

function survivor(rows, column, body = AIM) {
  draw(rows, 2, column, [HEAD, body, LEGS]);
}

// Tracers along row 3 from the muzzle to just short of the target; `dotted` is the slow
// motion of Zed Time, the rounds hanging in the air.
function fire(rows, from, to, dotted = false) {
  put(rows, 3, from, MUZZLE);
  for (let column = from + 2; column < to; column += 2) put(rows, 3, column, dotted ? '.' : '-');
}

// Unlike put(), this writes its spaces too: a clear margin for the banner.
function stamp(rows, row, column, text) {
  rows[row] = rows[row].slice(0, column) + text + rows[row].slice(column + text.length);
}

// Per intro frame, the two clots' columns (null = not in the lab yet, 'dead' = down) and
// whether the survivor is firing. They come in from the right (0-1); the survivor opens up
// (2) and drops the first with a head shot (3); Zed Time: the lights dim and the rounds
// hang in the air (4) until the second one's head goes (5); the wave is cleared, they
// reload (6) and throw their arms up (7).
const CLOT_A = [30, 26, 22, 22, 'dead', 'dead', 'dead', 'dead'];
// In Zed Time (4-5) the second one barely moves.
const CLOT_B = [null, 31, 28, 26, 25, 25, 'dead', 'dead'];
const A_CORPSE_AT = 22;
const B_CORPSE_AT = 25;
const INTRO_FIRE = [false, false, true, true, true, true, false, false];

function clot(rows, at, corpseAt, hit) {
  if (at === null) return;
  if (at === 'dead') { put(rows, 4, corpseAt, CORPSE); return; }
  draw(rows, 2, at, CLOT);
  if (hit) put(rows, 2, at + 1, HIT);
}

export function formatKillingFloor2Frame(step = 0, ctx = {}) {
  const index = wrap(step);
  const zedTime = index === 4 || index === 5;
  const rows = world({ dim: zedTime });
  clot(rows, CLOT_A[index], A_CORPSE_AT, index === 3);
  clot(rows, CLOT_B[index], B_CORPSE_AT, index === 5);
  survivor(rows, SURVIVOR_AT, index === 6 ? RELOAD : index === 7 ? CHEER : AIM);
  if (INTRO_FIRE[index]) {
    // At whichever clot is still standing: the first until it drops, then the second.
    const target = typeof CLOT_A[index] === 'number' ? CLOT_A[index] : CLOT_B[index];
    fire(rows, SURVIVOR_AT + 3, target, zedTime);
  }
  if (zedTime) stamp(rows, 1, ZED_TIME_AT, ZED_TIME);
  if (index >= 6) stamp(rows, 1, BANNER_AT, CLEARED);
  return rows;
}

export const killingFloor2FrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame, the Fleshpound's column and the survivor's. It walks in under fire
// (0-1) and enrages (2); it charges and the gun clicks empty (3); the survivor backs off
// as it closes (4) and it hits them (5); they are down, "SQUAD WIPED" (6), and it lumbers
// off for the next one (7).
const POUND_AT = [30, 26, 22, 13, 7, 4, 5, 9];
const OUTRO_SURVIVOR_AT = [2, 2, 2, 2, 0, 0, null, null];
const OUTRO_FIRE = [true, true, true, false, false, false, false, false];
const CORPSE_AT = 0;

export function formatKillingFloor2Outro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world();
  const at = POUND_AT[index];
  const raging = index >= 2 && index <= 5;
  draw(rows, 2, at, FLESHPOUND);
  if (raging) {
    put(rows, 3, at, RAGE_CHEST);
    put(rows, 1, at + 1, RAGE);
  }
  // The rounds it soaks up spark off its chest.
  if (index === 1) put(rows, 3, at + 1, HIT);
  const survivorAt = OUTRO_SURVIVOR_AT[index];
  if (survivorAt === null) put(rows, 4, CORPSE_AT, DOWN);
  else survivor(rows, survivorAt);
  if (OUTRO_FIRE[index]) fire(rows, survivorAt + 3, at);
  // Out of ammo.
  if (index === 3) put(rows, 1, survivorAt, 'click');
  // The hit.
  if (index === 5) put(rows, 2, at - 1, HIT);
  if (index >= 6) stamp(rows, 1, BANNER_AT, WIPED);
  return rows;
}

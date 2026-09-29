// Header intro art, batch 3 (issue #418): the four games that still played the shared
// gamepad -- Enshrouded, Rust, Windrose, Terraria -- each with an outro, plus the FiveM
// outro its intro (#280) never had.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. Intros are
// green (ROW_KIND_DEPLOYED); outros are keyed like the intros and play in orange
// (outroFrameKinds, applied by the component).
import { PLAIN_SKY } from './seasons.js';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  rotateStrip,
  overlayAt
} from './terminalAnimation.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH3_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const skyOf = ctx => ctx?.sky ?? PLAIN_SKY;

// =======================================================================================
// Enshrouded: a Flame Altar pushes back the Shroud -- a churning %%/:: band rolling in from
// the right -- as its flame grows. The outro runs it the other way: the Shroud rolls back
// over the altar and the flame gutters out.
// =======================================================================================

// 36 columns is a whole number of '%%::' periods, so rotating then slicing has no seam.
const SHROUD = '%%::'.repeat(9);
// Four flame sizes, three rows each (rows 1-3), all five columns wide.
const ALTAR_FLAMES = [
  ['     ', '     ', '  ,  '],
  ['     ', '  (  ', ' ( ) '],
  ['  )  ', ' ( ( ', '( ) )'],
  [' ) ( ', '( ) )', '(( ))']
];
const ALTAR = '_[###]_';
const ALTAR_COLUMN = 3;
const FLAME_COLUMN = 4;
const ENSHROUDED_GROUND = '.,_.'.repeat(9);

function enshroudedScene(index, stage, edge) {
  const rows = blankRows();
  // The Shroud fills everything right of its edge, each row churning at its own phase.
  for (let r = 0; r < BOOT_LINE_COUNT - 1; r++) {
    const band = rotateStrip(SHROUD, index + r * 2).slice(0, LOGO_WIDTH);
    rows[r] = rows[r].slice(0, edge) + band.slice(edge);
  }
  // Sparks over the flame once it has caught.
  if (stage > 0) rows[0] = overlayAt(rows[0], FLAME_COLUMN + 1 + (index % 3), index % 2 ? "'" : '*');
  ALTAR_FLAMES[stage].forEach((art, i) => {
    // The flame flickers: mirror it on odd steps.
    const pose = index % 2 ? art.split('').reverse().join('').replace(/[()]/g, c => (c === '(' ? ')' : '(')) : art;
    rows[1 + i] = overlayAt(rows[1 + i], FLAME_COLUMN, pose);
  });
  rows[4] = overlayAt(rows[4], ALTAR_COLUMN, ALTAR);
  rows[5] = rotateStrip(ENSHROUDED_GROUND, index).slice(0, LOGO_WIDTH);
  return rows;
}

const SHROUD_EDGES = [14, 16, 18, 20, 22, 24, 26, 28];
const FLAME_STAGES = [0, 1, 1, 2, 2, 3, 3, 3];

export function formatEnshroudedFrame(step = 0) {
  const index = wrap(step);
  return enshroudedScene(index, FLAME_STAGES[index], SHROUD_EDGES[index]);
}

export const enshroudedFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

export function formatEnshroudedOutro(step = 0) {
  const index = wrap(step);
  const back = FRAME_COUNT - 1 - index;
  // Rolls over the altar at the end: the edge passes column 4 so the flame is swallowed.
  const edges = [28, 25, 22, 19, 16, 13, 9, 5];
  return enshroudedScene(index, FLAME_STAGES[back], edges[index]);
}

// =======================================================================================
// Rust: a cargo plane crosses row 0 and drops a crate, which parachutes down beside a
// wooden shack and starts smoking. The outro is what Rust does to an unpaid base: it
// decays, a piece per step, to rubble -- which is what an expiring app is about to do.
// =======================================================================================

const PLANE = '-=[==]>';
const PLANE_COLUMNS = [0, 4, 8, 12, 16, 20, 24, 28];
const RUST_TREE = ['  ^', ' /|' + BSLASH, '/_|_' + BSLASH, '  |'];
const RUST_TREE_COLUMN = 1;
const SHACK = ['  ______', ' /______' + BSLASH, ' | [] |=|', ' |____|_|'];
const SHACK_COLUMN = 24;
const CRATE = '[#]';
const CHUTE = '/^' + BSLASH;
const CRATE_COLUMN = 16;
// Row the crate is on at each step: not yet dropped, falling, then landed on row 4.
const CRATE_ROWS = [null, null, 1, 2, 3, 4, 4, 4];
const RUST_GROUND = '_.,__,._'.repeat(5);

function rustBase(rows) {
  RUST_TREE.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], RUST_TREE_COLUMN, art); });
  rows[5] = RUST_GROUND.slice(0, LOGO_WIDTH);
  return rows;
}

export function formatRustFrame(step = 0) {
  const index = wrap(step);
  const rows = rustBase(blankRows());
  SHACK.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], SHACK_COLUMN, art); });
  rows[0] = overlayAt(rows[0], PLANE_COLUMNS[index], PLANE);
  const crateRow = CRATE_ROWS[index];
  if (crateRow !== null) {
    rows[crateRow] = overlayAt(rows[crateRow], CRATE_COLUMN, CRATE);
    if (crateRow < 4) rows[crateRow - 1] = overlayAt(rows[crateRow - 1], CRATE_COLUMN, CHUTE);
    else rows[3] = overlayAt(rows[3], CRATE_COLUMN + 1, index % 2 ? '(' : ')');   // the airdrop's smoke
  }
  return rows;
}

export const rustFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The shack losing a piece per step, top down. Rows 1-4; a null row is gone.
const SHACK_DECAY = [
  SHACK,
  ['  _ __ _', ' /______' + BSLASH, ' | [] |=|', ' |____|_|'],
  [null, ' /__ ___' + BSLASH, ' | [] |=|', ' |____|_|'],
  [null, ' / _   _' + BSLASH, ' | [] | |', ' |____|_|'],
  [null, null, ' | [] | |', ' |____|_|'],
  [null, null, ' |  . |  ', ' |_.__|_|'],
  [null, null, null, ' |_.__|_.'],
  [null, null, null, ' _.-,_._.']
];
// Dust from the collapse, one puff drifting up per step.
const DECAY_DUST = [null, [0, 27], [1, 29], [1, 26], [2, 28], [2, 25], [3, 27], [3, 30]];

export function formatRustOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = rustBase(blankRows());
  rows[0] = overlayAt(rows[0], 8, skyOf(ctx).sun);
  rows[0] = overlayAt(rows[0], 13 + index, skyOf(ctx).wisp);
  SHACK_DECAY[index].forEach((art, i) => { if (art) rows[1 + i] = overlayAt(rows[1 + i], SHACK_COLUMN, art); });
  const dust = DECAY_DUST[index];
  if (dust) rows[dust[0]] = overlayAt(rows[dust[0]], dust[1], index % 2 ? '.' : "'");
  return rows;
}

// =======================================================================================
// Windrose: a square-rigger on the waves -- three masts of square sails, not Valheim's
// longship -- with a compass needle turning a point per step, and a cannon puff. The outro:
// the ship lists and goes down.
// =======================================================================================

const SQUARE_RIGGER = [
  '   _|_  _|_  _|_',
  '  [___][___][___]',
  '   [_]  [_]  [_]',
  ' ____|____|____|__',
  ' ' + BSLASH + ' o  o  o  o  o /'
];
const SHIP_COLUMN = 0;
const COMPASS = [' . N . ', ' W o E ', ' . S . '];
const COMPASS_COLUMN = 26;
// The needle tip's [row, column] within the compass for N, NE, E, SE, S, SW, W, NW.
const NEEDLE = [[0, 3], [0, 5], [1, 5], [2, 5], [2, 3], [2, 1], [1, 1], [0, 1]];
// Cannon fire from the gun ports: flash, then the smoke drifting off.
const CANNON = [null, null, null, null, null, '=*', '(~)', ' ~ '];
// 36 columns is a whole number of periods, so rotating then slicing has no seam.
const SEA = '~-~^'.repeat(9);

function compassRows(rows, index) {
  COMPASS.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], COMPASS_COLUMN, art); });
  const [r, c] = NEEDLE[index];
  rows[1 + r] = overlayAt(rows[1 + r], COMPASS_COLUMN + c, '*');
  return rows;
}

export function formatWindroseFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = compassRows(blankRows(), index);
  rows[0] = overlayAt(rows[0], 20 + (index % 4), skyOf(ctx).bird);
  SQUARE_RIGGER.forEach((art, i) => { rows[i] = overlayAt(rows[i], SHIP_COLUMN, art); });
  if (CANNON[index]) rows[4] = overlayAt(rows[4], 19, CANNON[index]);
  rows[5] = rotateStrip(SEA, index).slice(0, LOGO_WIDTH);
  return rows;
}

export const windroseFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The ship sinks a row every other step and lists as it goes: the higher a row, the
// further it leans. Bubbles rise where it went down.
export function formatWindroseOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = compassRows(blankRows(), index);
  rows[0] = overlayAt(rows[0], 20 + (index % 4), skyOf(ctx).bird);
  const sink = Math.floor(index / 2);
  const lean = Math.min(index, 3);
  SQUARE_RIGGER.forEach((art, i) => {
    const row = i + sink;
    if (row < BOOT_LINE_COUNT - 1) rows[row] = overlayAt(rows[row], SHIP_COLUMN + Math.max(0, lean - i), art);
  });
  if (index >= 4) rows[4 - (index % 2)] = overlayAt(rows[4 - (index % 2)], 21, index % 2 ? 'o .' : '. o');
  rows[5] = rotateStrip(SEA, index).slice(0, LOGO_WIDTH);
  return rows;
}

// =======================================================================================
// Terraria: a 2D slice of the world -- a tree, a grass line, dirt over stone -- and a
// character mining a block per step, so the tunnel advances. The sun comes from ctx.sky.
// The outro: night falls and the Eye of Cthulhu rises.
// =======================================================================================

const TERRARIA_TREE = ['(@@@)', ' (@) ', '  |  '];
const TERRARIA_TREE_COLUMN = 1;
const GRASS = '"",'.repeat(12);
const DIRT = ':.:.'.repeat(9);
const STONE = '#=#='.repeat(9);
const SHAFT_COLUMN = 9;

function terrariaGround(rows, tunnelEnd) {
  rows[2] = GRASS.slice(0, LOGO_WIDTH);
  rows[3] = DIRT.slice(0, LOGO_WIDTH);
  rows[4] = STONE.slice(0, LOGO_WIDTH);
  rows[5] = rotateStrip(STONE, 1).slice(0, LOGO_WIDTH);
  TERRARIA_TREE.forEach((art, i) => { rows[i] = overlayAt(rows[i], TERRARIA_TREE_COLUMN, art); });
  // The shaft down from the grass, then the tunnel along rows 3-4, cleared to tunnelEnd.
  const clear = (row, from, to) => row.slice(0, from) + ' '.repeat(to - from) + row.slice(to);
  rows[2] = clear(rows[2], SHAFT_COLUMN, SHAFT_COLUMN + 2);
  for (const r of [3, 4]) rows[r] = clear(rows[r], SHAFT_COLUMN, tunnelEnd);
  return rows;
}

export function formatTerrariaFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const tunnelEnd = SHAFT_COLUMN + 3 + index * 2;
  const rows = terrariaGround(blankRows(), tunnelEnd);
  rows[0] = overlayAt(rows[0], 26, skyOf(ctx).sun);
  rows[0] = overlayAt(rows[0], 12 + (index % 4) * 2, skyOf(ctx).wisp);
  // The miner at the tunnel face: head and swinging pick on row 3, legs on row 4, and the
  // block just broken flying off the face.
  const miner = tunnelEnd - 2;
  rows[3] = overlayAt(rows[3], miner, index % 2 ? 'o-' : 'o/');
  rows[4] = overlayAt(rows[4], miner, index % 2 ? '/' + BSLASH : '||');
  rows[3] = overlayAt(rows[3], tunnelEnd, index % 2 ? '.' : ',');
  return rows;
}

export const terrariaFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Stars come out as the sun sets; from step 3 the Eye rises in the east.
const TERRARIA_STARS = [[14, 0], [20, 1], [8, 2], [17, 3], [11, 4], [22, 5]];
const EYE = '(O)~';
const SUNSET = [[26, 0], [27, 0], [28, 1], [29, 1]];
const EYE_RISE = [null, null, null, [28, 1], [27, 1], [26, 0], [25, 0], [24, 0]];

export function formatTerrariaOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = terrariaGround(blankRows(), SHAFT_COLUMN + 17);
  for (const [column, from] of TERRARIA_STARS) {
    if (index > from) rows[0] = overlayAt(rows[0], column, index % 2 ? '.' : '*');
  }
  if (index < SUNSET.length) {
    const [column, row] = SUNSET[index];
    rows[row] = overlayAt(rows[row], column, skyOf(ctx).sun);
  }
  const eye = EYE_RISE[index];
  if (eye) rows[eye[1]] = overlayAt(rows[eye[1]], eye[0], EYE);
  // The miner has climbed out and stands at the shaft, watching.
  rows[1] = overlayAt(rows[1], SHAFT_COLUMN, 'o');
  return rows;
}

// =======================================================================================
// FiveM outro: the road stops scrolling and the car pulls away, leaving an exhaust puff
// where it stood. The car faces left (bonnet first), so it leaves to the left.
// =======================================================================================

const FIVEM_ROAD = '==  '.repeat(9);
const FIVEM_CAR = [
  '     ______',
  '____/_[]_[]' + BSLASH + '___',
  '|_  _____  _   |'
];
const FIVEM_CAR_COLUMN = 4;
const FIVEM_DRIVE = [0, 0, -2, -5, -9, -14, -20, -27];
const FIVEM_PALM = [BSLASH + '|/', ' |', ' |', ' |'];
const FIVEM_PALM_COLUMN = 30;
// The puff left behind at the exhaust, swelling and thinning.
const FIVEM_PUFF = ['=-', '-=', '~=', '(~)', '( ~ )', '(  ~ )', ' ~  ~ ', '  .  .'];

export function formatFivemOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = blankRows();
  rows[0] = overlayAt(overlayAt(rows[0], 4, skyOf(ctx).sun), 17, '~~~');
  FIVEM_PALM.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], FIVEM_PALM_COLUMN, art); });
  const column = FIVEM_CAR_COLUMN + FIVEM_DRIVE[index];
  FIVEM_CAR.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], column, art); });
  rows[3] = overlayAt(rows[3], FIVEM_CAR_COLUMN + FIVEM_CAR[2].length, FIVEM_PUFF[index]);
  const wheel = index < 2 ? '(o)' : '(_)';
  rows[4] = overlayAt(overlayAt(rows[4], column + 2, wheel), column + 10, wheel);
  rows[5] = FIVEM_ROAD.slice(0, LOGO_WIDTH);
  return rows;
}

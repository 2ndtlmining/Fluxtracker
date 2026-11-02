// Header intro art, batch 25: The Forest, live on the Flux games hub.
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
export const BATCH25_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// The Forest: the airliner is down in the woods, a painted man has carried the survivor's
// son off into the trees, and the survivor has to build, burn and hold out until he finds
// him. The intro is the first day: by the wreck's tail he fells a pine, builds a log
// cabin out of it and lights the fire -- "FIND TIMMY". The outro is the server's last
// night: a painted cannibal comes out of the trees carrying one of their stick effigies
// and plants it, the survivor shuts himself in the cabin, and the cannibal stamps his fire
// out -- "THE FIRE IS OUT". (Sons of the Forest's scene is a helicopter crashing; nothing
// crashes here: the plane has been down for days.)
// =======================================================================================

// Rows 0-4, against the right edge: the airliner's broken-off tail section, windows and
// all. Its fin reaches row 0, so the top row is never empty.
const TAIL_AT = 27;
const TAIL = ['  |' + BSLASH + '   ', '  | ' + BSLASH + '  ', '  |__' + BSLASH + '_', '[o_o_o]', '[_____]'];

// Row 5: the forest floor, the scene's signature: it is in every frame of both sequences,
// and nothing else draws it.
const FLOOR = '_;:'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The campfire on the floor between the cabin and the wreck: a cold woodpile, lit and
// flickering, then stamped out. Always on row 5, so the row the header smoke watches.
const FIRE_AT = 24;
const FIRE = { cold: ')_(', flame: [')*(', ')^('], out: ').(' };

// Rows 0-4 at the left: the pine he fells, and the stump it leaves.
const PINE_AT = 1;
const PINE = ['  ^  ', ' ^^^ ', '^^^^^', '  |  ', '  |  '];
const STUMP = '_|_';
const FELLED = '<====';                 // the trunk on the ground, crown to the left

// Rows 2-4: the log cabin, wall by wall; its door on row 4.
const CABIN_AT = 14;
const ROOF = '/^^^^^' + BSLASH;
const WALL = '|=====|';
const DOOR = { open: '|=[ ]=|', inside: '|=[o]=|', barred: '|=[#]=|' };

// The survivor: head on row 3, body on row 4, legs on the floor.
const HEAD = ' o ';
const BODY = '/|' + BSLASH;
const SWING = '-|' + BSLASH;            // the axe in the trunk
const CARRY = '/|=';                    // a log under his arm
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
const STANDING = '/ ' + BSLASH;

// A painted cannibal, and the stick effigy his tribe plants at the edge of a camp.
const CANNIBAL_HEAD = ' @ ';
const CANNIBAL_BODY = '/Y' + BSLASH;
const CANNIBAL_CHEER = BSLASH + 'Y/';
const EFFIGY = [BSLASH + 'o/', '-+-', ' | '];
const EFFIGY_AT = 7;

const FIND = 'FIND TIMMY';
const OUT = 'THE FIRE IS OUT';
const BANNER_AT = 2;

function world({ pine, cabin, door, fire }) {
  const rows = blankRows();
  draw(rows, 0, TAIL_AT, TAIL);
  rows[5] = FLOOR;
  if (pine === 'standing') draw(rows, 0, PINE_AT, PINE);
  else put(rows, 4, PINE_AT + 1, STUMP);
  if (cabin >= 1) put(rows, 4, CABIN_AT, cabin >= 3 ? DOOR[door] : WALL);
  if (cabin >= 2) put(rows, 3, CABIN_AT, WALL);
  if (cabin >= 3) put(rows, 2, CABIN_AT, ROOF);
  put(rows, 5, FIRE_AT, fire);
  return rows;
}

function figure(rows, column, head, body, legs) {
  put(rows, 3, column, head);
  put(rows, 4, column, body);
  put(rows, 5, column, legs);
}

const survivor = (rows, column, body = BODY, legs = STANDING) => figure(rows, column, HEAD, body, legs);
const cannibal = (rows, column, body = CANNIBAL_BODY) => figure(rows, column, CANNIBAL_HEAD, body, STANDING);

// Per intro frame: he walks up to the pine (0), raises the axe (1) and swings it into the
// trunk (2); the pine comes down (3); he carries the logs over as the cabin's walls go up
// (4-5); the roof goes on and the fire catches (6), and he raises the axe beside it under
// the banner (7).
const INTRO_AT = [9, 6, 6, 6, 8, 10, 21, 21];
const INTRO_CABIN = [0, 0, 0, 0, 1, 2, 3, 3];

export function formatTheForestFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world({
    pine: index < 3 ? 'standing' : 'felled',
    cabin: INTRO_CABIN[index],
    door: 'open',
    fire: index < 6 ? FIRE.cold : FIRE.flame[index % 2]
  });
  const at = INTRO_AT[index];
  if (index === 0) survivor(rows, at, BODY, STRIDES[0]);
  else if (index === 2) survivor(rows, at, SWING);
  else if (index === 4 || index === 5) survivor(rows, at, CARRY, STRIDES[index % 2]);
  else survivor(rows, at);
  // The axe raised over his head: before the swing, and over the lit fire.
  if (index === 1 || index === 7) put(rows, 2, at + 2, BSLASH);
  if (index === 3) put(rows, 4, PINE_AT + 4, FELLED);
  if (index >= 6) put(rows, 1, BANNER_AT, FIND);
  return rows;
}

export const theForestFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: night at the camp, the fire lit (0); a painted cannibal comes out of
// the trees with an effigy (1-2) and plants it by the stump (3) while the survivor runs
// for the cabin (2) and gets inside (3); the cannibal steps up to the cabin (4), goes
// round it to the fire (5), stamps it out (6) and the survivor bars the door (7).
const OUTRO_SURVIVOR = [21, 21, 21, null, null, null, null, null];
const OUTRO_CANNIBAL = [null, -1, 5, 10, 11, 21, 21, 21];
const OUTRO_DOOR = ['open', 'open', 'open', 'inside', 'inside', 'inside', 'inside', 'barred'];

export function formatTheForestOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world({
    pine: 'felled',
    cabin: 3,
    door: OUTRO_DOOR[index],
    fire: index < 6 ? FIRE.flame[index % 2] : FIRE.out
  });
  if (index >= 3) draw(rows, 2, EFFIGY_AT, EFFIGY);
  const at = OUTRO_SURVIVOR[index];
  if (at !== null) survivor(rows, at, BODY, index === 2 ? STRIDES[0] : STANDING);
  const them = OUTRO_CANNIBAL[index];
  if (them !== null) {
    cannibal(rows, them, index === 6 ? CANNIBAL_CHEER : CANNIBAL_BODY);
    // He carries the effigy over his head until he plants it.
    if (index < 3) put(rows, 2, them, BSLASH + 'o/');
  }
  if (index >= 6) put(rows, 1, BANNER_AT, OUT);
  return rows;
}

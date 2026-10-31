// Header intro art, batch 24: SCUM, live on the Flux games hub.
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
export const BATCH24_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// SCUM: survive the prison island, raid the bunkers -- all of it filmed for a TV show.
// The intro is a prisoner's first day: he wakes up washed up on the shore while the
// show's camera drone flies in to film him, walks inland to a bunker, prises its hatch
// open and finds the loot -- "SURVIVE THE ISLAND". The outro is the server's time running
// out: puppets climb out of the sea, the prisoner runs for the bunker and seals himself
// in, and the drone's recording light goes out as it flies off -- "END OF TRANSMISSION".
// =======================================================================================

// Row 0: the show's camera drone. Its recording light blinks while it films and goes out
// at the end of the broadcast; this is the row the header smoke watches move.
const drone = light => '<[' + light + ']>';
const REC = ['o', '*'];
const OFF = '.';

// Row 5: the sea at the left, then the island's sand and barbed wire. The scene's
// signature: it is in every frame of both sequences, and nothing else draws it.
const SEA = '~~~~';
const FLOOR = (SEA + '_.-x-.'.repeat(LOGO_WIDTH)).slice(0, LOGO_WIDTH);

// Rows 1-4, at the right: the concrete bunker, its hatch on row 4.
const BUNKER_AT = 25;
const BUNKER = [' ______ ', '/######' + BSLASH, '|######|', '|_    _|'];
const HATCH_AT = BUNKER_AT + 2;
const HATCH = { shut: '[==]', prised: '[/=]', loot: '[$$]', open: '[  ]', inside: '[o ]' };

// The prisoner in his striped jumpsuit: head on row 3, body on row 4, legs on the sand.
const HEAD = ' o ';
const SUIT = '/#' + BSLASH;
const PRISING = '/#-';                 // his crowbar in the hatch
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
const STANDING = '/ ' + BSLASH;
const WASHED_UP = 'o#=<';              // lying on the shore, row 4

// A puppet, the island's undead: hollow head, arms out.
const PUPPET_HEAD = ' x ';
const PUPPET_BODY = '-|-';
const PUPPET_LEGS = '/ ' + BSLASH;

const SURVIVE = 'SURVIVE THE ISLAND';
const TRANSMISSION = 'END OF TRANSMISSION';
const BANNER_AT = 2;

function world(hatch) {
  const rows = blankRows();
  draw(rows, 1, BUNKER_AT, BUNKER);
  put(rows, 4, HATCH_AT, HATCH[hatch]);
  rows[5] = FLOOR;
  return rows;
}

function prisoner(rows, column, body = SUIT, legs = STANDING) {
  put(rows, 3, column, HEAD);
  put(rows, 4, column, body);
  put(rows, 5, column, legs);
}

function puppet(rows, column) {
  put(rows, 3, column, PUPPET_HEAD);
  put(rows, 4, column, PUPPET_BODY);
  put(rows, 5, column, PUPPET_LEGS);
}

// Per intro frame: washed up on the shore (0), he gets up (1), walks inland (2-3) to the
// bunker and prises the hatch (4); it opens on the loot (5) and he raises his crowbar
// under the banner (6-7). The drone follows him in, filming.
const INTRO_DRONE = [0, 4, 8, 12, 16, 18, 18, 18];
const INTRO_AT = [3, 3, 9, 15, 22, 22, 22, 22];
const INTRO_HATCH = ['shut', 'shut', 'shut', 'shut', 'prised', 'loot', 'loot', 'loot'];

export function formatScumFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(INTRO_HATCH[index]);
  put(rows, 0, INTRO_DRONE[index], drone(REC[index % 2]));
  if (index === 0) put(rows, 4, INTRO_AT[0], WASHED_UP);
  else if (index === 1) prisoner(rows, INTRO_AT[1]);
  else if (index < 4) prisoner(rows, INTRO_AT[index], SUIT, STRIDES[index % 2]);
  else if (index === 4) prisoner(rows, INTRO_AT[4], PRISING);
  else prisoner(rows, INTRO_AT[index]);
  if (index >= 6) {
    // The crowbar raised over his head, away from the bunker.
    put(rows, 2, INTRO_AT[index], BSLASH);
    put(rows, 1, BANNER_AT, SURVIVE);
  }
  return rows;
}

export const scumFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// Per outro frame: the prisoner is out on the sand under the drone (0); puppets climb out
// of the sea (1-3) and he runs for the bunker (2-3), gets in (4) and the hatch slams
// shut (5); the drone's light goes out (6) and it flies off (7).
const OUTRO_DRONE = [14, 14, 16, 18, 20, 22, 24, 27];
const OUTRO_AT = [12, 12, 17, 22, null, null, null, null];
const OUTRO_HATCH = ['open', 'open', 'open', 'open', 'inside', 'shut', 'shut', 'shut'];
// Where each puppet stands, per frame (null: still in the sea).
const PUPPETS = [
  [null, 0, 4, 8, 12, 16, 19, 19],
  [null, null, 0, 4, 8, 12, 15, 15]
];

export function formatScumOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world(OUTRO_HATCH[index]);
  put(rows, 0, OUTRO_DRONE[index], drone(index >= 6 ? OFF : REC[index % 2]));
  const at = OUTRO_AT[index];
  if (at !== null) {
    const running = index === 2 || index === 3;
    prisoner(rows, at, SUIT, running ? STRIDES[index % 2] : STANDING);
  }
  for (const path of PUPPETS) if (path[index] !== null) puppet(rows, path[index]);
  if (index >= 6) put(rows, 1, BANNER_AT, TRANSMISSION);
  return rows;
}

// Header intro art, batch 26: Icarus, live on the Flux games hub.
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
export const BATCH26_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const put = (rows, row, column, art) => { rows[row] = overlayAt(rows[row], column, art); };
const draw = (rows, row, column, art) => art.forEach((line, i) => put(rows, row + i, column, line));

// =======================================================================================
// Icarus: the terraforming failed, and prospectors drop from an orbital station onto the
// planet to mine its exotics against the clock. Whoever misses the ride back is abandoned.
// The intro is the drop: the pod falls from orbit on its retros, lands, the hatch opens and
// the prospector walks over to an exotic crystal and cuts a piece out -- "PROSPECT ACTIVE".
// The outro is the server's last hour: a storm rolls in over the ridge while the prospector
// is still mining. The hatch shuts and the pod lifts off as they run for it, and they are
// standing on the empty pad in the rain -- "LEFT BEHIND". (Arma's scene lands a helicopter
// and Sons of the Forest's crashes one; this one is the only one that leaves without you.)
// =======================================================================================

// Row 0: the orbital station, drifting along its orbit. It is in every frame, which also
// keeps the top row from ever being empty, and it is the row the header smoke watches.
const STATION = '--[#]--';
const STATION_AT = [9, 11, 13, 15, 17, 19, 21, 23];

// Rows 1-4, against the right edge: the ridge the storm comes over.
const RIDGE_AT = 26;
const RIDGE = ['    /' + BSLASH + '  ', '   /  ' + BSLASH + ' ', '  / /' + BSLASH + ' ' + BSLASH, ' / /  ' + BSLASH + ' '];

// Row 5: the planet's scorched ground, the scene's signature: it is in every frame of both
// sequences, and nothing else draws it.
const GROUND = '_,~.'.repeat(LOGO_WIDTH).slice(0, LOGO_WIDTH);

// The drop pod, three rows tall, its retros under it.
const POD_AT = 2;
const POD_TOP = ' /^' + BSLASH + ' ';
const POD_HATCH = { shut: ' |=| ', open: ' | | ' };
const POD_LEGS = '/|_|' + BSLASH;
const RETROS = [' vVv ', ' ,V, '];
const BLAST = '~^~^~';                  // the retros on the ground
const LANDED_ROW = 2;

// Rows 3-4: the exotic crystal, with a piece cut out once they have mined it.
const CRYSTAL_AT = 20;
const CRYSTAL_TOP = ' /' + BSLASH + ' ';
const CRYSTAL = { whole: '<##>', cut: '<#> ' };
const CHUNK = '<>';

// The prospector: helmet on row 3, exosuit on row 4, legs on the ground.
const HEAD = ' O ';
const BODY = '/|' + BSLASH;
const SWING = '/|-';                    // the pick in the crystal
const CHEER = BSLASH + '|/';
const STRIDES = ['/ ' + BSLASH, ' |' + BSLASH];
const STANDING = '/ ' + BSLASH;
const SPARK = "*'";

const ACTIVE = 'PROSPECT ACTIVE';
const LEFT = ' LEFT BEHIND ';
const ACTIVE_AT = 8;
const LEFT_AT = 10;

function world({ step, crystal = 'whole' }) {
  const rows = blankRows();
  put(rows, 0, STATION_AT[step], STATION);
  draw(rows, 1, RIDGE_AT, RIDGE);
  rows[5] = GROUND;
  put(rows, 3, CRYSTAL_AT, CRYSTAL_TOP);
  put(rows, 4, CRYSTAL_AT, CRYSTAL[crystal]);
  return rows;
}

// `top` is the row of the pod's nose. With the retros firing, they burn under its legs: on
// the air while it flies, on the ground once it is down.
function pod(rows, top, hatch, retros, step) {
  draw(rows, top, POD_AT, [POD_TOP, POD_HATCH[hatch], POD_LEGS]);
  if (!retros) return;
  if (top === LANDED_ROW) put(rows, 5, POD_AT, BLAST);
  else put(rows, top + 3, POD_AT, RETROS[step % 2]);
}

function prospector(rows, column, body = BODY, legs = STANDING) {
  put(rows, 3, column, HEAD);
  put(rows, 4, column, body);
  put(rows, 5, column, legs);
}

// Per intro frame: the pod falls on its retros (0-1) and lands in a blast of dust (2); the
// hatch opens and the prospector steps out (3) and walks over (4), raises the pick at the
// crystal (5) and cuts into it in a shower of sparks (6), then holds the piece up (7).
const INTRO_POD_TOP = [0, 1, 2, 2, 2, 2, 2, 2];
const INTRO_AT = [null, null, null, 8, 12, 17, 17, 17];

export function formatIcarusFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world({ step: index, crystal: index === 7 ? 'cut' : 'whole' });
  pod(rows, INTRO_POD_TOP[index], index < 3 ? 'shut' : 'open', index < 3, index);
  const at = INTRO_AT[index];
  if (at !== null) {
    if (index === 3 || index === 4) prospector(rows, at, BODY, STRIDES[index % 2]);
    else if (index === 6) prospector(rows, at, SWING);
    else if (index === 7) prospector(rows, at, CHEER);
    else prospector(rows, at);
  }
  // The pick raised over the helmet, the sparks off the crystal, the piece held up.
  if (index === 5) put(rows, 2, at + 2, BSLASH);
  if (index === 6) put(rows, 2, CRYSTAL_AT, SPARK);
  if (index === 7) put(rows, 2, at + 1, CHUNK);
  if (index >= 6) put(rows, 1, ACTIVE_AT, ACTIVE);
  return rows;
}

export const icarusFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// The storm: slanting rain on rows 1-4 from `edge` up to the ridge it came over. It only
// falls on blank cells, so everything in the scene stays readable, and the slant moves with
// the step.
function rain(rows, edge, step) {
  for (let row = 1; row <= 4; row++) {
    const cells = rows[row].split('');
    for (let column = edge; column < RIDGE_AT; column++) {
      if (cells[column] === ' ' && (column + row + step) % 3 === 0) cells[column] = '/';
    }
    rows[row] = cells.join('');
  }
}

// Unlike put(), this writes its spaces too: a clear margin for the banner in the rain.
function stamp(rows, row, column, text) {
  rows[row] = rows[row].slice(0, column) + text + rows[row].slice(column + text.length);
}

// Per outro frame: still mining under a clear sky (0); the storm tops the ridge and the
// prospector looks up (1) and runs (2); the hatch shuts and the retros light with them a few steps short (3);
// the pod lifts off (4-5) over their head and is gone, and they stand on the empty pad with
// their arms up (6), then let them drop as the storm closes over the pad (7).
const OUTRO_POD_TOP = [2, 2, 2, 2, 1, 0, null, null];
const OUTRO_AT = [17, 17, 13, 9, 8, 6, 3, 3];
const STORM_EDGE = [RIDGE_AT, 25, 20, 16, 13, 9, 6, 0];

export function formatIcarusOutro(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = world({ step: index });
  const top = OUTRO_POD_TOP[index];
  if (top !== null) pod(rows, top, index < 3 ? 'open' : 'shut', index >= 3, index);
  const at = OUTRO_AT[index];
  if (index === 0) prospector(rows, at, SWING);
  else if (index === 6) prospector(rows, at, CHEER);
  else if (index === 1 || index === 7) prospector(rows, at);
  else prospector(rows, at, BODY, STRIDES[index % 2]);
  // The moment they notice.
  if (index === 1) put(rows, 2, at + 1, '!');
  rain(rows, STORM_EDGE[index], index);
  if (index >= 6) stamp(rows, 1, LEFT_AT, LEFT);
  return rows;
}

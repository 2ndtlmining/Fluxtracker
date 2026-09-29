// Header intro art, batch 4 (issue #420): the recurring service families that still got the
// crane -- n8n workflows, SimpleX relays, and Nextcloud/ownCloud file servers.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real -- so there is no
// execution counter, message count or storage figure (the #276/#278 rule). Services take a
// colour of their own, never the games' green.
import { LOGO_WIDTH, BOOT_LINE_COUNT, overlayAt } from './terminalAnimation.js';
import { ROW_KIND_BLUE, ROW_KIND_PURPLE } from './introArt.js';

const FRAME_COUNT = 8;
export const BATCH4_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const pad = text => text.slice(0, LOGO_WIDTH).padEnd(LOGO_WIDTH);
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const DOTS = ['.  ', '.. ', '...'];

// =======================================================================================
// Automation (n8n), purple: trigger -> fn -> out, a data dot hopping along the edges and
// each node lighting up as the dot passes through it.
// =======================================================================================

// [column, label] for each node; the edges run between them on row 2.
const WORKFLOW_NODES = [[1, 'trigger'], [14, ' fn '], [24, ' out ']];
const EDGE = '--->';
// Where the dot is each step: a node index, or a column on an edge.
const WORKFLOW_DOT = [{ node: 0 }, { column: 11 }, { column: 12 }, { node: 1 },
  { column: 21 }, { column: 22 }, { node: 2 }, { node: 2, done: true }];

export function formatAutomationFrame(step = 0) {
  const index = wrap(step);
  const dot = WORKFLOW_DOT[index];
  const rows = blankRows();
  rows[0] = pad(index === 0 ? '  >> event in' : '     event in');
  WORKFLOW_NODES.forEach(([column, label], i) => {
    const lit = dot.node === i;
    const edge = (lit ? '=' : '-').repeat(label.length);
    rows[1] = overlayAt(rows[1], column, '.' + edge + '.');
    rows[2] = overlayAt(rows[2], column, '|' + label + '|');
    rows[3] = overlayAt(rows[3], column, "'" + edge + "'");
    if (i < WORKFLOW_NODES.length - 1) rows[2] = overlayAt(rows[2], column + label.length + 2, EDGE);
  });
  if (dot.column !== undefined) rows[2] = overlayAt(rows[2], dot.column, 'o');
  rows[4] = pad('   when this, then that');
  rows[5] = pad('  WORKFLOW  ::  ' + (dot.done ? 'done' : 'running ' + DOTS[index % 3]));
  return rows;
}

export const automationFrameKinds = kindsOf(ROW_KIND_PURPLE);

// =======================================================================================
// Messaging (SimpleX), blue: an envelope wrapped in onion rings hops across the relays, and
// each relay peels one ring off. No relay knows both ends -- which is what the rings mean.
// =======================================================================================

const RELAY_COLUMNS = [7, 15, 23];
// Where the envelope is each step, and how many rings it still wears.
// It peels a ring at each relay's centre (columns 9, 17 and 25).
const ENVELOPE = [[7, 3], [9, 2], [13, 2], [17, 1], [21, 1], [25, 0], [28, 0], [30, 0]];

export function formatMessagingFrame(step = 0) {
  const index = wrap(step);
  const [column, rings] = ENVELOPE[index];
  const rows = blankRows();
  rows[0] = pad('  sender  ::  relays  ::  inbox');
  RELAY_COLUMNS.forEach(relay => {
    const here = column === relay + 2;
    rows[1] = overlayAt(rows[1], relay, here ? '((*))' : '((o))');
    rows[2] = overlayAt(rows[2], relay + 2, '|');
  });
  rows[3] = overlayAt(pad(' [A]' + ' . '.repeat(9)), 31, '[B]');
  const envelope = '('.repeat(rings) + '@' + ')'.repeat(rings);
  rows[3] = overlayAt(rows[3], column - rings, envelope);
  const delivered = index === FRAME_COUNT - 1;
  rows[4] = pad('   rings left: ' + (rings ? '()'.repeat(rings) : delivered ? 'none, delivered' : 'none'));
  rows[5] = pad('  PRIVATE MESSAGE  ::  ' + (delivered ? 'delivered' : 'relaying ' + DOTS[index % 3]));
  return rows;
}

export const messagingFrameKinds = kindsOf(ROW_KIND_BLUE);

// =======================================================================================
// Files (Nextcloud / ownCloud / OnlyOffice), blue: a document rises into the cloud, the
// sync arrow blinks, and a fixed-width bar fills. The bar is progress through the animation,
// not a transfer reading -- it has no figure beside it.
// =======================================================================================

const CLOUD = ['     .-~~~-.', '  .-(       )-.', ' (_____________)'];
const CLOUD_COLUMN = 15;
// The document's [row, column] as it lifts off the stack, rises beside the cloud and
// drops inside it.
const DOC_PATH = [[3, 3], [3, 6], [2, 9], [2, 12], [1, 14], [1, 20], [1, 22], [1, 24]];
const SYNC_BAR_WIDTH = 14;

export function formatFilesFrame(step = 0) {
  const index = wrap(step);
  const rows = blankRows();
  CLOUD.forEach((art, i) => { rows[i] = overlayAt(rows[i], CLOUD_COLUMN, art); });
  rows[3] = overlayAt(rows[3], 30, index % 2 ? '(^)' : '( )');
  rows[4] = overlayAt(rows[4], 1, '[=][=][=]');
  const [row, column] = DOC_PATH[index];
  rows[row] = overlayAt(rows[row], column, '[=]');
  const filled = Math.round((SYNC_BAR_WIDTH * (index + 1)) / FRAME_COUNT);
  rows[5] = pad('  SYNC [' + '#'.repeat(filled) + '.'.repeat(SYNC_BAR_WIDTH - filled) + ']' + (index === FRAME_COUNT - 1 ? ' up to date' : ''));
  return rows;
}

export const filesFrameKinds = kindsOf(ROW_KIND_BLUE);

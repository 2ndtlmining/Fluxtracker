// Header intro art, batch 2 (issues #276-#281): AI agents, WordPress, VPN/proxy, Globalping
// probes, FiveM, and the Dragonwilds campfire variant.
//
// Same contract as introArt.js: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, no empty row,
// every frame a pure function of the step, and no number that is not real. The issues'
// "tokens 12/s" (#276) and "AES-256" (#278) are dropped for that reason: neither is a
// reading we have.
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_DEPLOYED,
  rotateStrip,
  waveStrip,
  overlayAt
} from './terminalAnimation.js';
import { ROW_KIND_BLUE, ROW_KIND_PURPLE } from './introArt.js';

const BSLASH = String.fromCharCode(92);
const FRAME_COUNT = 8;
export const BATCH2_FRAME_COUNT = FRAME_COUNT;

const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const blankRows = () => Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
const pad = text => text.slice(0, LOGO_WIDTH).padEnd(LOGO_WIDTH);
const kindsOf = kind => () => Array(BOOT_LINE_COUNT).fill(kind);
const DOTS = ['.  ', '.. ', '...'];

// =======================================================================================
// #276 AI agent (Hermes Agent / OpenClaw / OwnLLM): a small neural net with a pulse hopping
// node to node, a prompt with a blinking cursor, and a "thinking" cell.
// =======================================================================================

const NET_ROWS = [
  '   o-----o-----o',
  '   |' + BSLASH + '   /|' + BSLASH + '   /|',
  '   o-----o-----o',
  '   |/   ' + BSLASH + '|/   ' + BSLASH + '|',
  '   o-----o-----o'
];
// The pulse's path through the nodes, one hop per step: [row, column].
const PULSE_PATH = [[0, 3], [2, 9], [4, 15], [2, 15], [0, 9], [2, 3], [4, 9], [2, 9]];

export function formatAgentFrame(step = 0) {
  const index = wrap(step);
  const rows = NET_ROWS.map(pad);
  const [row, column] = PULSE_PATH[index];
  rows[row] = overlayAt(rows[row], column, '*');
  rows[0] = overlayAt(rows[0], 21, index % 2 === 0 ? '> hello_' : '> hello ');
  rows[2] = overlayAt(rows[2], 21, 'thinking ' + DOTS[index % 3]);
  rows[4] = overlayAt(rows[4], 21, 'model loaded');
  rows.push(pad('  AGENT ONLINE  ::  inference'));
  return rows;
}

export const agentFrameKinds = kindsOf(ROW_KIND_BLUE);

// =======================================================================================
// #277 WordPress: a post typed character by character into an editor, then published.
// The typed text is a prefix of a fixed string, padded to the cell, so the width never moves.
// =======================================================================================

const POST_TEXT = 'Hello, world';
const POST_CELL = 14;

export function formatWordpressFrame(step = 0) {
  const index = wrap(step);
  const published = index === FRAME_COUNT - 1;
  const typedCount = Math.min(POST_TEXT.length, Math.ceil((POST_TEXT.length * (index + 1)) / (FRAME_COUNT - 1)));
  const cursor = !published && index % 2 === 0 ? '_' : ' ';
  const typed = (POST_TEXT.slice(0, typedCount) + cursor).padEnd(POST_CELL).slice(0, POST_CELL);
  return [
    pad('   ___       .----------------.'),
    pad('  / W ' + BSLASH + '      | ' + typed + ' |'),
    pad('  ' + BSLASH + '___/      | ~~~~ ~~ ~~~~~  |'),
    pad('             | ~~~ ~~~~       |'),
    pad("             '----------------'"),
    pad(published ? '  [PUBLISHED]   live on flux' : '  [ PUBLISH ]   draft ' + DOTS[index % 3] + ' saving')
  ];
}

export const wordpressFrameKinds = kindsOf(ROW_KIND_BLUE);

// =======================================================================================
// #278 VPN / proxy: packets flowing through an encrypted tunnel from a machine to the net.
// The packet row is a rotating 17-column strip, seamless because it IS the pattern.
// =======================================================================================

const TUNNEL_PACKETS = '  [=]    [=]     ';

export function formatVpnFrame(step = 0) {
  const index = wrap(step);
  return [
    pad('       ___________________'),
    pad(' [PC]=((' + ' '.repeat(TUNNEL_PACKETS.length) + '))=[NET]'),
    pad('      ((' + rotateStrip(TUNNEL_PACKETS, -index * 2) + '))'),
    pad(' [##]=((' + '_'.repeat(TUNNEL_PACKETS.length) + '))=[##]'),
    pad('        traffic: encrypted'),
    pad('  TUNNEL UP  ::  handshake ' + (index % 2 === 0 ? '..' : 'OK'))
  ];
}

export const vpnFrameKinds = kindsOf(ROW_KIND_PURPLE);

// =======================================================================================
// #279 Globalping / uptime probe: a sonar ping, rings widening from the probe. No latency
// figures -- we have none, and the header never invents one.
// =======================================================================================

const PROBE_CENTRE = 16;
const SONAR_LINE = waveStrip('~');

export function formatProbeFrame(step = 0) {
  const index = wrap(step);
  const stage = 1 + (index % 4);            // never 0, so rows 0 and 4 always hold a ring
  const reach = 2 + 3 * stage;
  const rows = blankRows();
  rows[2] = overlayAt(SONAR_LINE, PROBE_CENTRE, '(*)');
  // The ring: parentheses beside the probe on rows 1-3, dots above and below it, with a
  // fainter trailing ring one stage behind.
  const ring = (distance, open, close, dot) => {
    for (const row of [1, 3]) {
      rows[row] = overlayAt(rows[row], PROBE_CENTRE + 1 - distance, open);
      rows[row] = overlayAt(rows[row], PROBE_CENTRE + 1 + distance, close);
    }
    for (const row of [0, 4]) {
      rows[row] = overlayAt(rows[row], PROBE_CENTRE + 1 - (distance - 1), dot);
      rows[row] = overlayAt(rows[row], PROBE_CENTRE + 1 + (distance - 1), dot);
    }
  };
  if (stage > 1) ring(reach - 3, ':', ':', '.');
  ring(reach, '(', ')', index % 2 === 0 ? '.' : "'");
  rows[5] = pad('  PROBE ONLINE  ::  pinging ' + DOTS[index % 3]);
  return rows;
}

export const probeFrameKinds = kindsOf(ROW_KIND_BLUE);

// =======================================================================================
// #280 FiveM: a car on a road -- lane dashes scroll at speed, the wheels turn and the
// exhaust puffs. A game, so the green accent.
// =======================================================================================

// 36 columns is a whole number of '==  ' periods, so rotating then slicing to 34 has no seam.
const ROAD = '==  '.repeat(9);
const CAR = [
  '     ______',
  '____/_[]_[]' + BSLASH + '___',
  '|_  _____  _   |'
];
const CAR_COLUMN = 4;

export function formatFivemFrame(step = 0) {
  const index = wrap(step);
  const rows = blankRows();
  rows[0] = overlayAt(overlayAt(rows[0], 4, '(*)'), (17 + index) % (LOGO_WIDTH - 3), '~~~');
  CAR.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], CAR_COLUMN, art); });
  rows[3] = overlayAt(rows[3], CAR_COLUMN + CAR[2].length, index % 2 === 0 ? '=-' : '-=');
  const wheel = index % 2 === 0 ? '(_)' : '(o)';
  rows[4] = overlayAt(overlayAt(rows[4], CAR_COLUMN + 2, wheel), CAR_COLUMN + 10, wheel);
  rows[5] = rotateStrip(ROAD, index * 2).slice(0, LOGO_WIDTH);
  return rows;
}

export const fivemFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

// =======================================================================================
// #281 Dragonwilds variant: a campfire with embers rising. Dragonwilds is ~60% of
// deployments, so half of them now play this instead of the dragon (picked per app name).
// =======================================================================================

// Two flame poses, three rows above the logs, swapped each step so the fire flickers.
const FLAMES = [
  ['   )  ', '  ((  ', ' ( )) '],
  ['   (  ', '  ))  ', ' (( ) ']
];
const LOGS = '_' + BSLASH + '/' + BSLASH + '/' + BSLASH + '/_';
const FIRE_COLUMN = 13;
// Embers above the fire: [row, column] per step, two at a time, each rising a row a step.
const EMBERS = [
  [[1, 12], [0, 18]], [[0, 12], [1, 19]], [[1, 13], [0, 19]], [[0, 13], [1, 18]],
  [[1, 20], [0, 18]], [[0, 20], [1, 12]], [[1, 19], [0, 12]], [[0, 19], [1, 13]]
];
const NIGHT = ['  *        .            *     .  ', ' .    *            .        *    '];
const GRASS = waveStrip('.,.^,..');

export function formatCampfireFrame(step = 0) {
  const index = wrap(step);
  const rows = blankRows();
  rows[0] = pad(NIGHT[index % 2]);
  rows[1] = overlayAt(rows[1], 26, 'z z');
  const flame = FLAMES[index % 2];
  flame.forEach((art, i) => { rows[1 + i] = overlayAt(rows[1 + i], FIRE_COLUMN, art); });
  rows[4] = overlayAt(rows[4], FIRE_COLUMN - 1, LOGS);
  rows[4] = overlayAt(rows[4], 3, '[]=');
  for (const [row, column] of EMBERS[index]) rows[row] = overlayAt(rows[row], column, index % 2 === 0 ? "'" : '.');
  rows[5] = rotateStrip(GRASS, index);
  return rows;
}

export const campfireFrameKinds = kindsOf(ROW_KIND_DEPLOYED);

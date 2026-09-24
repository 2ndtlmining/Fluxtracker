// Header extras (issues #287, #288): the New Year fireworks slot and the attract-mode
// caption frame. Same contract as every frame: BOOT_LINE_COUNT rows of exactly LOGO_WIDTH,
// no empty row, a pure function of the step.
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_TEXT,
  ROW_KIND_DEPLOYED,
  overlayAt
} from './terminalAnimation.js';
import { ROW_KIND_GOLD } from './introArt.js';

const FRAME_COUNT = 8;
const wrap = step => ((step % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;
const pad = text => text.slice(0, LOGO_WIDTH).padEnd(LOGO_WIDTH);
const centre = text => pad(' '.repeat(Math.max(0, Math.floor((LOGO_WIDTH - text.length) / 2))) + text);

// =======================================================================================
// #287 New Year's Day: fireworks. Rockets climb from the ground and burst in turn; the
// greeting stays on the bottom row. Only in the rotation on Jan 1 (UTC).
// =======================================================================================

// Each rocket: its column and the step it launches. It climbs a row a step for two steps,
// bursts for two, and fades.
const ROCKETS = [
  { column: 6, launch: 0 },
  { column: 24, launch: 2 },
  { column: 15, launch: 4 }
];
const BURST = ['. * .', '* . *'];
const FADE = '.   .';

export const FIREWORKS_FRAME_COUNT = FRAME_COUNT;

export function formatFireworksFrame(step = 0, ctx = {}) {
  const index = wrap(step);
  const rows = Array(BOOT_LINE_COUNT).fill(' '.repeat(LOGO_WIDTH));
  const year = new Date(ctx?.nowMs ?? Date.now()).getUTCFullYear();
  for (const { column, launch } of ROCKETS) {
    const age = (index - launch + FRAME_COUNT) % FRAME_COUNT;
    if (age === 0) rows[3] = overlayAt(rows[3], column, '|');
    else if (age === 1) rows[2] = overlayAt(rows[2], column, '|');
    else if (age === 2 || age === 3) {
      rows[0] = overlayAt(rows[0], column - 2, BURST[age % 2]);
      rows[1] = overlayAt(rows[1], column - 2, BURST[(age + 1) % 2]);
    } else if (age === 4) {
      rows[1] = overlayAt(rows[1], column - 2, FADE);
    }
  }
  // Rows the rockets leave empty on a given step get a faint star, so none is ever blank.
  for (let row = 0; row < 4; row++) {
    if (!rows[row].trim()) rows[row] = overlayAt(rows[row], (row * 9 + index * 3) % (LOGO_WIDTH - 1), '.');
  }
  rows[4] = pad('  ' + '_'.repeat(LOGO_WIDTH - 4));
  rows[5] = centre(`HAPPY NEW YEAR ${year}`);
  return rows;
}

export function fireworksFrameKinds() {
  const kinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_GOLD);
  kinds[4] = ROW_KIND_TEXT;
  return kinds;
}

// =======================================================================================
// #288 attract mode: the caption shown after each intro -- its name and place in the run.
// Names only: a count like "112 running" would need live data this mode does not fetch.
// =======================================================================================

export function formatCaptionFrame(label, position, total) {
  const banner = ' ATTRACT MODE ';
  const side = Math.floor((LOGO_WIDTH - banner.length) / 2);
  const bookend = '>'.repeat(side) + banner + '<'.repeat(LOGO_WIDTH - banner.length - side);
  return [
    bookend,
    pad(''.padEnd(2) + '.'.repeat(LOGO_WIDTH - 4)),
    centre(String(label).toUpperCase().slice(0, LOGO_WIDTH - 2)),
    centre(`${position} of ${total}`),
    pad(''.padEnd(2) + '.'.repeat(LOGO_WIDTH - 4)),
    bookend
  ];
}

export function captionFrameKinds() {
  const kinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  kinds[0] = ROW_KIND_DEPLOYED;
  kinds[BOOT_LINE_COUNT - 1] = ROW_KIND_DEPLOYED;
  return kinds;
}

/** The attract-mode trigger: the Konami code, or the word "flux" typed anywhere. */
export const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
export const FLUX_WORD = ['f', 'l', 'u', 'x'];

/**
 * Feed one key into the rolling buffer. Returns the new buffer and whether it just
 * completed a trigger. Pure, so the sequence logic is unit-tested without a DOM.
 */
export function pushAttractKey(buffer, key) {
  const next = [...buffer, String(key).toLowerCase()].slice(-KONAMI.length);
  const ends = seq => seq.every((k, i) => next[next.length - seq.length + i] === k);
  const triggered = ends(KONAMI) || ends(FLUX_WORD);
  return { buffer: triggered ? [] : next, triggered };
}

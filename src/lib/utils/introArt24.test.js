import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatScumFrame, scumFrameKinds, formatScumOutro, BATCH24_FRAME_COUNT
} from './introArt24.js';

const FRAMES = BATCH24_FRAME_COUNT;
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /_\.-x-\./;
const DRONE = /<\[[o*.]\]>/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['SCUM', formatScumFrame],
  ['SCUM outro', formatScumOutro]
];

describe.each(SEQUENCES)('%s', (_, format) => {
  it.each(SKIES)('every frame is BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, none empty (%s sky)', (__, ctx) => {
    for (let step = 0; step < FRAMES; step++) {
      const frame = format(step, ctx);
      expect(frame).toHaveLength(BOOT_LINE_COUNT);
      for (const row of frame) {
        expect(row).toHaveLength(LOGO_WIDTH);
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('animates: every frame differs from the one before', () => {
    for (let i = 1; i < FRAMES; i++) expect(format(i)).not.toEqual(format(i - 1));
  });

  it('is a pure function of the step and wraps', () => {
    expect(format(FRAMES + 3)).toEqual(format(3));
    expect(format(-1)).toEqual(format(FRAMES - 1));
  });

  it('shows no numbers', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step).join('')).not.toMatch(/\d/);
  });

  it('the shore and the wire are in every frame: the header smoke keys on them', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5].slice(0, 4)).toContain('~');
      expect(format(step)[5]).toMatch(SIGNATURE);
    }
  });

  it('the bunker and the drone are in every frame', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[2]).toContain('/######');
      expect(format(step)[0]).toMatch(DRONE);
    }
  });

  it('the row the header smoke watches moves', () => {
    const droneRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => DRONE.test(r))) droneRows.add(row);
    }
    expect(droneRows.size).toBeGreaterThan(1);
  });
});

describe('SCUM specifics', () => {
  const hatch = frame => frame[4].match(/\[(==|\/=|\$\$|  |o )\]/)?.[0];
  const prisonerAt = frame => frame[3].indexOf('o');
  const droneAt = frame => frame[0].search(DRONE);
  const light = frame => frame[0].match(DRONE)?.[0][2];
  const puppets = frame => (frame[3].match(/x/g) || []).length;
  const banner = (frame, text) => frame[1].includes(text);

  it('the intro is green, like every game', () => {
    expect(scumFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the prisoner washes up, gets up and walks to the bunker under the drone', () => {
    const intro = formatScumFrame;
    expect(intro(0)[4]).toContain('o#=<');
    expect(prisonerAt(intro(0))).toBe(-1);
    for (let s = 2; s < 5; s++) expect(prisonerAt(intro(s))).toBeGreaterThan(prisonerAt(intro(s - 1)));
    for (let s = 1; s < 6; s++) expect(droneAt(intro(s))).toBeGreaterThan(droneAt(intro(s - 1)));
    for (let s = 1; s < FRAMES; s++) expect(light(intro(s))).not.toBe(light(intro(s - 1)));
  });

  it('he prises the hatch open on the loot and survives the island', () => {
    const intro = formatScumFrame;
    expect([0, 1, 2, 3].map(s => hatch(intro(s)))).toEqual(Array(4).fill('[==]'));
    expect(hatch(intro(4))).toBe('[/=]');
    expect(intro(4)[4]).toContain('/#-|');
    for (let s = 5; s < FRAMES; s++) expect(hatch(intro(s))).toBe('[$$]');
    for (let s = 0; s < FRAMES; s++) expect(banner(intro(s), 'SURVIVE THE ISLAND')).toBe(s >= 6);
  });

  it('the outro: puppets climb out of the sea and he seals himself in the bunker', () => {
    const outro = formatScumOutro;
    expect(puppets(outro(0))).toBe(0);
    expect(outro(1)[5]).toMatch(/^\/~\\/);
    expect(puppets(outro(3))).toBe(2);
    for (let s = 1; s < 4; s++) expect(prisonerAt(outro(s))).toBeGreaterThanOrEqual(prisonerAt(outro(s - 1)));
    expect(hatch(outro(3))).toBe('[  ]');
    expect(hatch(outro(4))).toBe('[o ]');
    for (let s = 5; s < FRAMES; s++) expect(hatch(outro(s))).toBe('[==]');
  });

  it('the drone stops recording and flies off: end of transmission', () => {
    const outro = formatScumOutro;
    for (let s = 0; s < FRAMES; s++) expect(light(outro(s)) === '.').toBe(s >= 6);
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'END OF TRANSMISSION')).toBe(s >= 6);
    expect(droneAt(outro(7))).toBeGreaterThan(droneAt(outro(6)));
  });
});

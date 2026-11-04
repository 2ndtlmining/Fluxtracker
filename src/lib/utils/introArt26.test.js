import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatIcarusFrame, icarusFrameKinds, formatIcarusOutro, BATCH26_FRAME_COUNT
} from './introArt26.js';

const FRAMES = BATCH26_FRAME_COUNT;
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /_,~\._,~\./;
const STATION = /--\[#\]--/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Icarus', formatIcarusFrame],
  ['Icarus outro', formatIcarusOutro]
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

  it('the ground is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[5]).toMatch(SIGNATURE);
  });

  it('the station is in orbit in every frame, and it is the row the header smoke watches', () => {
    const rows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[0]).toMatch(STATION);
      rows.add(format(step)[0]);
    }
    expect(rows.size).toBeGreaterThan(1);
  });

  it('the ridge and the crystal are in every frame', () => {
    for (let step = 0; step < FRAMES; step++) {
      const frame = format(step);
      expect(frame[1].slice(26)).toContain('/' + String.fromCharCode(92));
      expect(frame[4]).toMatch(/<#+>/);
    }
  });

  it('never draws a gamepad or the fuse, which the smoke would read as their frames', () => {
    for (let step = 0; step < FRAMES; step++) {
      const joined = format(step).join('\n');
      expect(joined).not.toMatch(/\[\^\]|\{\^\}|\(\*\)/);
      expect(joined).not.toMatch(/\| (APP|\.\.\.) \|/);
    }
  });
});

describe('Icarus specifics', () => {
  const NOSE = ' /^' + String.fromCharCode(92) + ' ';
  const podTop = frame => frame.findIndex(row => row.slice(2, 7) === NOSE);
  const hatch = frame => {
    const top = podTop(frame);
    return top === -1 ? null : frame[top + 1].slice(2, 7);
  };
  const retros = frame => frame.slice(0, 5).some(row => /^ {2} (vVv|,V,) /.test(row));
  const blast = frame => frame[5].slice(2, 7) === '~^~^~';
  const helmetAt = frame => frame[3].indexOf('O');
  const banner = (frame, text) => frame[1].includes(text);

  it('the intro is green, like every game', () => {
    expect(icarusFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the pod falls on its retros, lands in a blast, then the hatch opens', () => {
    const intro = formatIcarusFrame;
    expect([0, 1, 2, 3].map(s => podTop(intro(s)))).toEqual([0, 1, 2, 2]);
    expect([0, 1, 2, 3].map(s => retros(intro(s)))).toEqual([true, true, false, false]);
    expect([0, 1, 2, 3].map(s => blast(intro(s)))).toEqual([false, false, true, false]);
    for (let s = 0; s < 3; s++) expect(hatch(intro(s))).toBe(' |=| ');
    for (let s = 3; s < FRAMES; s++) expect(hatch(intro(s))).toBe(' | | ');
  });

  it('nobody is outside until the hatch opens, then the prospector walks to the crystal', () => {
    const intro = formatIcarusFrame;
    for (let s = 0; s < 3; s++) expect(helmetAt(intro(s))).toBe(-1);
    for (let s = 4; s < 6; s++) expect(helmetAt(intro(s))).toBeGreaterThan(helmetAt(intro(s - 1)));
  });

  it('they cut a piece out of the crystal: prospect active', () => {
    const intro = formatIcarusFrame;
    for (let s = 0; s < 7; s++) expect(intro(s)[4]).toContain('<##>');
    expect(intro(6)[2]).toContain("*'");
    expect(intro(6)[4]).toContain('/|-');
    expect(intro(7)[4]).toContain('<#> ');
    expect(intro(7)[2]).toContain('<>');
    for (let s = 0; s < FRAMES; s++) expect(banner(intro(s), 'PROSPECT ACTIVE')).toBe(s >= 6);
  });

  it('the outro: the storm comes over the ridge and closes on the pad', () => {
    const outro = formatIcarusOutro;
    // Row 1, where the pod's nose has not risen to yet.
    const firstRain = s => outro(s)[1].indexOf('/');
    for (let s = 1; s < 4; s++) expect(firstRain(s)).toBeLessThan(firstRain(s - 1));
    expect(outro(7)[2].slice(0, 2)).toMatch(/\//);
  });

  it('the rain never paints over the scene', () => {
    for (let s = 0; s < FRAMES; s++) {
      const frame = formatIcarusOutro(s);
      expect(frame[4]).toMatch(/<##>/);
      expect(frame[5]).toMatch(SIGNATURE);
      expect(frame[3]).toContain('O');
    }
  });

  it('the hatch shuts and the pod leaves without them: left behind', () => {
    const outro = formatIcarusOutro;
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => podTop(outro(s)))).toEqual([2, 2, 2, 2, 1, 0, -1, -1]);
    for (let s = 0; s < 3; s++) expect(hatch(outro(s))).toBe(' | | ');
    for (let s = 3; s < 6; s++) expect(hatch(outro(s))).toBe(' |=| ');
    expect(blast(outro(3))).toBe(true);
    for (let s = 4; s < 6; s++) expect(retros(outro(s))).toBe(true);
    // Running for the pad, on the ground in every frame, and the pod never takes them.
    for (let s = 2; s < 7; s++) expect(helmetAt(outro(s))).toBeLessThan(helmetAt(outro(s - 1)));
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'LEFT BEHIND')).toBe(s >= 6);
  });
});

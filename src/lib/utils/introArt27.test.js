import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatKillingFloor2Frame, killingFloor2FrameKinds, formatKillingFloor2Outro, BATCH27_FRAME_COUNT
} from './introArt27.js';

const FRAMES = BATCH27_FRAME_COUNT;
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /-=\._-=\._/;
const ZED = /@/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Killing Floor 2', formatKillingFloor2Frame],
  ['Killing Floor 2 outro', formatKillingFloor2Outro]
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

  it('the lab floor is in every frame, untouched: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toMatch(SIGNATURE);
      expect(format(step)[5]).toBe(format(0)[5]);
    }
  });

  it('the ceiling pipe is in every frame', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[0]).toMatch(/^(====o)+/);
  });

  it('a Zed moves across the lab, and its row is the one the header smoke watches', () => {
    const rows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step)) if (ZED.test(row)) rows.add(row);
    }
    expect(rows.size).toBeGreaterThan(1);
  });

  it('never draws a gamepad or the fuse, which the smoke would read as their frames', () => {
    for (let step = 0; step < FRAMES; step++) {
      const joined = format(step).join('\n');
      expect(joined).not.toMatch(/\[\^\]|\{\^\}|\(\*\)|\{[\^v<>]\}/);
      expect(joined).not.toMatch(/\| (APP|\.\.\.) \|/);
    }
  });
});

describe('Killing Floor 2 specifics', () => {
  const intro = formatKillingFloor2Frame;
  const outro = formatKillingFloor2Outro;
  const standingClots = frame => (frame[2].match(/@/g) || []).length;
  const corpses = frame => (frame[4].match(/x__/g) || []).length;
  const banner = (frame, text) => frame[1].includes(text);
  const firing = frame => frame[3].includes('- ') || frame[3].includes('. ');

  it('the intro is green, like every game', () => {
    expect(killingFloor2FrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the clots come in from the right and close on the survivor', () => {
    expect(standingClots(intro(0))).toBe(1);
    expect(standingClots(intro(1))).toBe(2);
    expect(intro(1)[2].indexOf('@')).toBeLessThan(intro(0)[2].indexOf('@'));
    expect(intro(2)[2].indexOf('@')).toBeLessThan(intro(1)[2].indexOf('@'));
  });

  it('the survivor drops them one at a time, and the wave is cleared', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => corpses(intro(s)))).toEqual([0, 0, 0, 0, 1, 1, 2, 2]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => firing(intro(s))))
      .toEqual([false, false, true, true, true, true, false, false]);
    expect(intro(3)[2]).toContain('*');
    expect(intro(5)[2]).toContain('*');
    for (let s = 0; s < FRAMES; s++) expect(banner(intro(s), 'WAVE CLEARED')).toBe(s >= 6);
  });

  it('Zed Time: the lights dim and the rounds hang in the air for the last kill', () => {
    for (let s = 0; s < FRAMES; s++) {
      const zedTime = s === 4 || s === 5;
      expect(banner(intro(s), 'ZED TIME')).toBe(zedTime);
      expect(intro(s)[1].includes('V')).toBe(!zedTime);
    }
    expect(intro(4)[3]).toMatch(/\. \. \./);
  });

  it('the outro: a Fleshpound walks through the fire, enrages and charges', () => {
    const poundAt = frame => frame[2].indexOf('{@}');
    for (let s = 1; s < 6; s++) expect(poundAt(outro(s))).toBeLessThan(poundAt(outro(s - 1)));
    expect(outro(1)[3]).toContain('<*>');
    for (let s = 2; s < 6; s++) expect(outro(s)[1]).toContain('!!');
    expect(outro(3)[1]).toContain('click');
    for (let s = 0; s < 3; s++) expect(firing(outro(s))).toBe(true);
    for (let s = 3; s < FRAMES; s++) expect(firing(outro(s))).toBe(false);
  });

  it('it flattens the survivor: squad wiped', () => {
    for (let s = 0; s < 6; s++) expect(outro(s)[2]).toContain('O');
    for (let s = 6; s < FRAMES; s++) {
      expect(outro(s)[2]).not.toContain('O');
      expect(outro(s)[4].startsWith('o__')).toBe(true);
    }
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'SQUAD WIPED')).toBe(s >= 6);
  });
});

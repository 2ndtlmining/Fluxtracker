import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatCounterStrikeFrame, counterStrikeFrameKinds, formatCounterStrikeOutro,
  BATCH22_FRAME_COUNT
} from './introArt22.js';

const FRAMES = BATCH22_FRAME_COUNT;
const FLOOR = '_:._.:';
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /_:\._\.:/;
const BOMB = /\[:[*.]\]/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Counter-Strike 2', formatCounterStrikeFrame],
  ['Counter-Strike 2 outro', formatCounterStrikeOutro]
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

  it('the bombsite sand is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toContain(FLOOR);
      expect(format(step).join('\n')).toMatch(SIGNATURE);
    }
  });

  it('the bombsite is in every frame', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[2]).toContain('|  A   |');
  });

  it('the row the header smoke watches moves', () => {
    const bombRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => BOMB.test(r))) bombRows.add(row);
    }
    expect(bombRows.size).toBeGreaterThan(1);
  });
});

describe('Counter-Strike 2 specifics', () => {
  const bomb = frame => BOMB.test(frame[4]);
  const light = frame => frame[4].match(BOMB)?.[0];
  const runnerAt = frame => frame[3].indexOf('o');
  const kneeling = frame => frame[4].includes('o_[:');
  const banner = (frame, text) => frame[1].includes(text);

  it('the intro is green, like every game', () => {
    expect(counterStrikeFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the terrorist runs to the site, plants the bomb and runs back to the crates', () => {
    for (let s = 1; s < 4; s++) {
      expect(runnerAt(formatCounterStrikeFrame(s))).toBeGreaterThan(runnerAt(formatCounterStrikeFrame(s - 1)));
    }
    for (let s = 0; s < FRAMES; s++) expect(kneeling(formatCounterStrikeFrame(s))).toBe(s === 4);
    for (let s = 0; s < FRAMES; s++) expect(bomb(formatCounterStrikeFrame(s))).toBe(s >= 4);
    // Running back, his rifle the other way.
    expect(formatCounterStrikeFrame(5)[4]).toContain('-|');
    expect(runnerAt(formatCounterStrikeFrame(6))).toBeLessThan(runnerAt(formatCounterStrikeFrame(5)));
    // Crouched behind the crates.
    expect(formatCounterStrikeFrame(7)[4]).toContain('[+][+] o');
  });

  it('the bomb blinks, and the plant is announced once it is down', () => {
    for (let s = 5; s < FRAMES; s++) {
      expect(light(formatCounterStrikeFrame(s))).not.toBe(light(formatCounterStrikeFrame(s - 1)));
    }
    for (let s = 0; s < FRAMES; s++) {
      expect(banner(formatCounterStrikeFrame(s), 'BOMB HAS BEEN PLANTED')).toBe(s >= 5);
    }
  });

  it('the outro: a defuse too late, the bomb goes off and the terrorists win', () => {
    const outro = formatCounterStrikeOutro;
    for (let s = 0; s < FRAMES; s++) expect(bomb(outro(s))).toBe(s < 5);
    for (let s = 1; s < 5; s++) expect(light(outro(s))).not.toBe(light(outro(s - 1)));
    expect(runnerAt(outro(0))).toBe(-1);
    for (let s = 2; s < 4; s++) expect(runnerAt(outro(s))).toBeGreaterThan(runnerAt(outro(s - 1)));
    expect(kneeling(outro(4))).toBe(true);
    expect(outro(4)[3]).toContain('!!');
    for (let s = 0; s < FRAMES; s++) expect(outro(s).join('').includes('-=#=-')).toBe(s === 5);
    expect(outro(6)[3]).toContain('(    )');
    expect(outro(7)[4]).toContain('.#.');
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'TERRORISTS WIN')).toBe(s >= 6);
  });
});

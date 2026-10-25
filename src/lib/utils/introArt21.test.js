import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatSonsOfTheForestFrame, sonsOfTheForestFrameKinds, formatSonsOfTheForestOutro,
  BATCH21_FRAME_COUNT
} from './introArt21.js';

const FRAMES = BATCH21_FRAME_COUNT;
const FLOOR = ',.^.,_';
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /,\.\^\.,_/;
const CABIN = /\[[_ox]{2}\]/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Sons of the Forest', formatSonsOfTheForestFrame],
  ['Sons of the Forest outro', formatSonsOfTheForestOutro]
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

  it('the forest floor is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toContain(FLOOR);
      expect(format(step).join('\n')).toMatch(SIGNATURE);
    }
  });

  it('the row the header smoke watches moves', () => {
    const cabinRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => CABIN.test(r))) cabinRows.add(row);
    }
    expect(cabinRows.size).toBeGreaterThan(1);
  });
});

describe('Sons of the Forest specifics', () => {
  const B = String.fromCharCode(92);
  const cabin = frame => frame.findIndex(r => /\[[_o]{2}\]/.test(r) && /[<>]/.test(r));
  const cabinAt = frame => frame[cabin(frame)].search(/[<=]/);
  const burst = frame => frame.some(r => r.includes('-*#*-'));
  const wreck = frame => frame[4].includes('[x_]-/');
  const standing = frame => frame[4].includes('/|' + B);
  const axe = frame => frame[2].includes('P') && frame[3].includes('o/');
  const cannibals = frame => frame.slice(3, 5).join('').split('@').length - 1;
  const fire = frame => /\}\{|\{\}/.test(frame[4]);

  it('the intro is green, like every game', () => {
    expect(sonsOfTheForestFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the helicopter spins down from the left, trailing smoke', () => {
    for (let s = 0; s < 4; s++) expect(cabin(formatSonsOfTheForestFrame(s))).toBeGreaterThan(-1);
    for (let s = 1; s < 4; s++) {
      expect(cabin(formatSonsOfTheForestFrame(s))).toBeGreaterThanOrEqual(cabin(formatSonsOfTheForestFrame(s - 1)));
      expect(cabinAt(formatSonsOfTheForestFrame(s))).toBeGreaterThan(cabinAt(formatSonsOfTheForestFrame(s - 1)));
      // Spinning: it faces the other way every frame.
      expect(formatSonsOfTheForestFrame(s).join('').includes('>'))
        .not.toBe(formatSonsOfTheForestFrame(s - 1).join('').includes('>'));
    }
    expect(formatSonsOfTheForestFrame(1).join('')).toContain('~~');
  });

  it('it crashes, and the survivor crawls out of the wreck, stands and raises his axe', () => {
    for (let s = 0; s < FRAMES; s++) expect(burst(formatSonsOfTheForestFrame(s))).toBe(s === 4);
    for (let s = 5; s < FRAMES; s++) expect(wreck(formatSonsOfTheForestFrame(s))).toBe(true);
    expect(formatSonsOfTheForestFrame(5)[4]).toContain('o_/');
    expect(standing(formatSonsOfTheForestFrame(6))).toBe(true);
    for (let s = 0; s < FRAMES; s++) expect(axe(formatSonsOfTheForestFrame(s))).toBe(s === 7);
  });

  it('the outro: eyes in the pines, the cannibals come, he hides in the wreck and the fire goes out', () => {
    expect(formatSonsOfTheForestOutro(0).join('')).not.toContain('**');
    expect(formatSonsOfTheForestOutro(1).join('')).toContain('**');
    for (let s = 0; s < 3; s++) expect(cannibals(formatSonsOfTheForestOutro(s))).toBe(0);
    expect(cannibals(formatSonsOfTheForestOutro(3))).toBe(1);
    for (let s = 4; s < FRAMES; s++) expect(cannibals(formatSonsOfTheForestOutro(s))).toBe(2);
    // They come on from the pines, right to left.
    const lead = s => formatSonsOfTheForestOutro(s)[3].indexOf('@');
    for (let s = 4; s < 7; s++) expect(lead(s)).toBeLessThan(lead(s - 1));
    // He is out by the fire, then in the wreck.
    for (let s = 0; s < 5; s++) expect(formatSonsOfTheForestOutro(s)[4]).toContain('[x_]-/');
    for (let s = 5; s < FRAMES; s++) expect(formatSonsOfTheForestOutro(s)[4]).toContain('[o_]-/');
    expect(formatSonsOfTheForestOutro(3)[2]).toContain('!');
    for (let s = 0; s < FRAMES; s++) expect(fire(formatSonsOfTheForestOutro(s))).toBe(s < 6);
  });
});

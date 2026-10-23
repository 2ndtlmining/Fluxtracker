import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatSoulmaskFrame, soulmaskFrameKinds, formatSoulmaskOutro, BATCH19_FRAME_COUNT
} from './introArt19.js';

const FRAMES = BATCH19_FRAME_COUNT;
const FLOOR = ".,;'.,;'";
const EYES = /\|[o*.]\|[o*.]\|/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Soulmask', formatSoulmaskFrame],
  ['Soulmask outro', formatSoulmaskOutro]
];

describe.each(SEQUENCES)('%s (#556)', (_, format) => {
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

  it('the jungle floor is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[5]).toContain(FLOOR);
  });

  it('the row the header smoke watches moves', () => {
    const eyeRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      const row = format(step).find(r => EYES.test(r));
      expect(row).toBeDefined();
      eyeRows.add(row);
    }
    expect(eyeRows.size).toBeGreaterThan(1);
  });
});

describe('Soulmask specifics (#556)', () => {
  const eyesOf = frame => frame.join('\n').match(EYES)?.[0];
  const maskColumn = frame => frame.findIndex(r => EYES.test(r)) >= 0
    ? frame.find(r => EYES.test(r)).search(EYES) : -1;
  const headBare = frame => frame[3].includes('o');
  const spear = frame => frame[0].includes('^') && frame[4].includes('_|');
  const cracked = frame => frame.some(r => r.includes('/^/^'));

  it('the intro is green, like every game', () => {
    expect(soulmaskFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the mask drifts in over the tribesman, then settles on his face', () => {
    for (let s = 1; s < 3; s++) {
      expect(maskColumn(formatSoulmaskFrame(s))).toBeGreaterThan(maskColumn(formatSoulmaskFrame(s - 1)));
      expect(headBare(formatSoulmaskFrame(s))).toBe(true);
    }
    expect(headBare(formatSoulmaskFrame(3))).toBe(false);
    expect(formatSoulmaskFrame(3)[3]).toContain('vvv');
  });

  it('its eyes ignite once it is worn, and he raises his spear', () => {
    for (let s = 0; s < 4; s++) expect(eyesOf(formatSoulmaskFrame(s))).toBe('|o|o|');
    for (let s = 4; s < FRAMES; s++) expect(eyesOf(formatSoulmaskFrame(s))).toBe('|*|*|');
    for (let s = 0; s < 6; s++) expect(spear(formatSoulmaskFrame(s))).toBe(false);
    for (let s = 6; s < FRAMES; s++) expect(spear(formatSoulmaskFrame(s))).toBe(true);
  });

  it('the outro: the eyes go dark, the mask cracks and falls, and he walks away', () => {
    expect(eyesOf(formatSoulmaskOutro(0))).toBe('|*|*|');
    expect(eyesOf(formatSoulmaskOutro(1))).toBe('|o|o|');
    expect(eyesOf(formatSoulmaskOutro(2))).toBe('|.|.|');
    expect(cracked(formatSoulmaskOutro(2))).toBe(false);
    expect(cracked(formatSoulmaskOutro(3))).toBe(true);
    expect(headBare(formatSoulmaskOutro(3))).toBe(false);
    // Fallen: its teeth lie on the jungle floor, and his bare head shows.
    expect(formatSoulmaskOutro(4)[5]).toContain('vvv');
    expect(headBare(formatSoulmaskOutro(4))).toBe(true);
    const walker = s => formatSoulmaskOutro(s)[4].indexOf('/|');
    expect(walker(5)).toBeLessThan(walker(4));
    expect(walker(6)).toBeLessThan(walker(5));
    const last = formatSoulmaskOutro(FRAMES - 1);
    expect(last[4]).not.toContain('/|');
    expect(last[2]).toContain('~,~');
  });
});

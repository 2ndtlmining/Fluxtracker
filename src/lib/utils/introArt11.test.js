import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatDstFrame, dstFrameKinds, formatDstOutro, BATCH11_FRAME_COUNT
} from './introArt11.js';

const FRAMES = BATCH11_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ["Don't Starve Together", formatDstFrame],
  ["Don't Starve Together outro", formatDstOutro]
];

describe.each(SEQUENCES)('%s (#526)', (_, format) => {
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
});

describe("Don't Starve Together specifics (#526)", () => {
  const fireLit = frame => /\(\^\)|\)\^\(/.test(frame[3]);
  const dark = frame => frame[0].match(/^:*/)[0].length;

  it('the intro is green, like every game', () => {
    expect(dstFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the Crock Pot stands beside the fire through the whole intro', () => {
    for (let s = 0; s < FRAMES; s++) expect(formatDstFrame(s)[3]).toContain('(___)');
  });

  it('Wilson walks in with the logs, strikes a spark, and the fire catches', () => {
    const wilson = s => formatDstFrame(s)[1].indexOf('VVV');
    for (let s = 1; s < FRAMES; s++) expect(wilson(s)).toBeGreaterThanOrEqual(wilson(s - 1));
    for (let s = 0; s < 3; s++) {
      expect(formatDstFrame(s)[3]).toContain('==');
      expect(fireLit(formatDstFrame(s))).toBe(false);
    }
    expect(formatDstFrame(3)[3]).toContain('*');
    for (let s = 4; s < FRAMES; s++) expect(fireLit(formatDstFrame(s))).toBe(true);
  });

  it('the pot steams only once the fire has caught', () => {
    const steam = s => formatDstFrame(s).slice(0, 2).join('').includes('s');
    for (let s = 0; s < 5; s++) expect(steam(s)).toBe(false);
    for (let s = 5; s < FRAMES; s++) expect(steam(s)).toBe(true);
  });

  it('the outro: the dark closes in, the fire dies and eyes open in it', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(dark(formatDstOutro(s))).toBeGreaterThan(dark(formatDstOutro(s - 1)));
    }
    expect(dark(formatDstOutro(0))).toBe(0);
    expect(formatDstOutro(FRAMES - 1).join('').replace(/[:o -]/g, '')).toBe('');
    expect(fireLit(formatDstOutro(0))).toBe(true);
    for (let s = 2; s < FRAMES; s++) expect(fireLit(formatDstOutro(s))).toBe(false);
    expect(formatDstOutro(0).join('')).not.toMatch(/o:o|-:-/);
    expect(formatDstOutro(2).join('')).toMatch(/o:o/);
  });
});

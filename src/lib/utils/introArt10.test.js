import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatUnturnedFrame, unturnedFrameKinds, formatUnturnedOutro, BATCH10_FRAME_COUNT
} from './introArt10.js';

const FRAMES = BATCH10_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Unturned', formatUnturnedFrame],
  ['Unturned outro', formatUnturnedOutro]
];

describe.each(SEQUENCES)('%s (#525)', (_, format) => {
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

  it('keeps the pine standing on the left', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[3].slice(0, 5)).toBe('/AAA' + String.fromCharCode(92));
  });
});

describe('Unturned specifics (#525)', () => {
  const planks = frame => frame.filter(r => r.slice(24, 29) === '|=|=|').length;
  const survivor = frame => frame[3].search(/D\||\|D|\/\|\\/);

  it('the intro is green, like every game', () => {
    expect(unturnedFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the survivor loots the crate before shouldering the pack', () => {
    expect(formatUnturnedFrame(0)[4]).toContain('[+]');
    expect(formatUnturnedFrame(3)[4]).toContain('[ ]');
    for (let s = 0; s < 4; s++) expect(formatUnturnedFrame(s)[3]).not.toContain('D|');
    for (let s = 4; s < FRAMES; s++) expect(formatUnturnedFrame(s)[3]).toContain('D|');
  });

  it('then walks right and boards up the barricade, one plank at a time', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(survivor(formatUnturnedFrame(s))).toBeGreaterThanOrEqual(survivor(formatUnturnedFrame(s - 1)));
      expect(planks(formatUnturnedFrame(s)) - planks(formatUnturnedFrame(s - 1))).toBeGreaterThanOrEqual(0);
      expect(planks(formatUnturnedFrame(s)) - planks(formatUnturnedFrame(s - 1))).toBeLessThanOrEqual(1);
    }
    expect(planks(formatUnturnedFrame(0))).toBe(0);
    expect(planks(formatUnturnedFrame(FRAMES - 1))).toBe(3);
  });

  it('the outro: the horde tears the planks down and the survivor runs for the trees', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(planks(formatUnturnedOutro(s))).toBeLessThanOrEqual(planks(formatUnturnedOutro(s - 1)));
      expect(survivor(formatUnturnedOutro(s))).toBeLessThanOrEqual(survivor(formatUnturnedOutro(s - 1)));
    }
    expect(planks(formatUnturnedOutro(0))).toBe(3);
    expect(planks(formatUnturnedOutro(FRAMES - 1))).toBe(0);
    // No zombie walks through a standing plank.
    for (let s = 0; s < FRAMES; s++) {
      const frame = formatUnturnedOutro(s);
      if (planks(frame) > 0) expect(frame[3].indexOf('=|', 29)).toBeGreaterThanOrEqual(30);
    }
    expect(formatUnturnedOutro(FRAMES - 1)[3]).toContain('/|D');
  });
});

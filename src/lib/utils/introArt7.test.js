import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatHytaleFrame, hytaleFrameKinds, formatHytaleOutro, BATCH7_FRAME_COUNT
} from './introArt7.js';

const FRAMES = BATCH7_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Hytale', formatHytaleFrame],
  ['Hytale outro', formatHytaleOutro]
];

describe.each(SEQUENCES)('%s (#518)', (_, format) => {
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

  it('keeps the voxel tree standing at the left edge', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[1].startsWith('#####')).toBe(true);
  });
});

describe('Hytale specifics (#518)', () => {
  const blocks = frame => frame.filter(r => r.includes('[][]')).length;

  it('the intro is green, like every game', () => {
    expect(hytaleFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the adventurer walks left to right with the sword out front', () => {
    const hero = s => formatHytaleFrame(s)[3].indexOf('/|=-');
    for (let s = 1; s < FRAMES; s++) expect(hero(s)).toBeGreaterThan(hero(s - 1));
  });

  it('the tower builds block by block, and the flag goes up only when it is finished', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(blocks(formatHytaleFrame(s))).toBeGreaterThanOrEqual(blocks(formatHytaleFrame(s - 1)));
    }
    expect(blocks(formatHytaleFrame(0))).toBe(1);
    expect(blocks(formatHytaleFrame(FRAMES - 1))).toBe(4);
    expect(formatHytaleFrame(FRAMES - 2)[0]).not.toContain('|>');
    expect(formatHytaleFrame(FRAMES - 1)[0]).toContain('|>');
  });

  it('the outro: the Void eats the tower and spreads while the adventurer runs back', () => {
    expect(blocks(formatHytaleOutro(0))).toBe(4);
    expect(blocks(formatHytaleOutro(FRAMES - 1))).toBe(0);
    const corrupted = s => (formatHytaleOutro(s)[5].match(/[~%]/g) || []).length;
    for (let s = 1; s < FRAMES; s++) expect(corrupted(s)).toBeGreaterThan(corrupted(s - 1));
    const hero = s => formatHytaleOutro(s)[3].indexOf('-=|');
    for (let s = 1; s < FRAMES; s++) expect(hero(s)).toBeLessThan(hero(s - 1));
  });
});

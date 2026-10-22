import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatVintageStoryFrame, vintageStoryFrameKinds, formatVintageStoryOutro, BATCH17_FRAME_COUNT
} from './introArt17.js';

const FRAMES = BATCH17_FRAME_COUNT;
const DOOR = '|[]|';
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Vintage Story', formatVintageStoryFrame],
  ['Vintage Story outro', formatVintageStoryOutro]
];

describe.each(SEQUENCES)('%s (#547)', (_, format) => {
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

  it('the cabin is in every frame: the header smoke keys on its door', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[3]).toContain(DOOR);
  });

  it('the row the header smoke watches moves', () => {
    const doorRows = new Set();
    for (let step = 0; step < FRAMES; step++) doorRows.add(format(step)[3]);
    expect(doorRows.size).toBeGreaterThan(1);
  });
});

describe('Vintage Story specifics (#547)', () => {
  const field = frame => frame[3].slice(8, 25);
  // Ripe ears sway: any of \|/, /|/ and \|\ on the top row.
  const ripe = frame => /[/\\]\|[/\\]/.test(frame[1]);
  const hoeUp = frame => frame[1].includes('o /');
  const snowing = frame => frame.slice(0, 3).some(row => row.includes('*') && !row.includes('(*)'));
  const settlerHere = frame => frame[1].includes('o');

  it('the intro is green, like every game', () => {
    expect(vintageStoryFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the hoe goes in, then the field grows a stage each frame up to ripe ears', () => {
    expect(hoeUp(formatVintageStoryFrame(0))).toBe(true);
    expect(field(formatVintageStoryFrame(0)).trim()).toBe('');
    expect(field(formatVintageStoryFrame(1))).toContain('.');
    expect(field(formatVintageStoryFrame(2))).toContain('v');
    expect(formatVintageStoryFrame(3)[2]).toContain('v');
    expect(ripe(formatVintageStoryFrame(3))).toBe(false);
    for (let s = 4; s < FRAMES; s++) expect(ripe(formatVintageStoryFrame(s))).toBe(true);
  });

  it('the sun crosses the sky through the intro', () => {
    const sunAt = step => formatVintageStoryFrame(step)[0].indexOf('(*)');
    for (let s = 1; s < FRAMES; s++) expect(sunAt(s)).toBeGreaterThan(sunAt(s - 1));
  });

  it('the outro: the ears droop, the crop falls, snow comes and the settler goes home', () => {
    expect(ripe(formatVintageStoryOutro(0))).toBe(true);
    expect(formatVintageStoryOutro(1)[1]).toContain('.|.');
    for (let s = 0; s < 3; s++) expect(snowing(formatVintageStoryOutro(s))).toBe(false);
    for (let s = 3; s < FRAMES; s++) {
      expect(snowing(formatVintageStoryOutro(s))).toBe(true);
      expect(ripe(formatVintageStoryOutro(s))).toBe(false);
    }
    expect(field(formatVintageStoryOutro(FRAMES - 1))).toContain('***');
    expect(settlerHere(formatVintageStoryOutro(FRAMES - 2))).toBe(true);
    expect(settlerHere(formatVintageStoryOutro(FRAMES - 1))).toBe(false);
  });
});

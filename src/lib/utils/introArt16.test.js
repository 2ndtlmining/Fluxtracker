import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatTf2Frame, tf2FrameKinds, formatTf2Outro, BATCH16_FRAME_COUNT
} from './introArt16.js';

const FRAMES = BATCH16_FRAME_COUNT;
const BOOTS = '_/ ' + String.fromCharCode(92) + '_';
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Team Fortress 2', formatTf2Frame],
  ['Team Fortress 2 outro', formatTf2Outro]
];

describe.each(SEQUENCES)('%s (#540)', (_, format) => {
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

  it('the Engineer is in every frame: the header smoke keys on his boots', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[3]).toContain(BOOTS);
  });
});

describe('Team Fortress 2 specifics (#540)', () => {
  const toolbox = frame => frame[3].includes('[==]');
  const tripod = frame => frame[3].includes('/  ' + String.fromCharCode(92));
  const body = frame => frame[2].includes('[(o)]');
  const top = frame => frame[1].includes('.--.');
  const built = frame => frame[2].includes('[(o)]==');
  const firing = frame => /== +-/.test(frame[2]);
  const wrenchUp = frame => frame[1].includes('@_Y');

  it('the intro is green, like every game', () => {
    expect(tf2FrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the toolbox drops, then each swing of the wrench adds a stage', () => {
    expect(toolbox(formatTf2Frame(0))).toBe(true);
    expect(tripod(formatTf2Frame(1))).toBe(true);
    expect(body(formatTf2Frame(2))).toBe(true);
    expect(top(formatTf2Frame(3))).toBe(true);
    expect(built(formatTf2Frame(3))).toBe(false);
    expect(built(formatTf2Frame(4))).toBe(true);
    expect(wrenchUp(formatTf2Frame(1))).toBe(true);
    expect(wrenchUp(formatTf2Frame(2))).toBe(false);
    expect(wrenchUp(formatTf2Frame(3))).toBe(true);
  });

  it('once built, the sentry fires and its tracers move', () => {
    for (let s = 0; s < 5; s++) expect(firing(formatTf2Frame(s))).toBe(false);
    for (let s = 5; s < FRAMES; s++) expect(firing(formatTf2Frame(s))).toBe(true);
    expect(formatTf2Frame(6)[2]).not.toEqual(formatTf2Frame(5)[2]);
  });

  it('the outro: sapped, sparks, blows up, and only scrap is left', () => {
    expect(firing(formatTf2Outro(0))).toBe(true);
    for (let s = 1; s < 4; s++) {
      expect(firing(formatTf2Outro(s))).toBe(false);
      expect(formatTf2Outro(s)[3]).toContain('zz');
      expect(formatTf2Outro(s)[0]).toContain('*');
    }
    expect(formatTf2Outro(4)[2]).toContain('*');
    for (let s = 4; s < FRAMES; s++) expect(body(formatTf2Outro(s))).toBe(false);
    expect(formatTf2Outro(FRAMES - 1)[3]).toContain(',._,');
  });
});

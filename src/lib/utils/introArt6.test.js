import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import { formatArkFrame } from './introArt3.js';
import {
  formatArkAscendedFrame, arkAscendedFrameKinds, formatArkAscendedOutro,
  BATCH6_FRAME_COUNT
} from './introArt6.js';

const FRAMES = BATCH6_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['ARK: Survival Ascended', formatArkAscendedFrame],
  ['ARK: Survival Ascended outro', formatArkAscendedOutro]
];

describe.each(SEQUENCES)('%s (#514)', (_, format) => {
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

  it('keeps the obelisk standing at the left edge', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[4].startsWith('/__')).toBe(true);
  });
});

describe('ARK: Survival Ascended specifics (#514)', () => {
  const raptor = frame => frame[2].indexOf(',o>');
  const crateRow = frame => frame.findIndex(r => r.includes('[+]'));

  it('the intro is green, like every game', () => {
    expect(arkAscendedFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('is its own scene, not the ARK Survival (Evolved) sauropod', () => {
    expect(formatArkAscendedFrame(0)).not.toEqual(formatArkFrame(0));
    expect(formatArkAscendedFrame(0).join('')).not.toContain('/ o)');
  });

  it('the raptor sprints left to right', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(raptor(formatArkAscendedFrame(s))).toBeGreaterThan(raptor(formatArkAscendedFrame(s - 1)));
    }
  });

  it('the supply drop floats down under its chute, then lands with its beacon beam', () => {
    expect(crateRow(formatArkAscendedFrame(0))).toBe(0);
    expect(formatArkAscendedFrame(3).join('')).toContain('(^)');
    expect(crateRow(formatArkAscendedFrame(7))).toBe(4);
    expect(formatArkAscendedFrame(7).join('')).not.toContain('(^)');
    expect(formatArkAscendedFrame(7)[0]).toContain('|');
  });

  it('the outro: a Rex stomps in and crushes the drop', () => {
    expect(formatArkAscendedOutro(0)[4]).toContain('[+]');
    expect(formatArkAscendedOutro(7)[4]).toContain('_x_');
    expect(formatArkAscendedOutro(7).join('')).not.toContain('[+]');
    // The Rex's jaws move left every step.
    const jaws = s => formatArkAscendedOutro(s)[2].indexOf('<__');
    for (let s = 1; s < FRAMES; s++) expect(jaws(s)).toBeLessThan(jaws(s - 1));
  });
});

import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatArmaFrame, armaFrameKinds, formatArmaOutro, BATCH8_FRAME_COUNT
} from './introArt8.js';

const FRAMES = BATCH8_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Arma Reforger', formatArmaFrame],
  ['Arma Reforger outro', formatArmaOutro]
];

describe.each(SEQUENCES)('%s (#521)', (_, format) => {
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

  it('keeps the capture point standing on the right', () => {
    for (let step = 0; step < FRAMES; step++) {
      for (let r = 1; r <= 4; r++) expect(format(step)[r][31]).toBe('|');
    }
  });
});

describe('Arma Reforger specifics (#521)', () => {
  const flagRow = frame => frame.findIndex(r => r[32] === '>');
  const top = (frame, cabin) => frame.findIndex(r => r.includes(cabin)) - 1;

  it('the intro is green, like every game', () => {
    expect(armaFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the helicopter flies in from the left and sets down with its skids on the ground row', () => {
    const column = s => formatArmaFrame(s).find(r => r.includes('[__o]')).indexOf('[__o]');
    for (let s = 1; s < FRAMES; s++) expect(column(s)).toBeGreaterThanOrEqual(column(s - 1));
    expect(top(formatArmaFrame(0), '[__o]')).toBe(0);
    expect(top(formatArmaFrame(FRAMES - 1), '[__o]')).toBe(2);
  });

  it('the soldier jumps out only after landing, and the flag goes up once the soldier reaches the pole', () => {
    const soldier = s => formatArmaFrame(s)[3].indexOf('/|' + String.fromCharCode(92) + ' ');
    expect(formatArmaFrame(4)[2]).not.toMatch(/o/);
    expect(formatArmaFrame(5)[2]).toMatch(/o/);
    expect(flagRow(formatArmaFrame(0))).toBe(4);
    expect(flagRow(formatArmaFrame(FRAMES - 1))).toBe(1);
    for (let s = 6; s < FRAMES; s++) expect(soldier(s)).toBeGreaterThan(soldier(s - 1));
  });

  it('the outro: a tank rolls in, the flag comes down and the helicopter flies off left', () => {
    expect(flagRow(formatArmaOutro(0))).toBe(1);
    expect(flagRow(formatArmaOutro(FRAMES - 1))).toBe(4);
    // Measured once the whole hull is on screen and clear of the pole.
    const tank = s => formatArmaOutro(s)[4].indexOf('(oooo)');
    for (let s = 5; s < FRAMES; s++) expect(tank(s)).toBeLessThan(tank(s - 1));
    const heli = s => formatArmaOutro(s).join('\n').indexOf('=+-');
    expect(top(formatArmaOutro(0), '=+-')).toBe(2);
    expect(top(formatArmaOutro(FRAMES - 1), '=+-')).toBe(0);
    expect(heli(FRAMES - 1)).toBeGreaterThanOrEqual(0);
  });
});

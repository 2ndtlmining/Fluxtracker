import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatSevenDaysFrame, sevenDaysFrameKinds, formatSevenDaysOutro,
  BATCH5_FRAME_COUNT
} from './introArt5.js';

const FRAMES = BATCH5_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['7 Days to Die', formatSevenDaysFrame],
  ['7 Days to Die outro', formatSevenDaysOutro]
];

describe.each(SEQUENCES)('%s (#505)', (_, format) => {
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

  it('shows no numbers -- not even a day counter', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step).join('')).not.toMatch(/\d/);
  });
});

describe('7 Days to Die specifics (#505)', () => {
  const zombies = frame => (frame[2].match(/_o/g) || []).length;
  const leadZombie = frame => frame[2].indexOf('_o', 10);

  it('the intro is green, like every game', () => {
    expect(sevenDaysFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the horde shambles in and the barricade holds', () => {
    expect(leadZombie(formatSevenDaysFrame(7))).toBeLessThan(leadZombie(formatSevenDaysFrame(0)));
    for (let s = 0; s < FRAMES; s++) {
      const frame = formatSevenDaysFrame(s);
      expect(frame.slice(2, 5).every(r => r.slice(13, 14) === '>')).toBe(true);
      expect(leadZombie(frame)).toBeGreaterThanOrEqual(15);
    }
  });

  it('the survivor swings the hammer on alternate steps', () => {
    expect(formatSevenDaysFrame(0)[2]).toContain('o T');
    expect(formatSevenDaysFrame(1)[3]).toContain('_T');
  });

  it('the outro: a blood moon, the stakes break, and the horde reaches the shack', () => {
    expect(formatSevenDaysOutro(4)[0]).toContain('(@)');
    expect(formatSevenDaysOutro(0).slice(2, 5).join('')).toContain('>=');
    expect(formatSevenDaysOutro(7).slice(2, 5).join('')).not.toContain('>');
    // The lead zombie is past the barricade (column 13) by the last step.
    expect(formatSevenDaysOutro(7)[2].indexOf('_o')).toBeLessThan(13);
    expect(zombies(formatSevenDaysOutro(0))).toBe(3);
  });
});

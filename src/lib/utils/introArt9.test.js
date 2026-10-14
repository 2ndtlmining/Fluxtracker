import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatGmodFrame, gmodFrameKinds, formatGmodOutro, BATCH9_FRAME_COUNT
} from './introArt9.js';

const FRAMES = BATCH9_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ["Garry's Mod", formatGmodFrame],
  ["Garry's Mod outro", formatGmodOutro]
];

describe.each(SEQUENCES)('%s (#524)', (_, format) => {
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

  it('keeps the construct floor under everything', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[5]).toMatch(/^_\|__/);
  });
});

describe("Garry's Mod specifics (#524)", () => {
  // Props standing in the tower's column, counted up from the floor.
  const tower = frame => {
    let count = 0;
    for (let r = 4; r >= 1 && frame[r].slice(22, 25).trim() !== ''; r--) count++;
    return count;
  };

  it('the intro is green, like every game', () => {
    expect(gmodFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the beam carries props in one at a time and the tower only ever grows', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(tower(formatGmodFrame(s))).toBeGreaterThanOrEqual(tower(formatGmodFrame(s - 1)));
    }
    expect(tower(formatGmodFrame(0))).toBe(0);
    expect(tower(formatGmodFrame(FRAMES - 1))).toBe(4);
    // The beam leaves the gun on every frame.
    for (let s = 0; s < FRAMES; s++) expect(formatGmodFrame(s)[3]).toMatch(/^\/\|==[~-]/);
  });

  it('the melon crowns the finished tower', () => {
    expect(formatGmodFrame(FRAMES - 1)[1].slice(22, 25)).toBe('(@)');
  });

  it('the outro: ERROR lands, the props tumble off and the player noclips away', () => {
    const errorRow = s => formatGmodOutro(s).findIndex(r => r.includes('ERROR'));
    expect(errorRow(0)).toBe(1);
    expect(errorRow(FRAMES - 1)).toBe(4);
    for (let s = 1; s < FRAMES; s++) {
      expect(tower(formatGmodOutro(s))).toBeLessThanOrEqual(tower(formatGmodOutro(s - 1)));
    }
    expect(tower(formatGmodOutro(0))).toBe(4);
    expect(tower(formatGmodOutro(FRAMES - 1))).toBe(0);
    // All four props still on screen, lying on the floor.
    expect(formatGmodOutro(FRAMES - 1)[4]).toMatch(/\[X\] \[X\] \(=\) \(@\)/);
    const head = s => formatGmodOutro(s).findIndex(r => r.startsWith(' o'));
    expect(head(0)).toBe(2);
    expect(head(FRAMES - 3)).toBe(0);
    expect(head(FRAMES - 1)).toBe(-1);
  });
});

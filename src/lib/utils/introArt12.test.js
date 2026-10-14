import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatCoreKeeperFrame, coreKeeperFrameKinds, formatCoreKeeperOutro, BATCH12_FRAME_COUNT
} from './introArt12.js';

const FRAMES = BATCH12_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Core Keeper', formatCoreKeeperFrame],
  ['Core Keeper outro', formatCoreKeeperOutro]
];

describe.each(SEQUENCES)('%s (#530)', (_, format) => {
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

describe('Core Keeper specifics (#530)', () => {
  // The Core's eye, or null once rubble covers it.
  const eye = frame => frame[3].match(/\[\( (.) \)\]/)?.[1] ?? null;
  const rubble = frame => frame.join('').split('%').length - 1;
  const explorer = frame => frame[2].search(/o/);

  it('the intro is green, like every game', () => {
    expect(coreKeeperFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the Core stands in the cave through the whole intro', () => {
    for (let s = 0; s < FRAMES; s++) expect(eye(formatCoreKeeperFrame(s))).not.toBeNull();
  });

  it('the explorer carries the gem in, sets it in the Core, and the Core wakes', () => {
    for (let s = 1; s < FRAMES; s++) {
      expect(explorer(formatCoreKeeperFrame(s))).toBeGreaterThanOrEqual(explorer(formatCoreKeeperFrame(s - 1)));
    }
    for (let s = 0; s < 4; s++) expect(formatCoreKeeperFrame(s)[3]).toMatch(/-\*/);
    for (let s = 0; s < 5; s++) expect(eye(formatCoreKeeperFrame(s))).toBe('-');
    expect(eye(formatCoreKeeperFrame(5))).toBe('*');
    for (let s = 6; s < FRAMES; s++) expect(eye(formatCoreKeeperFrame(s))).toBe('@');
  });

  it('light ripples out only once the Core is awake', () => {
    const rings = s => (formatCoreKeeperFrame(s)[3].match(/\(/g) || []).length - 1;
    for (let s = 0; s < 6; s++) expect(rings(s)).toBe(0);
    expect(rings(6)).toBe(1);
    expect(rings(7)).toBe(2);
  });

  it('the outro: the Core dims, the explorer runs, and the cave comes down', () => {
    expect(rubble(formatCoreKeeperOutro(0))).toBe(0);
    for (let s = 1; s < FRAMES; s++) {
      expect(rubble(formatCoreKeeperOutro(s))).toBeGreaterThan(0);
    }
    expect(eye(formatCoreKeeperOutro(0))).toBe('@');
    expect(eye(formatCoreKeeperOutro(2))).toBe('o');
    expect(eye(formatCoreKeeperOutro(4))).toBe('-');
    // Gone left before the pile reaches his head, and the Core buried at the end.
    for (let s = 4; s < FRAMES; s++) expect(explorer(formatCoreKeeperOutro(s))).toBe(-1);
    expect(eye(formatCoreKeeperOutro(FRAMES - 1))).toBeNull();
    expect(formatCoreKeeperOutro(FRAMES - 1).slice(1, 5).join('').replace(/%/g, '')).toBe('');
  });
});

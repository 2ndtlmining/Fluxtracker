import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatTheIsleFrame, theIsleFrameKinds, formatTheIsleOutro, BATCH13_FRAME_COUNT
} from './introArt13.js';

const FRAMES = BATCH13_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['The Isle', formatTheIsleFrame],
  ['The Isle outro', formatTheIsleOutro]
];

describe.each(SEQUENCES)('%s (#535)', (_, format) => {
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

  it('the palm stands in every frame: the header smoke keys on its crown', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[2]).toContain('--*--');
  });
});

describe('The Isle specifics (#535)', () => {
  const egg = frame => /\.-\.|\.\^\./.test(frame[3]);
  const head = frame => frame.join('\n').match(/o[<>]/)?.[0] ?? null;
  const headColumn = frame => frame.map(row => row.search(/o[<>]/)).find(c => c >= 0) ?? -1;
  const sand = frame => (frame[5].match(/\./g) || []).length;

  it('the intro is green, like every game', () => {
    expect(theIsleFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the egg sits, wobbles and cracks before anything hatches', () => {
    for (let s = 0; s < 3; s++) {
      expect(egg(formatTheIsleFrame(s))).toBe(true);
      expect(head(formatTheIsleFrame(s))).toBeNull();
    }
    expect(formatTheIsleFrame(2)[3]).toContain('.^.');
  });

  it('the hatchling grows into an adult, which roars at the end', () => {
    for (let s = 3; s < FRAMES; s++) {
      expect(egg(formatTheIsleFrame(s))).toBe(false);
      expect(head(formatTheIsleFrame(s))).not.toBeNull();
    }
    // Hatchling and juvenile on two rows, the adult on three.
    expect(formatTheIsleFrame(4)[2]).not.toMatch(/o[<>]/);
    expect(formatTheIsleFrame(6)[2]).toMatch(/o>/);
    expect(head(formatTheIsleFrame(6))).toBe('o>');
    expect(head(formatTheIsleFrame(7))).toBe('o<');
    expect(formatTheIsleFrame(7)[2]).toContain(')))');
  });

  it('the outro: the adult wades out to the right and the tide covers the beach', () => {
    expect(headColumn(formatTheIsleOutro(1))).toBeGreaterThan(headColumn(formatTheIsleOutro(0)));
    // Head first into the water: by the third frame only its back and tail are left.
    expect(head(formatTheIsleOutro(2))).toBeNull();
    expect(formatTheIsleOutro(2)[3]).toContain('_/');
    for (let s = 1; s < FRAMES; s++) {
      expect(sand(formatTheIsleOutro(s))).toBeLessThanOrEqual(sand(formatTheIsleOutro(s - 1)));
    }
    expect(sand(formatTheIsleOutro(0))).toBeGreaterThan(0);
    expect(sand(formatTheIsleOutro(FRAMES - 1))).toBe(0);
    expect(head(formatTheIsleOutro(FRAMES - 1))).toBeNull();
  });
});

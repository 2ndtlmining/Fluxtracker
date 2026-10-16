import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatTModLoaderFrame, tModLoaderFrameKinds, formatTModLoaderOutro, BATCH14_FRAME_COUNT
} from './introArt14.js';

const FRAMES = BATCH14_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['tModLoader', formatTModLoaderFrame],
  ['tModLoader outro', formatTModLoaderOutro]
];

describe.each(SEQUENCES)('%s (#533)', (_, format) => {
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

describe('tModLoader specifics (#533)', () => {
  const pieceTop = frame => frame.findIndex(row => row.includes('.-(_)-.'));
  const slotted = frame => !/" {7},/.test(frame[4]) && !/\. {7}\./.test(frame[5]);
  const player = frame => frame.map(row => row.search(/ o[ /]/)).find(c => c >= 0) ?? -1;

  it('the intro is green, like every game', () => {
    expect(tModLoaderFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the piece is in every intro frame: the header smoke keys on its top', () => {
    for (let step = 0; step < FRAMES; step++) expect(pieceTop(formatTModLoaderFrame(step))).toBeGreaterThanOrEqual(0);
  });

  it('the piece falls into the gap and clicks in', () => {
    for (let s = 1; s < 5; s++) {
      expect(pieceTop(formatTModLoaderFrame(s))).toBe(pieceTop(formatTModLoaderFrame(s - 1)) + 1);
    }
    expect(slotted(formatTModLoaderFrame(0))).toBe(false);
    for (let s = 4; s < FRAMES; s++) expect(slotted(formatTModLoaderFrame(s))).toBe(true);
  });

  it('once it is in, sparks fly and the player draws and raises a blade', () => {
    expect(formatTModLoaderFrame(4).join('')).not.toContain('*  ');
    expect(formatTModLoaderFrame(5)[3]).toContain('*');
    expect(formatTModLoaderFrame(6)[2]).toContain('o/==>');
    expect(formatTModLoaderFrame(7)[1]).toContain('/');
    expect(formatTModLoaderFrame(7)[2]).toContain('o/');
  });

  it('the outro: the piece rises out and away, the player leaves, the gap stays open', () => {
    for (let s = 1; s < 5; s++) {
      expect(pieceTop(formatTModLoaderOutro(s))).toBe(pieceTop(formatTModLoaderOutro(s - 1)) - 1);
    }
    expect(slotted(formatTModLoaderOutro(0))).toBe(true);
    expect(pieceTop(formatTModLoaderOutro(FRAMES - 1))).toBe(-1);
    expect(slotted(formatTModLoaderOutro(FRAMES - 1))).toBe(false);
    expect(player(formatTModLoaderOutro(5))).toBeLessThan(player(formatTModLoaderOutro(0)));
    expect(player(formatTModLoaderOutro(FRAMES - 1))).toBe(-1);
  });
});

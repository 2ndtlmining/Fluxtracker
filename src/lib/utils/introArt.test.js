import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import {
  formatOrbitFrame, orbitFrameKinds, ORBIT_FRAME_COUNT,
  formatZomboidFrame, zomboidFrameKinds, ZOMBOID_FRAME_COUNT,
  formatFoldingFrame, foldingFrameKinds, FOLDING_FRAME_COUNT,
  formatCryptoFrame, cryptoFrameKinds, CRYPTO_FRAME_COUNT,
  ROW_KIND_PURPLE, ROW_KIND_BLUE, ROW_KIND_GOLD
} from './introArt.js';

const ctx = { blockHeight: 2_976_770, app: { name: 'x', instances: 2 } };

const INTROS = [
  ['orbit (#272)', formatOrbitFrame, orbitFrameKinds, ORBIT_FRAME_COUNT, ROW_KIND_PURPLE],
  ['zomboid (#273)', formatZomboidFrame, zomboidFrameKinds, ZOMBOID_FRAME_COUNT, 'deployed'],
  ['folding (#274)', formatFoldingFrame, foldingFrameKinds, FOLDING_FRAME_COUNT, ROW_KIND_BLUE],
  ['crypto (#275)', formatCryptoFrame, cryptoFrameKinds, CRYPTO_FRAME_COUNT, ROW_KIND_GOLD]
];

describe.each(INTROS)('%s', (_, format, kinds, count, accent) => {
  const frames = Array.from({ length: count }, (__, step) => format(step, ctx));

  it('every frame is BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, none empty', () => {
    for (const frame of frames) {
      expect(frame).toHaveLength(BOOT_LINE_COUNT);
      for (const row of frame) {
        expect(row).toHaveLength(LOGO_WIDTH);
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('animates: every frame differs from the one before', () => {
    for (let i = 1; i < frames.length; i++) expect(frames[i]).not.toEqual(frames[i - 1]);
  });

  it('is a pure function of the step and wraps', () => {
    expect(format(3, ctx)).toEqual(format(3, ctx));
    expect(format(count + 2, ctx)).toEqual(format(2, ctx));
  });

  it('one accent across the whole frame', () => {
    expect(kinds()).toEqual(Array(BOOT_LINE_COUNT).fill(accent));
  });
});

describe('orbit specifics', () => {
  it('merges on step 6 and finishes the push with OK', () => {
    expect(formatOrbitFrame(5).join('\n')).not.toContain('@');
    expect(formatOrbitFrame(6)[0]).toContain('@');
    expect(formatOrbitFrame(7)[5]).toMatch(/\[=+\] OK/);
    expect(formatOrbitFrame(0)[5]).toMatch(/13%/);
  });
});

describe('zomboid specifics', () => {
  it('the zombie walks toward the house and stops at the boards, never inside', () => {
    const headColumn = step => formatZomboidFrame(step)[1].indexOf('_o_');
    expect(headColumn(0)).toBeGreaterThan(headColumn(5));
    expect(headColumn(6)).toBe(headColumn(7));
    for (let s = 0; s < ZOMBOID_FRAME_COUNT; s++) expect(headColumn(s)).toBeGreaterThan(14);
  });
});

describe('crypto specifics', () => {
  it('shows the real block height and never ticks it past the chain tip', () => {
    for (let s = 0; s < CRYPTO_FRAME_COUNT; s++) expect(formatCryptoFrame(s, ctx)[4]).toContain('height 2,976,770');
    expect(formatCryptoFrame(0, {})[4]).toContain('height —');
  });

  it('the chain shifts left once the block is mined', () => {
    expect(formatCryptoFrame(5, ctx)[1]).toMatch(/^\s+\|#a4f\|/);
    expect(formatCryptoFrame(6, ctx)[1]).toMatch(/^\s+\|#9c1\|/);
  });
});

describe('folding specifics', () => {
  it('shows no invented counter, only the strands and a progress cell', () => {
    for (let s = 0; s < FOLDING_FRAME_COUNT; s++) expect(formatFoldingFrame(s).join('\n')).not.toMatch(/wu \d/);
    expect(formatFoldingFrame(7)[5]).toContain('[########]');
  });
});

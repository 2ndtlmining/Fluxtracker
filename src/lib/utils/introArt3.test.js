import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatEnshroudedFrame, enshroudedFrameKinds, formatEnshroudedOutro,
  formatRustFrame, rustFrameKinds, formatRustOutro,
  formatWindroseFrame, windroseFrameKinds, formatWindroseOutro,
  formatTerrariaFrame, terrariaFrameKinds, formatTerrariaOutro,
  formatFivemOutro,
  BATCH3_FRAME_COUNT
} from './introArt3.js';

const FRAMES = BATCH3_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Enshrouded', formatEnshroudedFrame],
  ['Enshrouded outro', formatEnshroudedOutro],
  ['Rust', formatRustFrame],
  ['Rust outro', formatRustOutro],
  ['Windrose', formatWindroseFrame],
  ['Windrose outro', formatWindroseOutro],
  ['Terraria', formatTerrariaFrame],
  ['Terraria outro', formatTerrariaOutro],
  ['FiveM outro', formatFivemOutro]
];

describe.each(SEQUENCES)('%s (#418)', (_, format) => {
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

  it('shows no numbers -- there is no reading behind this art', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step).join('')).not.toMatch(/\d/);
  });
});

describe('intro accents (#418)', () => {
  it.each([enshroudedFrameKinds, rustFrameKinds, windroseFrameKinds, terrariaFrameKinds])('games are green', kinds => {
    expect(kinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });
});

describe('specifics (#418)', () => {
  it('Enshrouded: the flame pushes the Shroud back, and the outro lets it swallow the altar', () => {
    const shroudStart = frame => frame[1].search(/[%:]/);
    expect(shroudStart(formatEnshroudedFrame(7))).toBeGreaterThan(shroudStart(formatEnshroudedFrame(0)));
    expect(shroudStart(formatEnshroudedOutro(7))).toBeLessThan(shroudStart(formatEnshroudedOutro(0)));
  });

  it('Rust: the crate lands beside the shack; the outro decays the shack to rubble', () => {
    expect(formatRustFrame(0).join('')).not.toContain('[#]');
    expect(formatRustFrame(7)[4]).toContain('[#]');
    expect(formatRustOutro(0)[1]).toContain('______');
    expect(formatRustOutro(7).slice(1, 4).join('')).not.toMatch(/\[\]/);
  });

  it('Windrose: the compass needle turns a point per step; the outro sinks the ship', () => {
    const tips = Array.from({ length: FRAMES }, (_, s) => formatWindroseFrame(s).slice(1, 4).map(r => r.indexOf('*', 26)).join());
    expect(new Set(tips).size).toBe(FRAMES);
    const hullRow = frame => frame.findIndex(r => r.includes('[___]'));
    expect(hullRow(formatWindroseOutro(7))).toBeGreaterThan(hullRow(formatWindroseOutro(0)));
  });

  it('Terraria: the tunnel advances a block per step, and night brings the Eye', () => {
    const face = frame => frame[3].lastIndexOf('o');
    expect(face(formatTerrariaFrame(1))).toBeGreaterThan(face(formatTerrariaFrame(0)));
    expect(formatTerrariaOutro(0).join('')).not.toContain('(O)');
    expect(formatTerrariaOutro(7).join('')).toContain('(O)');
  });

  it('FiveM outro: the road stops and the car leaves', () => {
    expect(formatFivemOutro(0)[5]).toBe(formatFivemOutro(5)[5]);
    expect(formatFivemOutro(0)[2]).toContain('[]');
    expect(formatFivemOutro(7)[2]).not.toContain('[]');
  });
});

import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatBeamMpFrame, beamMpFrameKinds, formatBeamMpOutro, BATCH18_FRAME_COUNT
} from './introArt18.js';

const FRAMES = BATCH18_FRAME_COUNT;
const BARRIER = ']=[]=[';
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['BeamMP', formatBeamMpFrame],
  ['BeamMP outro', formatBeamMpOutro]
];

describe.each(SEQUENCES)('%s (#549)', (_, format) => {
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

  it('the crash barrier is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[4]).toContain(BARRIER);
  });

  it('the row the header smoke watches moves', () => {
    const wheelRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      const row = format(step)[3];
      expect(row).toMatch(/'-o|o-'/);
      wheelRows.add(row);
    }
    expect(wheelRows.size).toBeGreaterThan(1);
  });
});

describe('BeamMP specifics (#549)', () => {
  const crumpled = frame => frame[2].includes('}') && frame[2].includes('{');
  const sparks = frame => /[\\|/]/.test(frame[0]);
  const looseWheelAt = frame => frame[3].lastIndexOf('o');
  const towTruck = frame => frame[2].includes('\\_|__');
  const hooked = frame => frame[2].includes('==');

  it('the intro is green, like every game', () => {
    expect(beamMpFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the cars close in whole, then meet head-on and crumple with sparks', () => {
    for (let s = 0; s < 3; s++) {
      expect(crumpled(formatBeamMpFrame(s))).toBe(false);
      expect(sparks(formatBeamMpFrame(s))).toBe(false);
    }
    const gap = s => {
      const row = formatBeamMpFrame(s)[2];
      return row.lastIndexOf('/_|_') - row.indexOf('/_|_');
    };
    expect(gap(1)).toBeLessThan(gap(0));
    expect(gap(2)).toBeLessThan(gap(1));
    expect(crumpled(formatBeamMpFrame(3))).toBe(true);
    expect(sparks(formatBeamMpFrame(3))).toBe(true);
    expect(sparks(formatBeamMpFrame(4))).toBe(true);
  });

  it('a wheel comes off and rolls away to the right', () => {
    for (let s = 6; s < FRAMES; s++) {
      expect(looseWheelAt(formatBeamMpFrame(s))).toBeGreaterThan(looseWheelAt(formatBeamMpFrame(s - 1)));
    }
    expect(formatBeamMpFrame(FRAMES - 1)[3]).toContain("_--o-'");
  });

  it('the outro: a tow truck reverses in, hooks one wreck and hauls it off', () => {
    expect(towTruck(formatBeamMpOutro(0))).toBe(false);
    expect(towTruck(formatBeamMpOutro(3))).toBe(true);
    expect(hooked(formatBeamMpOutro(3))).toBe(false);
    for (let s = 4; s < FRAMES - 1; s++) expect(hooked(formatBeamMpOutro(s))).toBe(true);
    const last = formatBeamMpOutro(FRAMES - 1);
    expect(towTruck(last)).toBe(false);
    expect(last[2]).toContain('/_|_}');
    expect(last[2]).not.toContain('{');
  });
});

import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatTruckSimFrame, truckSimFrameKinds, formatTruckSimOutro, BATCH15_FRAME_COUNT
} from './introArt15.js';

const FRAMES = BATCH15_FRAME_COUNT;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Truck Simulator', formatTruckSimFrame],
  ['Truck Simulator outro', formatTruckSimOutro]
];

describe.each(SEQUENCES)('%s (#538)', (_, format) => {
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

  it('the trailer is in every frame: the header smoke keys on its wheels', () => {
    for (let step = 0; step < FRAMES; step++) expect(format(step)[3]).toContain("'-oo---oo'");
  });
});

describe('Truck Simulator specifics (#538)', () => {
  const trailer = frame => frame[3].indexOf("'-oo---oo'");
  // By its cab wall and window, which stay on screen longest as it leaves to the right.
  const cab = frame => frame[2].indexOf('|__');
  const lit = frame => frame[2].includes('=-');
  const coupled = frame => cab(frame) === trailer(frame) + 10;

  it('the intro is green, like every game', () => {
    expect(truckSimFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the cab reverses in from the right and couples to the trailer', () => {
    for (let s = 1; s < 5; s++) expect(cab(formatTruckSimFrame(s))).toBeLessThan(cab(formatTruckSimFrame(s - 1)));
    for (let s = 0; s < 4; s++) expect(coupled(formatTruckSimFrame(s))).toBe(false);
    for (let s = 4; s < FRAMES; s++) expect(coupled(formatTruckSimFrame(s))).toBe(true);
  });

  it('once coupled, the lights come on and the rig pulls away down the road', () => {
    expect(lit(formatTruckSimFrame(4))).toBe(false);
    for (let s = 5; s < FRAMES; s++) expect(lit(formatTruckSimFrame(s))).toBe(true);
    expect(formatTruckSimFrame(5)[0]).toContain('o');
    expect(trailer(formatTruckSimFrame(6))).toBeGreaterThan(trailer(formatTruckSimFrame(5)));
    expect(trailer(formatTruckSimFrame(7))).toBeGreaterThan(trailer(formatTruckSimFrame(6)));
    expect(formatTruckSimFrame(6)[5]).not.toEqual(formatTruckSimFrame(5)[5]);
  });

  it('the outro: lights out, the cab uncouples and leaves, the trailer stays', () => {
    expect(coupled(formatTruckSimOutro(0))).toBe(true);
    expect(lit(formatTruckSimOutro(0))).toBe(true);
    expect(lit(formatTruckSimOutro(1))).toBe(false);
    for (let s = 3; s < 5; s++) expect(cab(formatTruckSimOutro(s))).toBeGreaterThan(cab(formatTruckSimOutro(s - 1)));
    for (let s = 2; s < FRAMES; s++) expect(coupled(formatTruckSimOutro(s))).toBe(false);
    expect(cab(formatTruckSimOutro(FRAMES - 1))).toBe(-1);
    for (let s = 1; s < FRAMES; s++) expect(trailer(formatTruckSimOutro(s))).toBe(trailer(formatTruckSimOutro(0)));
  });
});

import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatAbioticFactorFrame, abioticFactorFrameKinds, formatAbioticFactorOutro,
  BATCH23_FRAME_COUNT
} from './introArt23.js';

const FRAMES = BATCH23_FRAME_COUNT;
const FLOOR = '=:=|';
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /=:=\|=:=\|/;
const LAMP = /\[[o!*.]\]/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Abiotic Factor', formatAbioticFactorFrame],
  ['Abiotic Factor outro', formatAbioticFactorOutro]
];

describe.each(SEQUENCES)('%s', (_, format) => {
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

  it('the floor grating is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toContain(FLOOR);
      expect(format(step).join('\n')).toMatch(SIGNATURE);
    }
  });

  it('the console and the scientist are in every frame', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[4]).toContain('|__|');
      expect(format(step)[3]).toContain('(o)');
    }
  });

  it('the row the header smoke watches moves', () => {
    const lampRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => LAMP.test(r))) lampRows.add(row);
    }
    expect(lampRows.size).toBeGreaterThan(1);
  });
});

describe('Abiotic Factor specifics', () => {
  const lamp = frame => frame[0].match(LAMP)?.[0];
  const scientistAt = frame => frame[3].indexOf('(o)');
  const portal = frame => /[@%]{4}/.test(frame[2]);
  const eyes = frame => frame[3].includes('<oo>');
  const banner = (frame, text) => frame[1].includes(text);
  const shutterRows = frame => frame.filter(r => r.includes('[########]')).length;

  it('the intro is green, like every game', () => {
    expect(abioticFactorFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the scientist walks to the console and starts the experiment', () => {
    const intro = formatAbioticFactorFrame;
    expect(scientistAt(intro(1))).toBeLessThan(scientistAt(intro(0)));
    expect(scientistAt(intro(2))).toBeLessThan(scientistAt(intro(1)));
    expect(intro(1)[3]).toContain('[..]');
    expect(intro(2)[3]).toContain('[>>]');
    expect(intro(2)[4]).toContain('|__|-#');
  });

  it('the ring sparks, opens into a portal, the alarm goes and something looks out', () => {
    const intro = formatAbioticFactorFrame;
    expect(intro(3)[2]).toContain('*');
    expect(intro(4)[2]).toContain('@@');
    for (let s = 0; s < FRAMES; s++) expect(portal(intro(s))).toBe(s >= 5);
    for (let s = 0; s < FRAMES; s++) expect(lamp(intro(s)) === '[o]').toBe(s < 5);
    for (let s = 6; s < FRAMES; s++) expect(lamp(intro(s))).not.toBe(lamp(intro(s - 1)));
    for (let s = 0; s < FRAMES; s++) expect(eyes(intro(s))).toBe(s >= 6);
  });

  it('the breach is announced and the scientist raises his crowbar', () => {
    const intro = formatAbioticFactorFrame;
    for (let s = 0; s < FRAMES; s++) expect(banner(intro(s), 'CONTAINMENT BREACH')).toBe(s >= 6);
    expect(intro(6)[3]).toContain('(o)|');
  });

  it('the outro: something reaches out, the scientist runs to the console and seals it', () => {
    const outro = formatAbioticFactorOutro;
    expect(outro(1)[4]).toContain('~~~');
    expect(outro(2)[4]).toContain('~~~~~~');
    for (let s = 1; s < 4; s++) expect(scientistAt(outro(s))).toBeLessThan(scientistAt(outro(s - 1)));
    expect(outro(3)[4]).toContain('|__|-#');
    for (let s = 0; s < FRAMES; s++) expect(eyes(outro(s))).toBe(s < 4);
    const shutter = Array.from({ length: FRAMES }, (_, s) => shutterRows(outro(s)));
    expect(shutter).toEqual([0, 0, 0, 0, 1, 2, 4, 4]);
  });

  it('the lights go out under the lockdown', () => {
    const outro = formatAbioticFactorOutro;
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'FACILITY LOCKDOWN')).toBe(s >= 6);
    for (let s = 0; s < FRAMES; s++) expect(lamp(outro(s)) === '[.]').toBe(s === 7);
    expect(outro(7)[3]).toContain('[  ]');
  });
});

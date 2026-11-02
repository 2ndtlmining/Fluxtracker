import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatTheForestFrame, theForestFrameKinds, formatTheForestOutro, BATCH25_FRAME_COUNT
} from './introArt25.js';

const FRAMES = BATCH25_FRAME_COUNT;
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /_;:_;:_/;
const FIRE = /\)[*^_.]\(/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['The Forest', formatTheForestFrame],
  ['The Forest outro', formatTheForestOutro]
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

  it('the forest floor and the fire are in every frame: the header smoke keys on them', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toMatch(SIGNATURE);
      expect(format(step)[5]).toMatch(FIRE);
    }
  });

  it("the airliner's tail is in every frame", () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[0]).toContain('|' + String.fromCharCode(92));
      expect(format(step)[3]).toContain('[o_o_o]');
    }
  });

  it('the row the header smoke watches moves', () => {
    const fireRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => FIRE.test(r))) fireRows.add(row);
    }
    expect(fireRows.size).toBeGreaterThan(1);
  });

  it('never draws a gamepad or the fuse, which the smoke would read as their frames', () => {
    for (let step = 0; step < FRAMES; step++) {
      const joined = format(step).join('\n');
      expect(joined).not.toMatch(/\[\^\]|\{\^\}|\(\*\)/);
      expect(joined).not.toMatch(/\| (APP|\.\.\.) \|/);
    }
  });
});

describe('The Forest specifics', () => {
  const fire = frame => frame[5].match(FIRE)?.[0];
  const survivorAt = frame => frame[3].search(/ o /);
  // The pine's own columns: the cabin's roof is a row of ^ too.
  const pineStanding = frame => frame[2].slice(1, 6) === '^^^^^';
  const cabinRows = frame => [frame[2], frame[3], frame[4]].filter(r => r.slice(14, 21).match(/^(\/\^{5}\\|\|=====\||\|=\[.\]=\|)$/)).length;
  const door = frame => frame[4].match(/\|=\[(.)\]=\|/)?.[1];
  const effigy = frame => frame[3].includes('-+-');
  const cannibalAt = frame => frame[3].indexOf('@');
  const banner = (frame, text) => frame[1].includes(text);

  it('the intro is green, like every game', () => {
    expect(theForestFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('he fells the pine and builds the cabin out of it, wall by wall', () => {
    const intro = formatTheForestFrame;
    for (let s = 0; s < 3; s++) expect(pineStanding(intro(s))).toBe(true);
    for (let s = 3; s < FRAMES; s++) expect(pineStanding(intro(s))).toBe(false);
    expect(intro(3)[4]).toContain('_|_<====');
    expect(intro(2)[4]).toContain('-|' + String.fromCharCode(92));
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(s => cabinRows(intro(s)))).toEqual([0, 0, 0, 0, 1, 2, 3, 3]);
    for (let s = 4; s < 6; s++) expect(survivorAt(intro(s))).toBeGreaterThan(survivorAt(intro(s - 1)));
  });

  it('the fire catches when the cabin is done: find Timmy', () => {
    const intro = formatTheForestFrame;
    for (let s = 0; s < 6; s++) expect(fire(intro(s))).toBe(')_(');
    expect(fire(intro(6))).not.toBe(fire(intro(7)));
    for (let s = 6; s < FRAMES; s++) expect(fire(intro(s))).toMatch(/\)[*^]\(/);
    for (let s = 0; s < FRAMES; s++) expect(banner(intro(s), 'FIND TIMMY')).toBe(s >= 6);
  });

  it('the outro: a cannibal plants an effigy and the survivor shuts himself in', () => {
    const outro = formatTheForestOutro;
    expect(cannibalAt(outro(0))).toBe(-1);
    for (let s = 2; s < 5; s++) expect(cannibalAt(outro(s))).toBeGreaterThan(cannibalAt(outro(s - 1)));
    for (let s = 0; s < FRAMES; s++) expect(effigy(outro(s))).toBe(s >= 3);
    expect([0, 1, 2].map(s => door(outro(s)))).toEqual([' ', ' ', ' ']);
    for (let s = 3; s < 7; s++) expect(door(outro(s))).toBe('o');
    expect(door(outro(7))).toBe('#');
  });

  it('the cannibal stamps the fire out', () => {
    const outro = formatTheForestOutro;
    for (let s = 0; s < 6; s++) expect(fire(outro(s))).toMatch(/\)[*^]\(/);
    for (let s = 6; s < FRAMES; s++) expect(fire(outro(s))).toBe(').(');
    for (let s = 0; s < FRAMES; s++) expect(banner(outro(s), 'THE FIRE IS OUT')).toBe(s >= 6);
  });
});

import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import { skyFor } from './seasons.js';
import {
  formatConanExilesFrame, conanExilesFrameKinds, formatConanExilesOutro, BATCH20_FRAME_COUNT
} from './introArt20.js';

const FRAMES = BATCH20_FRAME_COUNT;
const FLOOR = "_.:'':.";
// The smoke's signature and moving-row rules, kept the same as check-header.mjs's.
const SIGNATURE = /_\.:'':\./;
const BEAM = /=[=\\o/x|]{3}=/;
const SKIES = [
  ['plain', undefined],
  ['halloween', { sky: skyFor(Date.UTC(2026, 9, 31)) }],
  ['december', { sky: skyFor(Date.UTC(2026, 11, 20)) }]
];

const SEQUENCES = [
  ['Conan Exiles', formatConanExilesFrame],
  ['Conan Exiles outro', formatConanExilesOutro]
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

  it('the desert floor is in every frame: the header smoke keys on it', () => {
    for (let step = 0; step < FRAMES; step++) {
      expect(format(step)[5]).toContain(FLOOR);
      expect(format(step).join('\n')).toMatch(SIGNATURE);
    }
  });

  it('the row the header smoke watches moves', () => {
    const beamRows = new Set();
    for (let step = 0; step < FRAMES; step++) {
      for (const row of format(step).filter(r => BEAM.test(r))) beamRows.add(row);
    }
    expect(beamRows.size).toBeGreaterThan(1);
  });
});

describe('Conan Exiles specifics', () => {
  const tied = frame => frame[1].includes('=' + String.fromCharCode(92) + 'o/=');
  const cut = frame => frame[1].includes('=x|x=');
  const conanAt = frame => frame[4].indexOf('/#');
  const raised = frame => frame[0].includes('^') && frame[2].includes('+');
  const cheering = frame => frame[3].includes(String.fromCharCode(92) + 'o/');
  const storm = frame => frame.slice(0, 5).some(r => r.includes(';:'));

  it('the intro is green, like every game', () => {
    expect(conanExilesFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });

  it('the exile hangs on the cross while Conan strides in from the right', () => {
    for (let s = 0; s < 5; s++) expect(tied(formatConanExilesFrame(s))).toBe(true);
    expect(conanAt(formatConanExilesFrame(0))).toBe(-1);
    for (let s = 2; s < 4; s++) {
      expect(conanAt(formatConanExilesFrame(s))).toBeLessThan(conanAt(formatConanExilesFrame(s - 1)));
    }
  });

  it('he raises his sword, cuts the ropes, walks on, and the exile is free', () => {
    for (let s = 0; s < FRAMES; s++) expect(raised(formatConanExilesFrame(s))).toBe(s === 4);
    expect(cut(formatConanExilesFrame(5))).toBe(true);
    expect(tied(formatConanExilesFrame(5))).toBe(false);
    expect(formatConanExilesFrame(6)[1]).toContain('==|==');
    expect(conanAt(formatConanExilesFrame(6))).toBeGreaterThan(conanAt(formatConanExilesFrame(5)));
    expect(conanAt(formatConanExilesFrame(7))).toBeGreaterThan(conanAt(formatConanExilesFrame(6)));
    for (let s = 0; s < FRAMES; s++) expect(cheering(formatConanExilesFrame(s))).toBe(s === 7);
  });

  it('the outro: a sandstorm crosses from the right and leaves a mound where he stood', () => {
    const head = s => formatConanExilesOutro(s)[3].indexOf('o');
    expect(storm(formatConanExilesOutro(0))).toBe(false);
    expect(head(0)).toBeGreaterThan(-1);
    const front = s => Math.min(...formatConanExilesOutro(s).slice(0, 5).map(r => r.indexOf(';:')).filter(i => i >= 0));
    for (let s = 2; s < 5; s++) expect(front(s)).toBeLessThan(front(s - 1));
    // Once the storm has covered him, he is gone and a mound of sand is left.
    for (let s = 4; s < FRAMES; s++) expect(head(s)).toBe(-1);
    for (let s = 5; s < FRAMES; s++) expect(formatConanExilesOutro(s)[4]).toContain('.^.');
    expect(storm(formatConanExilesOutro(6))).toBe(false);
    expect(formatConanExilesOutro(7).join('')).toContain('v');
  });
});

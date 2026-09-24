import { describe, it, expect } from 'vitest';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  EXPIRING_ICON_LINE,
  formatValheimFrame,
  formatValheimOutro,
  formatDragonOutro,
  formatMinecraftOutro,
  formatPalworldOutro,
  outroFrameKinds
} from './terminalAnimation.js';
import {
  formatZomboidOutro,
  formatFuseFrame,
  fuseFrameKinds,
  formatCraneFrame,
  craneFrameKinds
} from './introArt.js';

const FRAMES = 8;
const expiring = { app: { name: 'wordpress1790000000000', blocksUntilExpiry: 380, instances: 3 } };

const SEQUENCES = [
  ['valheim outro (#182)', formatValheimOutro, {}],
  ['dragon outro (#182)', formatDragonOutro, {}],
  ['minecraft outro (#182)', formatMinecraftOutro, {}],
  ['palworld outro (#182)', formatPalworldOutro, {}],
  ['zomboid outro (#182)', formatZomboidOutro, {}],
  ['fuse (#182 fallback)', formatFuseFrame, expiring],
  ['crane x1 (#181)', formatCraneFrame, { app: { instances: 1 } }],
  ['crane x3 (#181)', formatCraneFrame, { app: { instances: 3 } }]
];

describe.each(SEQUENCES)('%s', (_, format, ctx) => {
  const frames = Array.from({ length: FRAMES }, (__, step) => format(step, ctx));

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
    expect(format(FRAMES + 3, ctx)).toEqual(format(3, ctx));
  });
});

describe('outros leave, rather than arrive', () => {
  const column = (frame, text) => frame.findIndex(row => row.includes(text)) === -1
    ? -1
    : Math.max(...frame.map(row => row.indexOf(text)));

  it('the longship ends further right than it starts, and further than the intro ever goes', () => {
    const hull = frame => Math.max(...frame.map(row => row.lastIndexOf('|')));
    expect(hull(formatValheimOutro(7))).toBeGreaterThan(hull(formatValheimOutro(0)));
    expect(hull(formatValheimOutro(7))).toBeGreaterThan(hull(formatValheimFrame(7)));
  });

  it('the zombie walks away from the boards', () => {
    expect(column(formatZomboidOutro(7), '_o_')).toBeGreaterThan(column(formatZomboidOutro(0), '_o_'));
  });

  it('the Minecraft torch goes out and the sun sets', () => {
    expect(formatMinecraftOutro(0).join('\n')).toMatch(/i \[#\]/);
    expect(formatMinecraftOutro(7).join('\n')).not.toMatch(/[i!] \[#\]/);
    const sunRow = step => formatMinecraftOutro(step).findIndex(row => row.includes('(*)'));
    expect(sunRow(7)).toBeGreaterThan(sunRow(0));
  });

  it('every outro is orange across the whole frame', () => {
    expect(outroFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('expiring'));
  });
});

describe('fuse (#182 fallback)', () => {
  it('keeps the EXPIRING bookends and shows the real time left', () => {
    const frame = formatFuseFrame(0, expiring);
    expect(frame[0]).toBe(EXPIRING_ICON_LINE);
    expect(frame[5]).toBe(EXPIRING_ICON_LINE);
    expect(frame[4].trim()).toBe('3h 10m left');
    expect(formatFuseFrame(0, {})[4].trim()).toBe('time running out');
  });

  it('the spark travels toward the app, and the app goes dark when it arrives', () => {
    const spark = step => formatFuseFrame(step, expiring)[2].indexOf('*');
    expect(spark(3)).toBeLessThan(spark(0));
    expect(formatFuseFrame(6, expiring)[2]).toContain('| APP |');
    expect(formatFuseFrame(7, expiring)[2]).toContain('| ... |');
    expect(formatFuseFrame(7, expiring)[2]).not.toContain('=');
  });

  it('bookends orange, the fuse in plain text', () => {
    expect(fuseFrameKinds()).toEqual(['expiring', 'text', 'text', 'text', 'text', 'expiring']);
  });
});

describe('crane (#181)', () => {
  const landed = instances => formatCraneFrame(7, { app: { instances } })[4].match(/\[#\]/g)?.length ?? 0;

  it('stacks one container per instance, capped at three', () => {
    expect(landed(1)).toBe(1);
    expect(landed(2)).toBe(2);
    expect(landed(3)).toBe(3);
    expect(landed(12)).toBe(3);
    expect(landed(undefined)).toBe(1);
  });

  it('the container descends one row per step until it lands', () => {
    const loadRow = step => formatCraneFrame(step, { app: { instances: 1 } }).findIndex((row, i) => i > 0 && i < 4 && row.includes('[#]'));
    expect([0, 1, 2].map(loadRow)).toEqual([1, 2, 3]);
  });

  it('a green deployment accent', () => {
    expect(craneFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill('deployed'));
  });
});

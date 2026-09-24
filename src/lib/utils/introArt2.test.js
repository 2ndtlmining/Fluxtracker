import { describe, it, expect } from 'vitest';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  formatValheimFrame,
  formatValheimOarsFrame,
  formatPalworldFrame,
  formatPalworldCatchFrame
} from './terminalAnimation.js';
import {
  formatAgentFrame, agentFrameKinds,
  formatWordpressFrame, wordpressFrameKinds,
  formatVpnFrame, vpnFrameKinds,
  formatProbeFrame, probeFrameKinds,
  formatFivemFrame, fivemFrameKinds,
  formatCampfireFrame, campfireFrameKinds,
  BATCH2_FRAME_COUNT
} from './introArt2.js';
import { pickVariant } from './introVariants.js';

const FRAMES = BATCH2_FRAME_COUNT;

const SEQUENCES = [
  ['AI agent (#276)', formatAgentFrame, agentFrameKinds, 'blue'],
  ['WordPress (#277)', formatWordpressFrame, wordpressFrameKinds, 'blue'],
  ['VPN / proxy (#278)', formatVpnFrame, vpnFrameKinds, 'purple'],
  ['Globalping probe (#279)', formatProbeFrame, probeFrameKinds, 'blue'],
  ['FiveM (#280)', formatFivemFrame, fivemFrameKinds, 'deployed'],
  ['Dragonwilds campfire (#281)', formatCampfireFrame, campfireFrameKinds, 'deployed'],
  ['Valheim oars (#281)', formatValheimOarsFrame, null, null],
  ['Palworld catch (#281)', formatPalworldCatchFrame, null, null]
];

describe.each(SEQUENCES)('%s', (_, format, kinds, accent) => {
  const frames = Array.from({ length: FRAMES }, (__, step) => format(step));

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
    expect(format(FRAMES + 5)).toEqual(format(5));
  });

  it.runIf(kinds)('one accent across the frame', () => {
    expect(kinds()).toEqual(Array(BOOT_LINE_COUNT).fill(accent));
  });
});

describe('no invented numbers', () => {
  it('the AI agent shows no token rate and the VPN no cipher', () => {
    for (let s = 0; s < FRAMES; s++) {
      expect(formatAgentFrame(s).join('\n')).not.toMatch(/tokens|\d+\/s/);
      expect(formatVpnFrame(s).join('\n')).not.toMatch(/AES|\d{3}/);
      expect(formatProbeFrame(s).join('\n')).not.toMatch(/\d+ ?ms/);
    }
  });
});

describe('specifics', () => {
  it('WordPress types the post, then publishes it', () => {
    expect(formatWordpressFrame(0)[1]).not.toContain('Hello, world');
    expect(formatWordpressFrame(6)[5]).toContain('[ PUBLISH ]');
    expect(formatWordpressFrame(7)[1]).toContain('Hello, world');
    expect(formatWordpressFrame(7)[5]).toContain('[PUBLISHED]');
  });

  it('the probe ring widens step by step', () => {
    const reach = s => formatProbeFrame(s)[1].indexOf(')') - formatProbeFrame(s)[1].indexOf('(');
    expect(reach(1)).toBeGreaterThan(reach(0));
    expect(reach(3)).toBeGreaterThan(reach(2));
  });

  it('the Valheim variant rows the ship and flies a raven, not gulls', () => {
    expect(formatValheimOarsFrame(0).join('\n')).toMatch(/v\//);
    expect(formatValheimOarsFrame(0)).not.toEqual(formatValheimFrame(0));
  });

  it('the Palworld variant catches the sphere and lights up', () => {
    expect(formatPalworldCatchFrame(7).join('\n')).toContain('(^.^)');
    expect(formatPalworldFrame(7).join('\n')).not.toContain('(^.^)');
  });
});

describe('pickVariant (#281)', () => {
  it('is deterministic per app name and stays in range', () => {
    const variants = ['a', 'b'];
    expect(pickVariant('dragonwilds1790087212677', variants)).toBe(pickVariant('dragonwilds1790087212677', variants));
    expect(variants).toContain(pickVariant('x', variants));
    expect(pickVariant('anything', ['only'])).toBe('only');
  });

  it('pins the header-smoke fixtures: each game fixture plays a known variant', () => {
    // If a hash change moves these, check-header's art signatures must be revisited.
    const two = [0, 1];
    expect(pickVariant('valheim1789155733041', two)).toBe(1);      // oars + raven (hull still present)
    expect(pickVariant('dragonwilds1789155733041', two)).toBe(1);  // campfire
    expect(pickVariant('palworld1789155733041', two)).toBe(0);     // the original throw
  });

  it('actually varies across apps -- both variants turn up in a realistic sample', () => {
    const names = Array.from({ length: 40 }, (_, i) => `dragonwilds17900${String(i).padStart(8, '0')}`);
    const picks = new Set(names.map(n => pickVariant(n, ['a', 'b'])));
    expect(picks).toEqual(new Set(['a', 'b']));
  });
});

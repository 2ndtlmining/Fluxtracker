import { describe, it, expect } from 'vitest';
import {
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  DEPLOYED_ICON_LINE,
  LARGE_ICON_LINE,
  isLargeDeployment,
  formatDeploymentFrame,
  formatDeploymentFrameWide,
  formatValheimFrame,
  formatDragonFrame,
  formatMinecraftFrame,
  formatPalworldFrame
} from './terminalAnimation.js';
import { formatZomboidFrame } from './introArt.js';
import { formatCampfireFrame } from './introArt2.js';
import { skyFor, PLAIN_SKY } from './seasons.js';
import {
  formatFireworksFrame,
  fireworksFrameKinds,
  FIREWORKS_FRAME_COUNT,
  formatCaptionFrame,
  pushAttractKey,
  KONAMI
} from './headerExtras.js';

const shape = frame => {
  expect(frame).toHaveLength(BOOT_LINE_COUNT);
  for (const row of frame) {
    expect(row).toHaveLength(LOGO_WIDTH);
    expect(row.trim().length).toBeGreaterThan(0);
  }
};

describe('skyFor (#287)', () => {
  it('pins the dates, in UTC', () => {
    expect(skyFor(Date.UTC(2026, 9, 23, 23, 59)).season).toBe(null);
    expect(skyFor(Date.UTC(2026, 9, 24)).season).toBe('halloween');
    expect(skyFor(Date.UTC(2026, 9, 31, 23, 59)).season).toBe('halloween');
    expect(skyFor(Date.UTC(2026, 10, 1)).season).toBe(null);
    expect(skyFor(Date.UTC(2026, 11, 1)).season).toBe('december');
    expect(skyFor(Date.UTC(2027, 0, 1, 12)).newYear).toBe(true);
    expect(skyFor(Date.UTC(2027, 0, 2)).season).toBe(null);
    expect(skyFor('not a date')).toBe(PLAIN_SKY);
  });

  it('with no season, every frame is exactly what it was before seasons existed', () => {
    for (let s = 0; s < 8; s++) {
      expect(formatValheimFrame(s, { sky: PLAIN_SKY })).toEqual(formatValheimFrame(s));
      expect(formatMinecraftFrame(s, { sky: PLAIN_SKY })).toEqual(formatMinecraftFrame(s));
      expect(formatZomboidFrame(s, { sky: PLAIN_SKY })).toEqual(formatZomboidFrame(s));
    }
  });

  it('Halloween: bats, a moon, and NIGHT for Project Zomboid -- and the frames stay in shape', () => {
    const sky = skyFor(Date.UTC(2026, 9, 28));
    expect(formatValheimFrame(0, { sky })[0]).toContain('^v^');
    expect(formatDragonFrame(0, { sky })[0]).not.toContain('(*)');
    expect(formatZomboidFrame(0, { sky })[0]).toContain('NIGHT 1');
    for (let s = 0; s < 8; s++) {
      for (const format of [formatValheimFrame, formatDragonFrame, formatMinecraftFrame, formatPalworldFrame, formatZomboidFrame]) {
        shape(format(s, { sky }));
      }
    }
  });

  it('December: snow instead of wisps and clouds, on the campfire too', () => {
    const sky = skyFor(Date.UTC(2026, 11, 20));
    expect(formatMinecraftFrame(0, { sky }).join('\n')).not.toContain('~~~~~~');
    expect(formatCampfireFrame(0, { sky })[0]).not.toEqual(formatCampfireFrame(0)[0]);
    for (let s = 0; s < 8; s++) shape(formatCampfireFrame(s, { sky }));
  });
});

describe('fireworks (#287, New Year slot)', () => {
  const ctx = { nowMs: Date.UTC(2027, 0, 1, 10) };
  const frames = Array.from({ length: FIREWORKS_FRAME_COUNT }, (_, s) => formatFireworksFrame(s, ctx));

  it('every frame in shape, none empty, and each differs from the last', () => {
    frames.forEach(shape);
    for (let i = 1; i < frames.length; i++) expect(frames[i]).not.toEqual(frames[i - 1]);
  });

  it('greets the right year, and bursts happen', () => {
    expect(frames[0][5]).toContain('HAPPY NEW YEAR 2027');
    expect(frames.some(f => f.join('\n').includes('. * .'))).toBe(true);
    expect(fireworksFrameKinds()).toHaveLength(BOOT_LINE_COUNT);
  });
});

describe('large deployments (#286)', () => {
  it('10+ instances or 8+ CPU; never merely enterprise', () => {
    expect(isLargeDeployment({ instances: 10 })).toBe(true);
    expect(isLargeDeployment({ instances: 3, cpu: 8 })).toBe(true);
    expect(isLargeDeployment({ instances: 3, cpu: 6, isEnterprise: true })).toBe(false);
    expect(isLargeDeployment({ instances: 2, cpu: 0, isEnterprise: true })).toBe(false);
    expect(isLargeDeployment(null)).toBe(false);
  });

  it('the opening bookend says LARGE DEPLOYMENT at the same width', () => {
    const big = { name: 'bigapp', instances: 100, cpu: 1, ram: 1000, hdd: 10, blockAge: 5 };
    expect(LARGE_ICON_LINE).toHaveLength(DEPLOYED_ICON_LINE.length);
    expect(formatDeploymentFrame(big)[0]).toBe(LARGE_ICON_LINE);
    expect(formatDeploymentFrameWide(big)[0]).toContain(' LARGE DEPLOYMENT ');
    expect(formatDeploymentFrame({ ...big, instances: 2 })[0]).toBe(DEPLOYED_ICON_LINE);
  });
});

describe('attract mode (#288)', () => {
  const feed = keys => keys.reduce((acc, key) => {
    const { buffer, triggered } = pushAttractKey(acc.buffer, key);
    return { buffer, fired: acc.fired + (triggered ? 1 : 0) };
  }, { buffer: [], fired: 0 });

  it('fires on the Konami code and on typing flux, case-insensitively', () => {
    expect(feed(['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'B', 'A']).fired).toBe(1);
    expect(feed(['x', 'F', 'l', 'u', 'x']).fired).toBe(1);
    expect(KONAMI).toHaveLength(10);
  });

  it('does not fire on near misses', () => {
    expect(feed(['f', 'l', 'u', 'z']).fired).toBe(0);
    expect(feed(['f', 'l', 'x', 'u']).fired).toBe(0);
  });

  it('the caption names the art and its place in the run, nothing invented', () => {
    const caption = formatCaptionFrame('Valheim', 3, 20);
    shape(caption);
    expect(caption.join('\n')).toContain('VALHEIM');
    expect(caption.join('\n')).toContain('3 of 20');
    expect(caption.join('\n')).not.toMatch(/running|instances/);
  });
});

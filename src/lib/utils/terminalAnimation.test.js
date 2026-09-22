import { describe, it, expect } from 'vitest';
import {
  pickBootStartBlock,
  computeAnimatedBlock,
  formatStatusLine,
  formatSnapshotLine,
  formatSummaryLine,
  padLines,
  composeRevealFrame,
  composeRevealKinds,
  FLUX_LOGO,
  LOGO_LINES,
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_TEXT,
  ROW_KIND_LOGO,
  ROW_KIND_EXPIRING,
  ROW_KIND_DEPLOYED,
  pickLatestDeployed,
  pickLatestExpiring,
  truncateForBox,
  formatDeploymentFrame,
  formatExpiringFrame,
  formatDeploymentReducedMotionLines,
  formatExpiringReducedMotionLines,
  deploymentFrameKinds,
  expiringFrameKinds,
  DEPLOYED_ICON_LINE,
  EXPIRING_ICON_LINE,
  formatGamepadFrame,
  gamepadFrameKinds,
  GAMEPAD_FRAME_COUNT,
  formatValheimFrame,
  valheimFrameKinds,
  VALHEIM_FRAME_COUNT,
  formatDragonFrame,
  dragonFrameKinds,
  DRAGON_FRAME_COUNT,
  formatMinecraftFrame,
  formatPalworldFrame,
  palworldFrameKinds,
  minecraftFrameKinds,
  MINECRAFT_FRAME_COUNT,
  PALWORLD_FRAME_COUNT,
  rotateStrip
} from './terminalAnimation.js';

describe('FLUX_LOGO', () => {
  it('is a non-empty multi-line string with no TRACKER text', () => {
    expect(FLUX_LOGO.length).toBeGreaterThan(0);
    expect(FLUX_LOGO.toUpperCase()).not.toContain('TRACKER');
    expect(FLUX_LOGO.split('\n').length).toBeGreaterThanOrEqual(4);
  });
});

describe('pickBootStartBlock', () => {
  it('picks a start block `range` below the target', () => {
    expect(pickBootStartBlock(294912, 1100)).toBe(293812);
  });

  it('never goes below zero', () => {
    expect(pickBootStartBlock(500, 1100)).toBe(0);
  });

  it('returns null for a non-numeric target', () => {
    expect(pickBootStartBlock(null)).toBeNull();
    expect(pickBootStartBlock(undefined)).toBeNull();
  });
});

describe('computeAnimatedBlock', () => {
  it('returns exactly startBlock at progress 0', () => {
    expect(computeAnimatedBlock(100, 200, 0)).toBe(100);
  });

  it('returns exactly targetBlock at progress 1', () => {
    expect(computeAnimatedBlock(100, 200, 1)).toBe(200);
  });

  it('never overshoots the target before progress reaches 1', () => {
    for (let p = 0; p < 1; p += 0.05) {
      expect(computeAnimatedBlock(100, 200, p)).toBeLessThan(200);
    }
  });

  it('is monotonically non-decreasing as progress increases', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 1; p += 0.05) {
      const value = computeAnimatedBlock(1000, 5000, p);
      expect(value).toBeGreaterThanOrEqual(prev);
      prev = value;
    }
  });

  it('clamps progress outside [0, 1]', () => {
    expect(computeAnimatedBlock(100, 200, -0.5)).toBe(100);
    expect(computeAnimatedBlock(100, 200, 1.5)).toBe(200);
  });

  it('returns target immediately when target <= start', () => {
    expect(computeAnimatedBlock(500, 500, 0.5)).toBe(500);
    expect(computeAnimatedBlock(500, 400, 0.5)).toBe(400);
  });
});

describe('formatStatusLine', () => {
  it('reports OK for a healthy api and database', () => {
    expect(formatStatusLine('online', 'online')).toBe('> api OK | database OK');
  });

  it('reports ERROR for the api when it is not online', () => {
    expect(formatStatusLine('offline', 'online')).toBe('> api ERROR | database OK');
    expect(formatStatusLine('checking', 'online')).toBe('> api ERROR | database OK');
  });

  it('reports OFFLINE for the database when it is not online', () => {
    expect(formatStatusLine('online', 'offline')).toBe('> api OK | database OFFLINE');
  });
});

describe('formatSnapshotLine', () => {
  it('shows the live snapshot total with thousands separators', () => {
    expect(formatSnapshotLine(819)).toBe('daily snapshots... 819 loaded');
    expect(formatSnapshotLine(12345)).toBe('daily snapshots... 12,345 loaded');
  });

  it('shows zero without falling back to "..."', () => {
    expect(formatSnapshotLine(0)).toBe('daily snapshots... 0 loaded');
  });

  it('falls back to "..." for a missing count', () => {
    expect(formatSnapshotLine(null)).toBe('daily snapshots... ... loaded');
    expect(formatSnapshotLine(undefined)).toBe('daily snapshots... ... loaded');
  });
});

describe('formatSummaryLine', () => {
  it('condenses version, codename and network stats into one boot row', () => {
    expect(formatSummaryLine('v1.03', 'jolly wombat', 12481, 3842)).toBe(
      'version v1.03 jolly wombat | 12,481 nodes | 3,842 apps'
    );
  });

  it('omits the codename when absent', () => {
    expect(formatSummaryLine('v1.03', '', 1000, 100)).toBe('version v1.03 | 1,000 nodes | 100 apps');
  });

  it('falls back to "..." for missing values', () => {
    expect(formatSummaryLine(null, '', null, undefined)).toBe('version ... | ... nodes | ... apps');
  });
});

describe('LOGO_LINES / LOGO_WIDTH / BOOT_LINE_COUNT', () => {
  it('LOGO_LINES matches the number of lines in FLUX_LOGO', () => {
    expect(LOGO_LINES).toEqual(FLUX_LOGO.split('\n'));
  });

  it('LOGO_WIDTH is the length of the longest logo line', () => {
    expect(LOGO_WIDTH).toBe(Math.max(...LOGO_LINES.map(l => l.length)));
  });

  it('BOOT_LINE_COUNT is the logo row count — the fixed box every frame fills', () => {
    expect(BOOT_LINE_COUNT).toBe(LOGO_LINES.length);
  });
});

describe('padLines', () => {
  it('returns the input unchanged when it already has enough lines', () => {
    expect(padLines(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('truncates when there are too many lines', () => {
    expect(padLines(['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b']);
  });

  it('pads with filler lines, cycling through them, when there are too few', () => {
    expect(padLines(['a'], 4, ['x', 'y'])).toEqual(['a', 'x', 'y', 'x']);
  });

  it('pads with blank lines when no filler is given', () => {
    expect(padLines(['a'], 3)).toEqual(['a', '', '']);
  });
});

describe('composeRevealFrame', () => {
  const base = ['B0', 'B1', 'B2', 'B3'];
  const incoming = ['I0', 'I1', 'I2', 'I3'];

  it('reveals no rows at revealedCount 0', () => {
    expect(composeRevealFrame(base, incoming, 0, 'top-down')).toEqual(base);
  });

  it('reveals all rows at revealedCount === length', () => {
    expect(composeRevealFrame(base, incoming, 4, 'top-down')).toEqual(incoming);
  });

  it('reveals from the top down', () => {
    expect(composeRevealFrame(base, incoming, 2, 'top-down')).toEqual(['I0', 'I1', 'B2', 'B3']);
  });

  it('reveals from the bottom up', () => {
    expect(composeRevealFrame(base, incoming, 2, 'bottom-up')).toEqual(['B0', 'B1', 'I2', 'I3']);
  });

  it('clamps an out-of-range revealedCount', () => {
    expect(composeRevealFrame(base, incoming, -3, 'top-down')).toEqual(base);
    expect(composeRevealFrame(base, incoming, 99, 'top-down')).toEqual(incoming);
  });
});

describe('composeRevealKinds', () => {
  const baseKinds = ['text', 'text', 'text', 'text'];
  const incomingKinds = ['logo', 'logo', 'logo', 'logo'];

  it('shows only base kinds at revealedCount 0', () => {
    expect(composeRevealKinds(baseKinds, incomingKinds, 0, 'top-down')).toEqual(baseKinds);
  });

  it('shows only incoming kinds at revealedCount === length', () => {
    expect(composeRevealKinds(baseKinds, incomingKinds, 4, 'top-down')).toEqual(incomingKinds);
  });

  it('reveals incoming kinds from the top down', () => {
    expect(composeRevealKinds(baseKinds, incomingKinds, 2, 'top-down')).toEqual(['logo', 'logo', 'text', 'text']);
  });

  it('reveals incoming kinds from the bottom up', () => {
    expect(composeRevealKinds(baseKinds, incomingKinds, 2, 'bottom-up')).toEqual(['text', 'text', 'logo', 'logo']);
  });

  it('clamps an out-of-range revealedCount', () => {
    expect(composeRevealKinds(baseKinds, incomingKinds, -3, 'top-down')).toEqual(baseKinds);
    expect(composeRevealKinds(baseKinds, incomingKinds, 99, 'top-down')).toEqual(incomingKinds);
  });

  it('stays row-for-row aligned with composeRevealFrame for every progress step', () => {
    const baseLines = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5'];
    const incomingLines = ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'];
    const baseKinds = Array(6).fill('text');
    const incomingKinds = Array(6).fill('logo');
    for (let count = 0; count <= 6; count++) {
      for (const direction of ['top-down', 'bottom-up']) {
        const lines = composeRevealFrame(baseLines, incomingLines, count, direction);
        const kinds = composeRevealKinds(baseKinds, incomingKinds, count, direction);
        expect(kinds).toHaveLength(lines.length);
        lines.forEach((line, row) => {
          const fromIncoming = line.startsWith('I');
          expect(kinds[row] === 'logo').toBe(fromIncoming);
        });
      }
    }
  });
});

// ============================================
// IDLE ROTATION: LATEST EXPIRING / LATEST DEPLOYED (issue #104 Phase 2)
// ============================================

describe('pickLatestDeployed', () => {
  const apps = [
    { name: 'Alpha', blockAge: 500 },
    { name: 'Beta', blockAge: 50 },
    { name: 'Gamma', blockAge: 1200 }
  ];

  it('picks the entry with the lowest blockAge (most recently deployed)', () => {
    expect(pickLatestDeployed(apps)).toBe(apps[1]);
  });

  it('returns null for an empty or missing list', () => {
    expect(pickLatestDeployed([])).toBeNull();
    expect(pickLatestDeployed(null)).toBeNull();
    expect(pickLatestDeployed(undefined)).toBeNull();
  });

  it('treats a missing blockAge as infinitely old, not a crash', () => {
    const withMissing = [{ name: 'NoAge' }, { name: 'HasAge', blockAge: 10 }];
    expect(pickLatestDeployed(withMissing)).toBe(withMissing[1]);
  });
});

describe('pickLatestExpiring', () => {
  it('picks the first entry (the endpoint already sorts most-urgent-first)', () => {
    const apps = [{ name: 'Soonest', blocksUntilExpiry: 10 }, { name: 'Later', blocksUntilExpiry: 500 }];
    expect(pickLatestExpiring(apps)).toBe(apps[0]);
  });

  it('returns null for an empty or missing list', () => {
    expect(pickLatestExpiring([])).toBeNull();
    expect(pickLatestExpiring(null)).toBeNull();
    expect(pickLatestExpiring(undefined)).toBeNull();
  });
});

describe('truncateForBox', () => {
  it('returns short text unchanged', () => {
    expect(truncateForBox('Minecraft')).toBe('Minecraft');
  });

  it('truncates long text with an ellipsis at exactly maxWidth', () => {
    const result = truncateForBox('a-very-long-application-name-that-overflows', 20);
    expect(result.length).toBe(20);
    expect(result.endsWith('...')).toBe(true);
  });

  it('handles non-string input without throwing', () => {
    expect(truncateForBox(undefined)).toBe('');
    expect(truncateForBox(null)).toBe('');
  });
});

describe('DEPLOYED_ICON_LINE / EXPIRING_ICON_LINE', () => {
  it('are exactly LOGO_WIDTH wide -- built as literal arrow-banner strings, not padded/centered', () => {
    for (const icon of [DEPLOYED_ICON_LINE, EXPIRING_ICON_LINE]) {
      expect(icon.length).toBe(LOGO_WIDTH);
    }
  });

  it('are distinct from each other', () => {
    expect(DEPLOYED_ICON_LINE).not.toBe(EXPIRING_ICON_LINE);
  });

  it('use directional arrows -- converging for deployed (arriving), diverging for expiring (departing)', () => {
    expect(DEPLOYED_ICON_LINE.startsWith('>')).toBe(true);
    expect(DEPLOYED_ICON_LINE.endsWith('<')).toBe(true);
    expect(EXPIRING_ICON_LINE.startsWith('<')).toBe(true);
    expect(EXPIRING_ICON_LINE.endsWith('>')).toBe(true);
  });
});

describe('formatDeploymentFrame', () => {
  const full = { name: 'Minecraft', repo: '2ndtl/mc:latest', instances: 3, cpu: 2, ram: 4096, hdd: 25, blockAge: 10 };

  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentFrame(full).length).toBe(BOOT_LINE_COUNT);
  });

  it('bookends the frame with the same icon row top and bottom, matching the box width', () => {
    const frame = formatDeploymentFrame(full);
    expect(frame[0]).toBe(frame[frame.length - 1]);
    expect(frame[0].length).toBe(LOGO_WIDTH);
    expect(frame[0].trim()).toBe(DEPLOYED_ICON_LINE.trim());
  });

  it('never shows the word Docker anywhere in the frame (issue #127)', () => {
    const text = formatDeploymentFrame(full).join('\n');
    expect(text.toUpperCase()).not.toContain('DOCKER');
  });

  it('includes name, time-since-deployment, instance count and resources when all present', () => {
    const text = formatDeploymentFrame(full).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('AGO');
    expect(text).toContain('5m ago'); // 10 blocks * 30s = 300s = 5m
    expect(text).toContain('3');
    expect(text).toContain('CPU');
    expect(text).toContain('RAM');
    expect(text).toContain('SSD');
  });

  it('does not show a REPO row -- dropped in favor of AGO (issue #127, only 4 middle slots)', () => {
    const text = formatDeploymentFrame(full).join('\n');
    expect(text).not.toContain('REPO');
  });

  it('omits the AGO row (not a blank row) when blockAge is missing, without leaving a gap between real rows', () => {
    const frame = formatDeploymentFrame({ ...full, blockAge: undefined });
    const middle = frame.slice(1, -1); // strip the two icon rows
    expect(middle.join('\n')).not.toContain('AGO');

    // Any blank filler rows are trailing only -- once a blank row appears, every
    // row after it is blank too, so real content is never followed by a gap.
    const blankStartsAt = middle.findIndex(line => line.trim() === '');
    if (blankStartsAt !== -1) {
      for (const line of middle.slice(blankStartsAt)) {
        expect(line.trim()).toBe('');
      }
    }
  });

  it('omits the instances row when instances is not a real number', () => {
    const text = formatDeploymentFrame({ ...full, instances: undefined }).join('\n');
    expect(text).not.toMatch(/INST\s+undefined/);
    expect(text).not.toContain('NaN');
  });

  it('omits the resources row entirely when no resource field is present', () => {
    const text = formatDeploymentFrame({ ...full, cpu: 0, ram: 0, hdd: 0 }).join('\n');
    expect(text).not.toContain('RES');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('truncates a long name instead of overflowing the box', () => {
    const longName = 'a'.repeat(200);
    const frame = formatDeploymentFrame({ ...full, name: longName });
    for (const line of frame) {
      expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH);
    }
  });

  it('formats RAM in GB once it crosses 1000MB, and SSD in TB once it crosses 1000GB', () => {
    const text = formatDeploymentFrame({ ...full, ram: 4096, hdd: 1500 }).join('\n');
    expect(text).toContain('4.1G');
    expect(text).toContain('1.5T');
  });
});

describe('formatExpiringFrame', () => {
  const full = { name: 'Minecraft', instances: 3, cpu: 2, ram: 4096, hdd: 25, blocksUntilExpiry: 240 };

  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatExpiringFrame(full).length).toBe(BOOT_LINE_COUNT);
  });

  it('bookends the frame with the diverging-arrows icon top and bottom, matching the box width', () => {
    const frame = formatExpiringFrame(full);
    expect(frame[0]).toBe(frame[frame.length - 1]);
    expect(frame[0].length).toBe(LOGO_WIDTH);
    expect(frame[0].trim()).toBe(EXPIRING_ICON_LINE.trim());
  });

  it('includes name, time-to-expiry, instance count and resources when all present', () => {
    const text = formatExpiringFrame(full).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('EXPIRE');
    expect(text).toContain('2h'); // 240 blocks * 30s = 7200s = 2h
    expect(text).toContain('3');
    expect(text).toContain('CPU');
    expect(text).toContain('RAM');
    expect(text).toContain('SSD');
  });

  it('omits the EXPIRE row (not a blank row) when blocksUntilExpiry is missing', () => {
    const frame = formatExpiringFrame({ ...full, blocksUntilExpiry: undefined });
    const middle = frame.slice(1, -1);
    expect(middle.join('\n')).not.toContain('EXPIRE');
  });

  it('omits the instances row when instances is not a real number', () => {
    const text = formatExpiringFrame({ ...full, instances: undefined }).join('\n');
    expect(text).not.toMatch(/INST\s+undefined/);
    expect(text).not.toContain('NaN');
  });

  it('omits the resources row entirely when no resource field is present', () => {
    const text = formatExpiringFrame({ ...full, cpu: 0, ram: 0, hdd: 0 }).join('\n');
    expect(text).not.toContain('RES');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('truncates a long name instead of overflowing the box', () => {
    const longName = 'a'.repeat(200);
    const frame = formatExpiringFrame({ ...full, name: longName });
    for (const line of frame) {
      expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH);
    }
  });
});

describe('deploymentFrameKinds', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(deploymentFrameKinds().length).toBe(BOOT_LINE_COUNT);
  });

  it('marks only the first and last rows as ROW_KIND_DEPLOYED, matching formatDeploymentFrame\'s icon bookends', () => {
    const kinds = deploymentFrameKinds();
    expect(kinds[0]).toBe(ROW_KIND_DEPLOYED);
    expect(kinds[kinds.length - 1]).toBe(ROW_KIND_DEPLOYED);
    expect(kinds.slice(1, -1)).toEqual(Array(BOOT_LINE_COUNT - 2).fill(ROW_KIND_TEXT));
  });
});

describe('expiringFrameKinds', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(expiringFrameKinds().length).toBe(BOOT_LINE_COUNT);
  });

  it('marks only the first and last rows as ROW_KIND_EXPIRING, matching formatExpiringFrame\'s icon bookends', () => {
    const kinds = expiringFrameKinds();
    expect(kinds[0]).toBe(ROW_KIND_EXPIRING);
    expect(kinds[kinds.length - 1]).toBe(ROW_KIND_EXPIRING);
    expect(kinds.slice(1, -1)).toEqual(Array(BOOT_LINE_COUNT - 2).fill(ROW_KIND_TEXT));
  });
});

describe('formatDeploymentReducedMotionLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).length).toBe(BOOT_LINE_COUNT);
  });

  it('carries the name and instance count', () => {
    const text = formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('3');
    expect(text).toContain('LATEST DEPLOYMENT');
  });

  it('carries a human time-since-deployment when blockAge is present (issue #127)', () => {
    const text = formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3, blockAge: 10 }).join('\n');
    expect(text).toContain('5m ago'); // 10 blocks * 30s = 300s = 5m
  });

  it('omits the time-since-deployment line (not a blank/undefined one) when blockAge is missing', () => {
    const text = formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).join('\n');
    expect(text).not.toContain('ago');
    expect(text).not.toContain('undefined');
  });

  it('has no icon or repo/resource content -- reduced motion carries only the essentials', () => {
    const text = formatDeploymentReducedMotionLines({ name: 'Minecraft', instances: 3 }).join('\n');
    expect(text).not.toContain('REPO');
    expect(text).not.toContain('RES');
  });
});

describe('formatExpiringReducedMotionLines', () => {
  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatExpiringReducedMotionLines({ name: 'Minecraft', blocksUntilExpiry: 240 }).length).toBe(BOOT_LINE_COUNT);
  });

  it('carries the name and a human time-to-expiry', () => {
    const text = formatExpiringReducedMotionLines({ name: 'Minecraft', blocksUntilExpiry: 240 }).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('2h');
    expect(text).toContain('EXPIRING SOON');
  });
});

describe('formatGamepadFrame (issue #177)', () => {
  it('renders BOOT_LINE_COUNT rows, like every other frame in the box', () => {
    for (let step = 0; step < GAMEPAD_FRAME_COUNT; step++) {
      expect(formatGamepadFrame(step)).toHaveLength(BOOT_LINE_COUNT);
    }
  });

  // The box width and height are load-bearing (CLAUDE.md: never let them depend on
  // content). Pressed and at-rest controls are both exactly 3 columns and are spliced in by
  // column, so a drift here means someone broke that invariant.
  it('every row of every frame is exactly the same width', () => {
    const widths = new Set();
    for (let step = 0; step < GAMEPAD_FRAME_COUNT; step++) {
      for (const row of formatGamepadFrame(step)) widths.add(row.length);
    }
    expect([...widths]).toHaveLength(1);
  });

  it('never exceeds the box', () => {
    for (let step = 0; step < GAMEPAD_FRAME_COUNT; step++) {
      for (const row of formatGamepadFrame(step)) {
        expect(row.length).toBeLessThanOrEqual(LOGO_WIDTH);
      }
    }
  });

  it('never emits an empty row -- the harness rejects those outright', () => {
    for (let step = 0; step < GAMEPAD_FRAME_COUNT; step++) {
      for (const row of formatGamepadFrame(step)) {
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('actually animates: at least one control changes between consecutive frames', () => {
    for (let step = 0; step < GAMEPAD_FRAME_COUNT - 1; step++) {
      expect(formatGamepadFrame(step).join('\n')).not.toBe(formatGamepadFrame(step + 1).join('\n'));
    }
  });

  it('shows pressed states only where the sequence says', () => {
    const atRest = formatGamepadFrame(0).join('\n');
    expect(atRest).not.toContain('{');   // frame 0 is idle
    expect(atRest).not.toContain('(*)');

    const jumping = formatGamepadFrame(2).join('\n'); // ['DR','BA']
    expect(jumping).toContain('{>}');
    expect(jumping).toContain('(*)');
  });

  it('wraps, so a caller can count up forever', () => {
    expect(formatGamepadFrame(GAMEPAD_FRAME_COUNT)).toEqual(formatGamepadFrame(0));
    expect(formatGamepadFrame(GAMEPAD_FRAME_COUNT * 3 + 2)).toEqual(formatGamepadFrame(2));
  });

  it('accents the whole controller, since here the art IS the event marker', () => {
    const kinds = gamepadFrameKinds();
    expect(kinds).toHaveLength(BOOT_LINE_COUNT);
    expect(new Set(kinds)).toEqual(new Set([ROW_KIND_DEPLOYED]));
  });
});

describe('rotateStrip (issue #180)', () => {
  // The whole reason the water can animate at all without risking the box: rotation cannot
  // change a string's length, whatever offset it is handed.
  it('never changes the length, for any offset including negative and out-of-range', () => {
    const strip = '~~^~~-~~';
    for (const by of [-99, -8, -1, 0, 1, 7, 8, 9, 1000]) {
      expect(rotateStrip(strip, by).length).toBe(strip.length);
    }
  });

  it('rotates left and wraps', () => {
    expect(rotateStrip('abcdef', 2)).toBe('cdefab');
    expect(rotateStrip('abcdef', -1)).toBe('fabcde');
    expect(rotateStrip('abcdef', 6)).toBe('abcdef');
  });

  it('is safe on an empty strip', () => {
    expect(rotateStrip('', 3)).toBe('');
  });
});

describe('formatValheimFrame (issue #180)', () => {
  it('renders BOOT_LINE_COUNT rows, like every other frame in the box', () => {
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      expect(formatValheimFrame(step)).toHaveLength(BOOT_LINE_COUNT);
    }
  });

  // Box width and height are load-bearing (CLAUDE.md: never let them depend on content).
  // The ship is overlaid onto a fixed-width canvas and the water is rotated in place, so a
  // drift here means someone broke that invariant.
  it('every row of every frame is exactly LOGO_WIDTH', () => {
    const widths = new Set();
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      for (const row of formatValheimFrame(step)) widths.add(row.length);
    }
    expect([...widths]).toEqual([LOGO_WIDTH]);
  });

  it('never emits an empty row -- the harness rejects those outright', () => {
    // The gulls exist for this: when the hull bobs down it vacates the top row.
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      for (const row of formatValheimFrame(step)) {
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('actually animates: consecutive frames differ', () => {
    for (let step = 0; step < VALHEIM_FRAME_COUNT - 1; step++) {
      expect(formatValheimFrame(step)).not.toEqual(formatValheimFrame(step + 1));
    }
  });

  it('the water moves on every step, not just when the hull bobs', () => {
    for (let step = 0; step < VALHEIM_FRAME_COUNT - 1; step++) {
      const near = formatValheimFrame(step)[BOOT_LINE_COUNT - 1];
      const nextNear = formatValheimFrame(step + 1)[BOOT_LINE_COUNT - 1];
      const far = formatValheimFrame(step)[BOOT_LINE_COUNT - 2];
      const nextFar = formatValheimFrame(step + 1)[BOOT_LINE_COUNT - 2];
      expect(near !== nextNear || far !== nextFar).toBe(true);
    }
  });

  it('the two water rows are never in lockstep -- that is what reads as parallax', () => {
    const shifts = new Set();
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      const [far, near] = formatValheimFrame(step).slice(-2);
      shifts.add(far === near);
    }
    expect(shifts.has(true)).toBe(false);
  });

  it('keeps the ship intact: the hull appears in every frame', () => {
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      expect(formatValheimFrame(step).some(r => r.includes('__o__o__o__o__'))).toBe(true);
    }
  });

  it('bobs the hull between two rows and no further', () => {
    const hullRows = new Set();
    for (let step = 0; step < VALHEIM_FRAME_COUNT; step++) {
      const rows = formatValheimFrame(step);
      hullRows.add(rows.findIndex(r => r.includes('__o__o__o__o__')));
    }
    expect([...hullRows].sort()).toEqual([3, 4]);
  });

  it('wraps on step, so callers can just count up forever', () => {
    expect(formatValheimFrame(VALHEIM_FRAME_COUNT)).toEqual(formatValheimFrame(0));
    expect(formatValheimFrame(VALHEIM_FRAME_COUNT * 3 + 2)).toEqual(formatValheimFrame(2));
    expect(formatValheimFrame(-1)).toEqual(formatValheimFrame(VALHEIM_FRAME_COUNT - 1));
  });

  it('carries the deployment accent on every row, like the gamepad', () => {
    const kinds = valheimFrameKinds();
    expect(kinds).toHaveLength(BOOT_LINE_COUNT);
    expect(new Set(kinds)).toEqual(new Set([ROW_KIND_DEPLOYED]));
  });
});

// ---------------------------------------------------------------------------------------
// Issue #199 — per-game intros for Minecraft and RuneScape: Dragonwilds.
//
// The box invariants are the point of this suite, not the art. Every one of these assertions
// caught a real break in the gamepad or the longship at some stage, so each new formatter
// runs the identical battery rather than a reduced version of it.
// ---------------------------------------------------------------------------------------

describe.each([
  ['formatDragonFrame', formatDragonFrame, dragonFrameKinds, DRAGON_FRAME_COUNT],
  ['formatMinecraftFrame', formatMinecraftFrame, minecraftFrameKinds, MINECRAFT_FRAME_COUNT],
  ['formatPalworldFrame', formatPalworldFrame, palworldFrameKinds, PALWORLD_FRAME_COUNT]
])('%s (issue #199)', (_name, format, kinds, frameCount) => {
  it('runs the same number of frames as the longship, so every intro is the same length', () => {
    // Shared INTRO_STEP_MS: a different frame count would make one game's intro visibly
    // longer than another's for no reason the viewer can see.
    expect(frameCount).toBe(VALHEIM_FRAME_COUNT);
  });

  it('renders BOOT_LINE_COUNT rows, like every other frame in the box', () => {
    for (let step = 0; step < frameCount; step++) {
      expect(format(step)).toHaveLength(BOOT_LINE_COUNT);
    }
  });

  it('every row of every frame is exactly LOGO_WIDTH', () => {
    // Box width is load-bearing (CLAUDE.md: never let it depend on content). Art is
    // overlaid onto a fixed-width canvas by column, never concatenated.
    const widths = new Set();
    for (let step = 0; step < frameCount; step++) {
      for (const row of format(step)) widths.add(row.length);
    }
    expect([...widths]).toEqual([LOGO_WIDTH]);
  });

  it('never emits an empty row -- the harness rejects those outright', () => {
    // This is what the sky furniture is for: whatever vacates a row (a build that has not
    // grown into it yet, a dragon that has bobbed away from it) needs something behind it.
    for (let step = 0; step < frameCount; step++) {
      format(step).forEach((row, i) => {
        expect(row.trim().length, `step ${step} row ${i} was empty`).toBeGreaterThan(0);
      });
    }
  });

  it('actually animates: consecutive frames differ', () => {
    for (let step = 0; step < frameCount - 1; step++) {
      expect(format(step)).not.toEqual(format(step + 1));
    }
  });

  it('wraps on step, so callers can just count up forever', () => {
    expect(format(frameCount)).toEqual(format(0));
    expect(format(frameCount * 3 + 2)).toEqual(format(2));
    expect(format(-1)).toEqual(format(frameCount - 1));
    expect(format(-frameCount)).toEqual(format(0));
  });

  it('contains no literal backslash escaping mistakes', () => {
    // Backslashes come from String.fromCharCode(92), never written literally -- this broke
    // the gamepad art twice. A stray escape shows up as a lone forward slash count mismatch
    // or a dropped character, both of which change the row width; this asserts the rows are
    // still clean ASCII in the printable range.
    for (let step = 0; step < frameCount; step++) {
      for (const row of format(step)) {
        expect(row).toMatch(/^[ -~]*$/);
      }
    }
  });

  it('carries the deployment accent on every row, like the gamepad', () => {
    const rowKinds = kinds();
    expect(rowKinds).toHaveLength(BOOT_LINE_COUNT);
    expect(new Set(rowKinds)).toEqual(new Set([ROW_KIND_DEPLOYED]));
  });
});

describe('formatDragonFrame specifics (issue #199)', () => {
  it('keeps the dragon intact: the body appears in every frame', () => {
    for (let step = 0; step < DRAGON_FRAME_COUNT; step++) {
      expect(format_hasBody(formatDragonFrame(step))).toBe(true);
    }
  });

  it('flaps: the wing rows are not the same in every frame', () => {
    const wingShapes = new Set();
    for (let step = 0; step < DRAGON_FRAME_COUNT; step++) {
      wingShapes.add(formatDragonFrame(step).join('|'));
    }
    expect(wingShapes.size).toBeGreaterThan(1);
  });

  it('the cloud rows move on every step, not just when the dragon bobs', () => {
    // The longship's parallax, reused: clouds for water.
    for (let step = 0; step < DRAGON_FRAME_COUNT - 1; step++) {
      const near = formatDragonFrame(step)[BOOT_LINE_COUNT - 1];
      const nextNear = formatDragonFrame(step + 1)[BOOT_LINE_COUNT - 1];
      const far = formatDragonFrame(step)[BOOT_LINE_COUNT - 2];
      const nextFar = formatDragonFrame(step + 1)[BOOT_LINE_COUNT - 2];
      expect(near !== nextNear || far !== nextFar).toBe(true);
    }
  });

  it('the two cloud rows are never in lockstep -- that is what reads as parallax', () => {
    for (let step = 0; step < DRAGON_FRAME_COUNT; step++) {
      const [far, near] = formatDragonFrame(step).slice(-2);
      expect(far).not.toBe(near);
    }
  });
});

function format_hasBody(rows) {
  return rows.some(r => r.includes('o'));
}

describe('formatMinecraftFrame specifics (issue #199)', () => {
  it('keeps the ground intact across the whole build', () => {
    for (let step = 0; step < MINECRAFT_FRAME_COUNT; step++) {
      const ground = formatMinecraftFrame(step)[BOOT_LINE_COUNT - 1];
      expect(ground).toBe('#'.repeat(LOGO_WIDTH));
    }
  });

  it('builds up rather than down: block count never decreases within the sequence', () => {
    // The motion IS the meaning here -- a deployment is a server being built. A step that
    // removed blocks would read as the opposite event.
    let previous = -1;
    for (let step = 0; step < MINECRAFT_FRAME_COUNT; step++) {
      const blocks = formatMinecraftFrame(step).join('').split('[#]').length - 1;
      expect(blocks).toBeGreaterThanOrEqual(previous);
      previous = blocks;
    }
  });

  it('finishes with more blocks than it started with', () => {
    const first = formatMinecraftFrame(0).join('').split('[#]').length - 1;
    const last = formatMinecraftFrame(MINECRAFT_FRAME_COUNT - 1).join('').split('[#]').length - 1;
    expect(last).toBeGreaterThan(first);
  });

  it('lights the torch only once the structure is up', () => {
    const torchSteps = [];
    for (let step = 0; step < MINECRAFT_FRAME_COUNT; step++) {
      if (formatMinecraftFrame(step).some(r => r.includes('i'))) torchSteps.push(step);
    }
    expect(torchSteps.length).toBeGreaterThan(0);
    expect(Math.min(...torchSteps)).toBeGreaterThan(MINECRAFT_FRAME_COUNT / 2);
  });
});

describe('formatPalworldFrame specifics', () => {
  // Second by live instances and the last of the top four with no art of its own, so every
  // Palworld deployment used to play the shared controller. The shared battery above covers
  // the box invariants; these cover the art reading as what it is meant to be.

  it('keeps the Pal intact: its face appears in every frame', () => {
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      expect(formatPalworldFrame(step).some(row => row.includes('(o.o)'))).toBe(true);
    }
  });

  it('bobs the Pal between two rows and no further', () => {
    const faceRows = new Set();
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      faceRows.add(formatPalworldFrame(step).findIndex(row => row.includes('(o.o)')));
    }
    expect([...faceRows].sort()).toEqual([2, 3]);
  });

  it('throws the sphere: it appears in every frame and moves every step', () => {
    const columns = [];
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      const rows = formatPalworldFrame(step);
      const row = rows.find(r => r.includes('(o)'));
      expect(row, `no sphere at step ${step}`).toBeTruthy();
      columns.push(row.indexOf('(o)'));
    }
    for (let i = 0; i < columns.length - 1; i++) {
      expect(columns[i + 1], 'the sphere should keep travelling').toBeGreaterThan(columns[i]);
    }
  });

  it('arcs the sphere rather than sliding it along one row', () => {
    const rows = new Set();
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      rows.add(formatPalworldFrame(step).findIndex(r => r.includes('(o)')));
    }
    expect(rows.size).toBeGreaterThan(1);
  });

  it('never lets the sphere land ON the Pal', () => {
    // Sharing a ROW is fine and happens -- the sphere passes beside the Pal at a different
    // column, which is the throw. What would read as a rendering fault is the sphere
    // overlapping the Pal's own columns, so that is what this asserts.
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      for (const row of formatPalworldFrame(step)) {
        const sphere = row.indexOf('(o)');
        if (sphere === -1) continue;

        const pal = ['(o.o)', '(")_(")'].map(art => row.indexOf(art)).find(i => i !== -1);
        if (pal === undefined) continue;

        const sphereEnd = sphere + '(o)'.length - 1;
        expect(sphereEnd, `step ${step}: the sphere overlapped the Pal`).toBeLessThan(pal);
      }
    }
  });

  it('the grass moves on every step, not just when the Pal bobs', () => {
    for (let step = 0; step < PALWORLD_FRAME_COUNT - 1; step++) {
      const [far, near] = formatPalworldFrame(step).slice(-2);
      const [nextFar, nextNear] = formatPalworldFrame(step + 1).slice(-2);
      expect(far !== nextFar || near !== nextNear).toBe(true);
    }
  });

  it('the two grass rows are never in lockstep -- that is what reads as parallax', () => {
    for (let step = 0; step < PALWORLD_FRAME_COUNT; step++) {
      const [far, near] = formatPalworldFrame(step).slice(-2);
      expect(far).not.toEqual(near);
    }
  });
});

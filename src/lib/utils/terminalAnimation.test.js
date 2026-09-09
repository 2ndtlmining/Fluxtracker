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
  pickLatestDeployed,
  pickLatestExpiring,
  isGitDeployment,
  truncateForBox,
  formatDeploymentFrame,
  formatExpiringFrame,
  formatDeploymentReducedMotionLines,
  formatExpiringReducedMotionLines,
  DOCKER_ICON_LINE,
  GIT_ICON_LINE,
  EXPIRING_ICON_LINE
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

describe('isGitDeployment', () => {
  it('is true for a runonflux/orbit repotag, case-insensitively', () => {
    expect(isGitDeployment('runonflux/orbit:latest')).toBe(true);
    expect(isGitDeployment('RunOnFlux/Orbit:v2')).toBe(true);
  });

  it('is false for a regular docker repotag', () => {
    expect(isGitDeployment('itzg/minecraft-server:latest')).toBe(false);
  });

  it('is false for empty/missing repo rather than throwing', () => {
    expect(isGitDeployment('')).toBe(false);
    expect(isGitDeployment(undefined)).toBe(false);
    expect(isGitDeployment(null)).toBe(false);
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

describe('DOCKER_ICON_LINE / GIT_ICON_LINE / EXPIRING_ICON_LINE', () => {
  it('are all non-empty and no wider than the box', () => {
    for (const icon of [DOCKER_ICON_LINE, GIT_ICON_LINE, EXPIRING_ICON_LINE]) {
      expect(icon.length).toBeGreaterThan(0);
      expect(icon.length).toBeLessThanOrEqual(LOGO_WIDTH);
    }
  });

  it('are all distinct from each other', () => {
    const icons = [DOCKER_ICON_LINE, GIT_ICON_LINE, EXPIRING_ICON_LINE];
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('formatDeploymentFrame', () => {
  const full = { name: 'Minecraft', repo: '2ndtl/mc:latest', instances: 3, cpu: 2, ram: 4096, hdd: 25, height: 1500000 };

  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatDeploymentFrame(full).length).toBe(BOOT_LINE_COUNT);
  });

  it('bookends the frame with the same icon row top and bottom, matching the box width', () => {
    const frame = formatDeploymentFrame(full);
    expect(frame[0]).toBe(frame[frame.length - 1]);
    expect(frame[0].length).toBe(LOGO_WIDTH);
    expect(frame[0].trim()).toBe(DOCKER_ICON_LINE.trim());
  });

  it('shows the octocat icon for a runonflux/orbit repo', () => {
    const frame = formatDeploymentFrame({ ...full, repo: 'runonflux/orbit:latest' });
    expect(frame[0].trim()).toBe(GIT_ICON_LINE.trim());
  });

  it('includes name, repo, instance count and resources when all present', () => {
    const text = formatDeploymentFrame(full).join('\n');
    expect(text).toContain('Minecraft');
    expect(text).toContain('2ndtl/mc:latest');
    expect(text).toContain('3');
    expect(text).toContain('CPU');
    expect(text).toContain('RAM');
    expect(text).toContain('SSD');
  });

  it('omits the repo row (not a blank row) when repo is empty, without leaving a gap between real rows', () => {
    const frame = formatDeploymentFrame({ ...full, repo: '' });
    const middle = frame.slice(1, -1); // strip the two icon rows
    expect(middle.join('\n')).not.toContain('REPO');

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

  it('truncates a long name or repo instead of overflowing the box', () => {
    const longName = 'a'.repeat(200);
    const frame = formatDeploymentFrame({ ...full, name: longName, repo: longName });
    for (const line of frame) {
      expect(line.length).toBeLessThanOrEqual(LOGO_WIDTH);
    }
  });

  it('formats RAM in GB once it crosses 1000MB, and SSD in TB once it crosses 1000GB', () => {
    const text = formatDeploymentFrame({ ...full, ram: 4096, hdd: 1500 }).join('\n');
    expect(text).toContain('4.1G');
    expect(text).toContain('1.5T');
  });

  it('defaults to the docker icon when repo is empty (docker is the fallback type)', () => {
    const frame = formatDeploymentFrame({ ...full, repo: '' });
    expect(frame[0].trim()).toBe(DOCKER_ICON_LINE.trim());
  });
});

describe('formatExpiringFrame', () => {
  const full = { name: 'Minecraft', instances: 3, cpu: 2, ram: 4096, hdd: 25, blocksUntilExpiry: 240 };

  it('is always exactly BOOT_LINE_COUNT rows', () => {
    expect(formatExpiringFrame(full).length).toBe(BOOT_LINE_COUNT);
  });

  it('bookends the frame with the hourglass icon top and bottom, matching the box width', () => {
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

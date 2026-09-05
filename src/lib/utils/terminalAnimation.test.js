import { describe, it, expect } from 'vitest';
import {
  pickBootStartBlock,
  computeAnimatedBlock,
  shouldTriggerSync,
  mergeSyncTarget,
  formatNetworkLine,
  formatVersionLine,
  buildSyncBlockLines,
  FLUX_LOGO
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

describe('shouldTriggerSync', () => {
  it('is false while boot is not complete, even if the height increased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 105, bootComplete: false })).toBe(false);
  });

  it('is false on the very first data point (no previous height yet)', () => {
    expect(shouldTriggerSync({ previousBlockHeight: null, newBlockHeight: 105, bootComplete: true })).toBe(false);
  });

  it('is true after boot when the height increased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 105, bootComplete: true })).toBe(true);
  });

  it('is false after boot when the height is unchanged or decreased', () => {
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 100, bootComplete: true })).toBe(false);
    expect(shouldTriggerSync({ previousBlockHeight: 100, newBlockHeight: 99, bootComplete: true })).toBe(false);
  });
});

describe('mergeSyncTarget', () => {
  it('keeps the higher of the two block heights', () => {
    expect(mergeSyncTarget(294915, 294918)).toBe(294918);
    expect(mergeSyncTarget(294920, 294918)).toBe(294920);
  });
});

describe('formatNetworkLine', () => {
  it('formats nodes and apps with thousands separators', () => {
    expect(formatNetworkLine(12481, 3842)).toBe('network 12,481 nodes | apps 3,842');
  });

  it('falls back to "..." for missing values', () => {
    expect(formatNetworkLine(null, undefined)).toBe('network ... nodes | apps ...');
  });
});

describe('formatVersionLine', () => {
  it('includes the codename when present', () => {
    expect(formatVersionLine('v1.03', 'jolly wombat')).toBe('version v1.03 jolly wombat loaded');
  });

  it('omits the codename when absent', () => {
    expect(formatVersionLine('v1.03', '')).toBe('version v1.03 loaded');
  });
});

describe('buildSyncBlockLines', () => {
  it('lists each new block individually when there are few', () => {
    expect(buildSyncBlockLines(294912, 294915)).toEqual([
      'loading new blocks 294913',
      'loading new blocks 294914',
      'loading new blocks 294915'
    ]);
  });

  it('condenses to a range when there are many new blocks', () => {
    expect(buildSyncBlockLines(294912, 295000)).toEqual(['loading new blocks 294913–295000']);
  });

  it('returns an empty array when there is nothing new', () => {
    expect(buildSyncBlockLines(294912, 294912)).toEqual([]);
    expect(buildSyncBlockLines(294912, 294900)).toEqual([]);
  });
});

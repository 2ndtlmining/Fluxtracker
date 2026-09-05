import { describe, it, expect } from 'vitest';
import {
  pickBootStartBlock,
  computeAnimatedBlock,
  shouldTriggerSync,
  mergeSyncTarget,
  formatStatusLine,
  formatSnapshotLine,
  formatSummaryLine,
  formatSyncBlocksLine,
  formatTransactionsLine,
  buildSyncPatternLines,
  pickPatternChars,
  PATTERN_CHARS,
  padLines,
  composeRevealFrame,
  composeRevealKinds,
  FLUX_LOGO,
  LOGO_LINES,
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_TEXT,
  ROW_KIND_LOGO
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

describe('buildSyncPatternLines', () => {
  it('returns the requested number of lines, each of the requested width', () => {
    const lines = buildSyncPatternLines(6, 10, ['+', '=']);
    expect(lines).toHaveLength(6);
    lines.forEach(line => expect(line).toHaveLength(10));
  });

  it('weaves the two given characters, alternating the starting char between adjacent rows', () => {
    const lines = buildSyncPatternLines(3, 4, ['x', 'o']);
    expect(lines[0]).toBe('xoxo');
    expect(lines[1]).toBe('oxox');
    expect(lines[2]).toBe('xoxo');
  });

  it('uses only pool characters when the pair is picked at random', () => {
    const lines = buildSyncPatternLines(4, 8);
    lines.forEach(line => {
      expect(line).toMatch(/^[+\-=_~^:;.,*#%/\\|()[\]{}<>!?]+$/);
      [...line].forEach(char => expect(PATTERN_CHARS).toContain(char));
    });
  });

  it('picks a fresh random pair on every default call', () => {
    const a = buildSyncPatternLines(2, 8).join('');
    const b = buildSyncPatternLines(2, 8).join('');
    // 28-char pool -> a collision across two 16-char frames is possible but rare;
    // several draws make an all-equal outcome practically impossible.
    const frames = [a, b, buildSyncPatternLines(2, 8).join(''), buildSyncPatternLines(2, 8).join('')];
    expect(new Set(frames).size).toBeGreaterThan(1);
  });
});

describe('pickPatternChars', () => {
  it('returns two distinct pool characters', () => {
    for (let i = 0; i < 50; i++) {
      const [a, b] = pickPatternChars();
      expect(PATTERN_CHARS).toContain(a);
      expect(PATTERN_CHARS).toContain(b);
      expect(a).not.toBe(b);
    }
  });

  it('is deterministic for an injected random function', () => {
    let call = 0;
    const rolls = [0, 0, 0, 5, 5, 5]; // indices into PATTERN_CHARS
    const [a, b] = pickPatternChars(() => rolls[call++] / PATTERN_CHARS.length);
    expect(a).toBe(PATTERN_CHARS[0]);
    expect(b).toBe(PATTERN_CHARS[5]);
  });

  it('re-rolls the second char until it differs from the first', () => {
    // always rolls the same index -> the while loop keeps drawing, but a stub
    // that increments guarantees termination with a distinct pair
    let call = 0;
    const [a, b] = pickPatternChars(() => (call++ < 3 ? 0 : 1 / PATTERN_CHARS.length));
    expect(a).toBe(PATTERN_CHARS[0]);
    expect(b).toBe(PATTERN_CHARS[1]);
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

describe('formatSyncBlocksLine', () => {
  it('shows the counting X and the target Y', () => {
    expect(formatSyncBlocksLine(294913, 294915)).toBe('synched blocks 294913 / 294915');
    expect(formatSyncBlocksLine(294915, 294915)).toBe('synched blocks 294915 / 294915');
  });

  it('falls back to "..." for missing values', () => {
    expect(formatSyncBlocksLine(null, 294915)).toBe('synched blocks ... / 294915');
    expect(formatSyncBlocksLine(294913, null)).toBe('synched blocks 294913 / ...');
  });
});

describe('formatTransactionsLine', () => {
  it('shows the live transaction total with thousands separators', () => {
    expect(formatTransactionsLine(8472)).toBe('8,472 transactions loaded successfully');
  });

  it('shows zero without falling back to "..."', () => {
    expect(formatTransactionsLine(0)).toBe('0 transactions loaded successfully');
  });

  it('falls back to "..." for a missing count', () => {
    expect(formatTransactionsLine(null)).toBe('... transactions loaded successfully');
    expect(formatTransactionsLine(undefined)).toBe('... transactions loaded successfully');
  });
});
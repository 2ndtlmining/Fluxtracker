import { describe, it, expect } from 'vitest';
import {
  pickNextDeployed,
  rememberShown,
  blockMilestone,
  RECENT_HISTORY_LIMIT,
  MILESTONE_BLOCK_STEP,
  MILESTONE_WINDOW_BLOCKS
} from './headerRotation.js';
import { resolveIntroKey } from '../config.js';
import {
  formatMilestoneFrame,
  formatMilestoneReducedMotionLines,
  milestoneFrameKinds,
  formatDeployedCounterLine,
  formatDeploymentFrame,
  DEPLOYED_ICON_LINE,
  LOGO_WIDTH,
  BOOT_LINE_COUNT,
  ROW_KIND_MILESTONE,
  MILESTONE_FRAME_COUNT
} from './terminalAnimation.js';

const app = (name, blockAge, repo = '') => ({ name, blockAge, repo });

describe('resolveIntroKey (issue #271)', () => {
  it('resolves games by app name, even with no repo (encrypted specs)', () => {
    expect(resolveIntroKey(app('dragonwilds1789000000000', 1))).toBe('game:RuneScape: Dragonwilds');
    expect(resolveIntroKey(app('valheim1789000000000', 1))).toBe('game:Valheim');
  });

  it('a game wins over a service rule', () => {
    expect(resolveIntroKey(app('palworld1789000000000', 1, 'runonflux/orbit:latest'))).toBe('game:Palworld');
  });

  it('resolves services by repo', () => {
    expect(resolveIntroKey(app('mysite', 1, 'runonflux/orbit:latest'))).toBe('service:orbit');
    expect(resolveIntroKey(app('FoldingAtRunOnFlux1', 1, 'yurinnick/folding-at-home:latest'))).toBe('service:folding');
    expect(resolveIntroKey(app('vpn1', 1, 'siomiz/softethervpn:latest'))).toBe('service:vpn');
    expect(resolveIntroKey(app('p1', 1, 'globalping/globalping-probe'))).toBe('service:probe');
  });

  it('resolves encrypted services by name, including names with no timestamp', () => {
    expect(resolveIntroKey(app('wordpress1789000000000', 1))).toBe('service:wordpress');
    expect(resolveIntroKey(app('hermesagent1789000000000', 1))).toBe('service:ai-agent');
    expect(resolveIntroKey(app('ownllm-eu', 1))).toBe('service:ai-agent');
    expect(resolveIntroKey(app('blockbookbtc', 1))).toBe('service:crypto');
  });

  it('falls back to categorizeImage for other crypto images', () => {
    expect(resolveIntroKey(app('kas', 1, 'kaspanet/rusty-kaspad:latest'))).toBe('service:crypto');
  });

  it('returns null for anything unrecognised', () => {
    expect(resolveIntroKey(app('geap', 1))).toBeNull();
    expect(resolveIntroKey(null)).toBeNull();
  });
});

describe('pickNextDeployed (issue #283)', () => {
  const keyOf = a => a.key ?? null;
  const list = [
    { name: 'old', blockAge: 900, key: 'game:Valheim' },
    { name: 'newest', blockAge: 5, key: 'game:RuneScape: Dragonwilds' },
    { name: 'mid', blockAge: 300, key: 'game:RuneScape: Dragonwilds' },
    { name: 'plain', blockAge: 100, key: null }
  ];

  it('starts with the newest app and reports its place in the day', () => {
    const pick = pickNextDeployed(list, [], keyOf);
    expect(pick.app.name).toBe('newest');
    expect(pick).toMatchObject({ position: 1, total: 4 });
  });

  it('walks the whole list before repeating anything', () => {
    let recent = [];
    const seen = [];
    for (let i = 0; i < list.length; i++) {
      const { app: a } = pickNextDeployed(list, recent, keyOf);
      seen.push(a.name);
      recent = rememberShown(recent, a, keyOf(a));
    }
    expect(new Set(seen).size).toBe(list.length);
  });

  it('prefers an app whose intro differs from the last two shown', () => {
    const recent = [{ name: 'newest', key: 'game:RuneScape: Dragonwilds' }];
    // 'plain' (no intro) is newer than 'mid' (another dragon), and differs from the last key
    expect(pickNextDeployed(list, recent, keyOf).app.name).toBe('plain');
  });

  it('still shows a repeated intro rather than skipping it forever', () => {
    const dragons = [
      { name: 'a', blockAge: 1, key: 'dragon' },
      { name: 'b', blockAge: 2, key: 'dragon' }
    ];
    const pick = pickNextDeployed(dragons, [{ name: 'a', key: 'dragon' }], keyOf);
    expect(pick.app.name).toBe('b');
  });

  it('a single app is always the pick', () => {
    const one = [{ name: 'solo', blockAge: 1 }];
    expect(pickNextDeployed(one, [{ name: 'solo', key: null }], keyOf).app.name).toBe('solo');
  });

  it('returns null for an empty or missing list', () => {
    expect(pickNextDeployed([], [], keyOf)).toBeNull();
    expect(pickNextDeployed(undefined, [], keyOf)).toBeNull();
  });

  it('rememberShown caps the history', () => {
    let recent = [];
    for (let i = 0; i < RECENT_HISTORY_LIMIT + 50; i++) recent = rememberShown(recent, { name: `a${i}` }, null);
    expect(recent).toHaveLength(RECENT_HISTORY_LIMIT);
    expect(recent.at(-1).name).toBe(`a${RECENT_HISTORY_LIMIT + 49}`);
  });
});

describe('blockMilestone (issue #285)', () => {
  it('is null away from a round height', () => {
    expect(blockMilestone(2_974_396)).toBeNull();
    expect(blockMilestone(null)).toBeNull();
    expect(blockMilestone(0)).toBeNull();
  });

  it('counts down in the day before', () => {
    expect(blockMilestone(3_000_000 - MILESTONE_WINDOW_BLOCKS))
      .toEqual({ phase: 'countdown', target: 3_000_000, blocksToGo: MILESTONE_WINDOW_BLOCKS });
    expect(blockMilestone(2_999_999)).toMatchObject({ phase: 'countdown', blocksToGo: 1 });
    expect(blockMilestone(3_000_000 - MILESTONE_WINDOW_BLOCKS - 1)).toBeNull();
  });

  it('celebrates from the exact height for one day', () => {
    expect(blockMilestone(3_000_000)).toEqual({ phase: 'reached', target: 3_000_000, blocksPast: 0 });
    expect(blockMilestone(3_000_000 + MILESTONE_WINDOW_BLOCKS - 1)).toMatchObject({ phase: 'reached' });
    expect(blockMilestone(3_000_000 + MILESTONE_WINDOW_BLOCKS)).toBeNull();
  });

  it('recurs every step', () => {
    expect(blockMilestone(3 * MILESTONE_BLOCK_STEP + 3_000_000 + 10)).toMatchObject({ target: 3_300_000 });
  });
});

describe('milestone frames (issue #285)', () => {
  const countdown = { phase: 'countdown', target: 3_000_000, blocksToGo: 1234 };
  const reached = { phase: 'reached', target: 3_000_000, blocksPast: 217 };

  it.each([['countdown', countdown], ['reached', reached]])('%s: fixed box, no empty rows, animates', (_, m) => {
    const frames = Array.from({ length: MILESTONE_FRAME_COUNT }, (__, s) => formatMilestoneFrame(m, s));
    for (const f of frames) {
      expect(f).toHaveLength(BOOT_LINE_COUNT);
      for (const row of f) {
        expect(row).toHaveLength(LOGO_WIDTH);
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
    expect(frames[1]).not.toEqual(frames[0]);
  });

  it('shows only real numbers', () => {
    expect(formatMilestoneFrame(countdown).join('\n')).toMatch(/3,000,000[\s\S]*1,234 blocks to go/);
    expect(formatMilestoneFrame(reached).join('\n')).toMatch(/REACHED[\s\S]*now at 3,000,217/);
  });

  it('the countdown bar fills as the block approaches', () => {
    const bar = m => formatMilestoneFrame(m)[3].split('#').length - 1;
    expect(bar({ ...countdown, blocksToGo: 2000 })).toBeLessThan(bar({ ...countdown, blocksToGo: 100 }));
  });

  it('every row is gold', () => {
    expect(milestoneFrameKinds()).toEqual(Array(BOOT_LINE_COUNT).fill(ROW_KIND_MILESTONE));
  });

  it('reduced motion keeps the facts', () => {
    expect(formatMilestoneReducedMotionLines(reached).join('\n')).toContain('3,000,000 reached');
    expect(formatMilestoneReducedMotionLines(reached)).toHaveLength(BOOT_LINE_COUNT);
  });
});

describe('deployment counter bookend (issue #283)', () => {
  it('is exactly the box width and says where the app sits in the day', () => {
    const line = formatDeployedCounterLine({ position: 12, total: 125 });
    expect(line).toHaveLength(LOGO_WIDTH);
    expect(line).toContain('#12 OF 125 IN 24H');
    expect(line.startsWith('>')).toBe(true);
    expect(line.endsWith('<')).toBe(true);
  });

  it('falls back to the plain banner without a rank', () => {
    expect(formatDeployedCounterLine(null)).toBe(DEPLOYED_ICON_LINE);
  });

  it('is the deployment frame\'s closing row, opening row unchanged', () => {
    const frame = formatDeploymentFrame({ name: 'x', instances: 1 }, { position: 3, total: 9 });
    expect(frame[0]).toBe(DEPLOYED_ICON_LINE);
    expect(frame.at(-1)).toContain('#3 OF 9 IN 24H');
  });
});

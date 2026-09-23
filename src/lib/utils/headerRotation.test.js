import { describe, it, expect } from 'vitest';
import {
  pickNextDeployed,
  rememberShown,
  RECENT_HISTORY_LIMIT
} from './headerRotation.js';
import { resolveIntroKey } from '../config.js';
import {
  formatDeployedCounterLine,
  formatDeploymentFrame,
  DEPLOYED_ICON_LINE,
  LOGO_WIDTH,
  BOOT_LINE_COUNT
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

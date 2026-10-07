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

  it('resolves the families that fell through to the crane (issue #416)', () => {
    // Firo masternodes: enterprise-encrypted, so the name is all there is
    expect(resolveIntroKey(app('firomn21', 1))).toBe('service:crypto');
    expect(resolveIntroKey(app('firoalpha', 1))).toBe('service:crypto');
    expect(resolveIntroKey(app('firospare', 1))).toBe('service:crypto');
    expect(resolveIntroKey(app('hermesagentpro1790380328449', 1))).toBe('service:ai-agent');
    expect(resolveIntroKey(app('foldingatrunonflux3', 1))).toBe('service:folding');
    expect(resolveIntroKey(app('cumulusvpn12', 1))).toBe('service:vpn');
    expect(resolveIntroKey(app('proxy1', 1, 'holdroot/proxymsg-agent:latest'))).toBe('service:vpn');
  });

  it('resolves games by image, with the rule /api/games/live counts by (issue #416)', () => {
    expect(resolveIntroKey(app('myvalheim', 1, 'mbround18/valheim:latest'))).toBe('game:Valheim');
    expect(resolveIntroKey(app('mc', 1, 'itzg/minecraft-server:latest'))).toBe('game:Minecraft');
    expect(resolveIntroKey(app('mcbe', 1, 'itzg/minecraft-bedrock-server:latest'))).toBe('game:Minecraft');
    expect(resolveIntroKey(app('t', 1, 'littlestache/terraria:latest'))).toBe('game:Terraria');
    expect(resolveIntroKey(app('s', 1, 'wolveix/satisfactory-server:latest'))).toBe('game:Satisfactory');
    expect(resolveIntroKey(app('a', 1, 'thmhoag/arkserver:latest'))).toBe('game:ARK Survival');
    // Issue #505: the hub's name and Flux's image land on the same art.
    expect(resolveIntroKey(app('7daystodie1790705531162', 2, 'runonflux/7dtd-server-flux:latest'))).toBe('game:7 Days to Die');
    expect(resolveIntroKey(app('zeds', 1, 'runonflux/7dtd-server-flux:latest'))).toBe('game:7 Days to Die');
    expect(resolveIntroKey(app('zeds', 1, 'vinanrra/7dtd-server:latest'))).toBe('game:7 Days to Die');
    // Issue #514: the hub's encrypted deployments (no image) and a community image, on ASA's
    // own art -- not the ARK Survival (Evolved) sauropod.
    expect(resolveIntroKey(app('arksurvivalascended1791140248911', 1))).toBe('game:ARK: Survival Ascended');
    expect(resolveIntroKey(app('dinos', 1, 'mschnitzer/asa-linux-server:latest'))).toBe('game:ARK: Survival Ascended');
    // Issue #518: a hub deployment and the same image under any other name.
    expect(resolveIntroKey(app('hytale1791208306845', 1, 'indifferentbroccoli/hytale-server-docker:latest'))).toBe('game:Hytale');
    expect(resolveIntroKey(app('orbis', 1, 'indifferentbroccoli/hytale-server-docker:latest'))).toBe('game:Hytale');
    // Issue #521: an encrypted hub deployment, and the community image under any other name.
    expect(resolveIntroKey(app('armareforger1791371186445', 1))).toBe('game:Arma Reforger');
    expect(resolveIntroKey(app('everon', 1, 'rouhim/arma-reforger-server:latest'))).toBe('game:Arma Reforger');
  });

  it('resolves n8n, SimpleX and file servers by their real names and images (issue #420)', () => {
    expect(resolveIntroKey(app('n8nstarter1790178853412', 1))).toBe('service:automation');
    expect(resolveIntroKey(app('n8npostgres', 1))).toBe('service:automation');
    expect(resolveIntroKey(app('flow', 1, 'n8nio/n8n:latest'))).toBe('service:automation');
    expect(resolveIntroKey(app('simplexsmp7', 1, 'simplexchat/smp-server:latest'))).toBe('service:messaging');
    expect(resolveIntroKey(app('simplexsmp1780819570775', 1))).toBe('service:messaging');
    expect(resolveIntroKey(app('privatesimplexsmp1780570675672', 1))).toBe('service:messaging');
    expect(resolveIntroKey(app('nextcloudpersonal1780729565977', 1))).toBe('service:files');
    expect(resolveIntroKey(app('owncloudssl', 1, 'owncloud/server:10.15.0'))).toBe('service:files');
    expect(resolveIntroKey(app('nextoffice', 1, 'nextcloud:latest'))).toBe('service:files');
    expect(resolveIntroKey(app('docs', 1, 'onlyoffice/documentserver:latest'))).toBe('service:files');
    // near misses stay out
    expect(resolveIntroKey(app('libreoffice', 1, 'linuxserver/libreoffice:latest'))).toBeNull();
    expect(resolveIntroKey(app('mysimplex', 1))).toBeNull();
  });

  it('does not give a game helper its game\'s art (CATEGORY_EXCLUDE)', () => {
    expect(resolveIntroKey(app('ping', 1, 'wirewrex/flux-dns-fdm:minecraft-ping'))).toBeNull();
    expect(resolveIntroKey(app('site', 1, 'runonflux/palworld-server-website:latest'))).toBeNull();
  });

  it('returns null for anything unrecognised', () => {
    expect(resolveIntroKey(app('geap', 1))).toBeNull();
    expect(resolveIntroKey(app('firewall', 1))).toBeNull();   // ^firo, not ^fir
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

  it('drains the biggest intro first, so it spreads across the round (issue #417)', () => {
    const pick = pickNextDeployed(list, [{ name: 'plain', key: null }], keyOf);
    // two dragons wait, one Valheim: the dragon group goes first, newest dragon within it
    expect(pick.app.name).toBe('newest');
  });

  it('alternates art variants within an intro (issue #417)', () => {
    const dragons = [
      { name: 'a', blockAge: 1, key: 'dragon', v: 0 },
      { name: 'b', blockAge: 2, key: 'dragon', v: 0 },
      { name: 'c', blockAge: 3, key: 'dragon', v: 1 }
    ];
    const recent = [{ name: 'a', key: 'dragon', variant: 0 }];
    expect(pickNextDeployed(dragons, recent, keyOf, d => d.v).app.name).toBe('c');
  });

  it('a 131-app day: no intro runs longer than 2 while others wait, and every app gets a turn (issue #417)', () => {
    // Shaped like the measured day: Dragonwilds ~43%, a long tail of other intros, some with none
    const apps = [];
    let age = 0;
    const add = (key, n, v = () => null) => {
      for (let i = 0; i < n; i++) apps.push({ name: `${key ?? 'plain'}-${i}`, blockAge: age += 7, key, v: v(i) });
    };
    add('game:RuneScape: Dragonwilds', 56, i => i % 3 === 0 ? 1 : 0);
    add('game:Minecraft', 14);
    add('game:Valheim', 10);
    add('service:wordpress', 12);
    add('service:crypto', 9);
    add('service:orbit', 8);
    add('game:Palworld', 6);
    add('service:ai-agent', 5);
    add(null, 11);
    // interleave ages the way a real day does, deterministically
    apps.forEach((a, i) => { a.blockAge = (i * 7919) % 1440; });
    expect(apps).toHaveLength(131);

    let recent = [];
    const shown = [];
    for (let i = 0; i < apps.length; i++) {
      const { app: a } = pickNextDeployed(apps, recent, keyOf, x => x.v);
      shown.push(a);
      recent = rememberShown(recent, a, keyOf(a), a.v);
    }
    expect(new Set(shown.map(a => a.name)).size).toBe(apps.length);

    let run = 1;
    for (let i = 1; i < shown.length; i++) {
      run = keyOf(shown[i]) === keyOf(shown[i - 1]) ? run + 1 : 1;
      if (run > 2) {
        const otherWaiting = shown.slice(i + 1).some(a => keyOf(a) !== keyOf(shown[i]));
        expect(otherWaiting, `run of ${run} ${keyOf(shown[i])} at pick ${i}`).toBe(false);
      }
    }

    // consecutive dragons never replay the same variant while the other is still waiting
    const dragons = shown.filter(a => a.key === 'game:RuneScape: Dragonwilds');
    for (let i = 1; i < dragons.length; i++) {
      if (dragons[i].v === dragons[i - 1].v) {
        expect(dragons.slice(i).some(d => d.v !== dragons[i].v)).toBe(false);
      }
    }
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

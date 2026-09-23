import { describe, it, expect } from 'vitest';
import {
  formatDeploymentFrame,
  formatExpiringFrame,
  formatSidePanel,
  markPaused,
  PAUSED_MARKER,
  ENTERPRISE_RESOURCES,
  LOGO_LINES,
  LOGO_WIDTH,
  BOOT_LINE_COUNT
} from './terminalAnimation.js';

// The real shape of an enterprise deployment from /api/carousel/deployed: resources are
// encrypted and come back as zeros.
const enterprise = { name: 'dragonwilds1790087212677', instances: 2, cpu: 0, ram: 0, hdd: 0, isEnterprise: true, blockAge: 25 };
const open = { name: 'palworld1787015974836', instances: 2, cpu: 6, ram: 16000, hdd: 40, isEnterprise: false, blockAge: 74 };

describe('encrypted apps no longer leave an empty row (PR 10)', () => {
  it.each([
    ['deployed', formatDeploymentFrame(enterprise, { position: 1, total: 134 })],
    ['expiring', formatExpiringFrame({ ...enterprise, blocksUntilExpiry: 120 })]
  ])('%s frame: every row has content and RES says the spec is private', (_, frame) => {
    expect(frame).toHaveLength(BOOT_LINE_COUNT);
    for (const row of frame) expect(row.trim().length).toBeGreaterThan(0);
    expect(frame.join('\n')).toContain(`RES    ${ENTERPRISE_RESOURCES}`);
  });

  it('a non-enterprise app with no resources still omits the row', () => {
    expect(formatDeploymentFrame({ ...open, cpu: 0, ram: 0, hdd: 0 }).join('\n')).not.toContain('RES');
  });
});

describe('markPaused (issue #282)', () => {
  it('replaces the end of the last row and keeps every row inside the box', () => {
    const marked = markPaused(LOGO_LINES);
    expect(marked).toHaveLength(LOGO_LINES.length);
    expect(marked.at(-1)).toHaveLength(LOGO_WIDTH);
    expect(marked.at(-1).endsWith(PAUSED_MARKER)).toBe(true);
    expect(marked.slice(0, -1)).toEqual(LOGO_LINES.slice(0, -1));
  });

  it('does not change the frame it was given', () => {
    const frame = formatDeploymentFrame(open);
    const copy = [...frame];
    markPaused(frame);
    expect(frame).toEqual(copy);
  });
});

describe('formatSidePanel', () => {
  const base = { blockHeight: 2_976_515, totalNodes: 6490, totalApps: 7887, deployedCount: 134 };
  const noEmptyRows = rows => {
    expect(rows).toHaveLength(BOOT_LINE_COUNT);
    for (const r of rows) expect(r.text.trim().length).toBeGreaterThan(0);
  };
  const paid = { status: 'ok', amount: 18.4, usd: 0.955512, date: '2026-09-16', total: 1 };

  it('deployed: kind, image, payment, next up -- the facts the box does not show', () => {
    const rows = formatSidePanel({ ...base, kind: 'deployed', app: open, introKey: 'game:Palworld', payment: paid, next: { kind: 'expiring', app: { name: 'minecraftj1' } } });
    noEmptyRows(rows);
    expect(rows.map(r => r.text)).toEqual([
      'NOW PLAYING',
      'game · Palworld',
      'image —', // this fixture has no repo and is not enterprise
      'paid 18.40 FLUX · $0.96 · Sep 16',
      'next up: minecraftj1',
      'block 2,976,515 · 6,490 nodes'
    ]);
    expect(rows[4].role).toBe('next');
  });

  it('never repeats what the box shows for the same app (issue #345)', () => {
    const app = { ...open, repo: 'runonflux/palworld-server-flux:latest' };
    const box = formatDeploymentFrame(app, { position: 12, total: 125 }).join('\n');
    const panel = formatSidePanel({ ...base, kind: 'deployed', app, introKey: 'game:Palworld', payment: paid, rank: { position: 12, total: 125 } })
      .map(r => r.text).join('\n');
    expect(box).toMatch(/INST\s+2/);
    expect(panel).not.toMatch(/\binst\b/i);
    for (const repeated of [app.name, '12 OF 125', '16.0G RAM', '37m ago']) {
      expect(box).toContain(repeated);
      expect(panel).not.toContain(repeated);
    }
  });

  it('enterprise: says the image is private and marks the kind', () => {
    const rows = formatSidePanel({ ...base, kind: 'expiring', app: { ...enterprise, blocksUntilExpiry: 120 }, introKey: 'game:RuneScape: Dragonwilds', payment: { status: 'none' } });
    noEmptyRows(rows);
    expect(rows[0].text).toBe('EXPIRING SOON');
    expect(rows[1].text).toBe('game · RuneScape: Dragonwilds · enterprise');
    expect(rows[2].text).toBe('image private (enterprise spec)');
    expect(rows[3].text).toBe('no payment synced yet');
  });

  it('several payments: count, last amount and date', () => {
    const rows = formatSidePanel({ ...base, kind: 'deployed', app: open, introKey: null, payment: { ...paid, total: 3 } });
    expect(rows[1].text).toBe('app');
    expect(rows[3].text).toBe('3 payments · last 18.40 FLUX · Sep 16');
  });

  it('while the payment lookup is in flight or failed it says so, never a zero', () => {
    expect(formatSidePanel({ kind: 'deployed', app: open })[3].text).toBe('payment: checking…');
    expect(formatSidePanel({ kind: 'deployed', app: open, payment: { status: 'error' } })[3].text).toBe('payment: —');
  });

  it('logo: network facts and the newest deployment', () => {
    const rows = formatSidePanel({ ...base, kind: 'logo', newest: enterprise, next: { kind: 'deployed', app: open } });
    noEmptyRows(rows);
    expect(rows[1].text).toBe('6,490 nodes · 7,887 apps');
    expect(rows[2].text).toBe('134 deployed in 24h');
    expect(rows[3].text).toBe(`newest: ${enterprise.name}`);
  });

  it('with nothing loaded it shows dashes, never blanks or zeros, and no clickable next row', () => {
    const rows = formatSidePanel({ kind: null, totalNodes: 0, totalApps: 0 });
    noEmptyRows(rows);
    expect(rows.map(r => r.text).join(' ')).not.toMatch(/\b0 (nodes|apps)\b|undefined|NaN/);
    expect(rows.some(r => r.role === 'next')).toBe(false);
  });
});

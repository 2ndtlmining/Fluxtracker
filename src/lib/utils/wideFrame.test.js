import { describe, it, expect } from 'vitest';
import {
  formatDeploymentFrame,
  formatExpiringFrame,
  formatDeploymentFrameWide,
  formatExpiringFrameWide,
  WIDE_WIDTH,
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

describe('wide detail frames (issue #345)', () => {
  const paid = { status: 'ok', amount: 18.4, usd: 0.955512, date: '2026-09-16', total: 1 };
  const enshrouded = {
    name: 'enshrouded1789586019696', repo: 'sknnr/enshrouded-dedicated-server:latest',
    instances: 2, cpu: 2, ram: 4000, hdd: 50, isEnterprise: false, blocksUntilExpiry: 12
  };
  const shape = frame => {
    expect(frame).toHaveLength(BOOT_LINE_COUNT);
    for (const row of frame) {
      expect(row.length).toBeLessThanOrEqual(WIDE_WIDTH);
      expect(row.trim().length).toBeGreaterThan(0);
    }
    expect(frame[0]).toHaveLength(WIDE_WIDTH);
    expect(frame.at(-1)).toHaveLength(WIDE_WIDTH);
  };

  it('expiring: everything about the one app, in one frame', () => {
    const frame = formatExpiringFrameWide(enshrouded, { introKey: 'game:Enshrouded', payment: paid });
    shape(frame);
    expect(frame[0]).toContain(' EXPIRING ');
    expect(frame[1]).toMatch(/NAME\s+enshrouded1789586019696\s+GAME\s+Enshrouded/);
    expect(frame[2]).toMatch(/EXPIRE\s+6m\s+IMAGE\s+sknnr\/enshrouded-dedicated-server/);
    expect(frame[3]).toMatch(/INST\s+2\s+PAID\s+18\.40 FLUX · \$0\.96/);
    expect(frame[4]).toMatch(/RES\s+2 CPU 4\.0G RAM 50G SSD\s+ON\s+Sep 16/);
    // Nothing that is not about this app (the owner's call on #345).
    expect(frame.join('\n')).not.toMatch(/block|nodes|next up/i);
  });

  it('deployed: rank in the closing bookend, age on the left', () => {
    const frame = formatDeploymentFrameWide(open, { position: 12, total: 125 }, { introKey: 'game:Palworld', payment: { ...paid, total: 3 } });
    shape(frame);
    const text = frame.join('\n');
    expect(frame[0]).toContain(' NEW APP DEPLOYED ');
    expect(frame.at(-1)).toContain(' #12 OF 125 IN 24H ');
    expect(text).toMatch(/AGO\s+37m ago/);
    expect(text).toContain('Sep 16 (last of 3)');
    expect(text).toMatch(/IMAGE\s+—/); // no repo, not enterprise
  });

  it('enterprise: image private, service or plain app type, payment not synced yet', () => {
    const text = formatDeploymentFrameWide(enterprise, null, { introKey: 'service:wordpress', payment: { status: 'none' } }).join('\n');
    shape(formatDeploymentFrameWide(enterprise, null, {}));
    expect(text).toMatch(/SERVICE\s+wordpress/);
    expect(text).toMatch(/IMAGE\s+private \(enterprise\)/);
    expect(text).toMatch(/PAID\s+not synced yet/);
    expect(formatDeploymentFrameWide(enterprise, null, {}).join('\n')).toMatch(/TYPE\s+app/);
  });

  it('while the payment lookup is in flight or failed it says so, never a zero', () => {
    expect(formatExpiringFrameWide(enshrouded, {}).join('\n')).toMatch(/PAID\s+checking…/);
    expect(formatExpiringFrameWide(enshrouded, { payment: { status: 'error' } }).join('\n')).toMatch(/PAID\s+—/);
  });

  it('pausing a wide frame keeps its width', () => {
    const marked = markPaused(formatExpiringFrameWide(enshrouded, { payment: paid }));
    expect(marked.at(-1)).toHaveLength(WIDE_WIDTH);
    expect(marked.at(-1).endsWith(PAUSED_MARKER)).toBe(true);
  });
});

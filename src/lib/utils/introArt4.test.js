import { describe, it, expect } from 'vitest';
import { LOGO_WIDTH, BOOT_LINE_COUNT } from './terminalAnimation.js';
import {
  formatAutomationFrame, automationFrameKinds,
  formatMessagingFrame, messagingFrameKinds,
  formatFilesFrame, filesFrameKinds,
  BATCH4_FRAME_COUNT
} from './introArt4.js';

const FRAMES = BATCH4_FRAME_COUNT;

const SEQUENCES = [
  ['automation / n8n (#420)', formatAutomationFrame, automationFrameKinds, 'purple'],
  ['messaging / SimpleX (#420)', formatMessagingFrame, messagingFrameKinds, 'blue'],
  ['files / Nextcloud (#420)', formatFilesFrame, filesFrameKinds, 'blue']
];

describe.each(SEQUENCES)('%s', (_, format, kinds, accent) => {
  const frames = Array.from({ length: FRAMES }, (__, step) => format(step));

  it('every frame is BOOT_LINE_COUNT rows of exactly LOGO_WIDTH, none empty', () => {
    for (const frame of frames) {
      expect(frame).toHaveLength(BOOT_LINE_COUNT);
      for (const row of frame) {
        expect(row).toHaveLength(LOGO_WIDTH);
        expect(row.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('animates: every frame differs from the one before', () => {
    for (let i = 1; i < frames.length; i++) expect(frames[i]).not.toEqual(frames[i - 1]);
  });

  it('is a pure function of the step and wraps', () => {
    expect(format(FRAMES + 5)).toEqual(format(5));
  });

  it('shows no numbers -- no execution count, message count or storage figure', () => {
    for (const frame of frames) expect(frame.join('')).not.toMatch(/\d/);
  });

  it('a service colour, never the games\' green', () => {
    expect(kinds()).toEqual(Array(BOOT_LINE_COUNT).fill(accent));
  });
});

describe('specifics (#420)', () => {
  it('the workflow dot travels trigger -> fn -> out, lighting each node', () => {
    expect(formatAutomationFrame(0)[1]).toMatch(/^ \.=+\./);
    expect(formatAutomationFrame(1)[2]).toContain('-o->');
    expect(formatAutomationFrame(3)[1]).toContain('.====.');
    expect(formatAutomationFrame(7)[5]).toContain('done');
  });

  it('the envelope loses a ring at each relay and is delivered', () => {
    const rings = s => (formatMessagingFrame(s)[3].match(/\(+@/) || ['@'])[0].length - 1;
    expect(rings(0)).toBe(3);
    expect(rings(1)).toBe(2);
    expect(rings(3)).toBe(1);
    expect(rings(5)).toBe(0);
    expect(formatMessagingFrame(1)[1]).toContain('((*))');
    expect(formatMessagingFrame(7)[5]).toContain('delivered');
  });

  it('the sync bar fills to the end without moving the wall', () => {
    const bar = s => formatFilesFrame(s)[5].match(/\[([#.]+)\]/)[1];
    expect(bar(0).length).toBe(bar(7).length);
    expect(bar(7)).not.toContain('.');
    expect(formatFilesFrame(7)[1]).toContain('[=]');
  });
});

import { describe, it, expect } from 'vitest';
import { summarizeHealth, REVENUE_SYNC_STALE_INTERVALS } from '../healthSummary.js';

const NOW = Date.parse('2026-09-23T12:00:00Z');
const INTERVAL = 5 * 60 * 1000;

const healthy = {
  dbReachable: true,
  activeInstance: 'primary',
  backup: { enabled: true, isHealthy: true, partial: false },
  snapshot: { healthy: true },
  priceHistory: { healthy: true },
  revenueSync: { lastSyncMs: NOW - 60_000, intervalMs: INTERVAL, consecutiveFailures: 0 },
  now: NOW
};

describe('summarizeHealth (issue #310)', () => {
  it('ok when everything is fine', () => {
    expect(summarizeHealth(healthy)).toEqual({ status: 'ok', httpStatus: 200, problems: [] });
  });

  it('down + 503 when the database is unreachable', () => {
    expect(summarizeHealth({ ...healthy, dbReachable: false })).toMatchObject({ status: 'down', httpStatus: 503 });
  });

  it.each([
    ['a stale backup', { backup: { enabled: true, isHealthy: false } }, /backup is stale/],
    ['a partial backup', { backup: { enabled: true, isHealthy: true, partial: true } }, /missing tables/],
    ['a failing snapshot', { snapshot: { healthy: false } }, /snapshot/],
    ['stale price history', { priceHistory: { healthy: false } }, /price history/],
    ['the failover database', { activeInstance: 'failover' }, /failover/],
    ['a stalled revenue sync', { revenueSync: { lastSyncMs: NOW - INTERVAL * (REVENUE_SYNC_STALE_INTERVALS + 1), intervalMs: INTERVAL } }, /revenue sync last completed/],
    ['a revenue sync that never ran', { revenueSync: { lastSyncMs: null, intervalMs: INTERVAL } }, /never completed/],
    ['repeated revenue sync failures', { revenueSync: { lastSyncMs: NOW, intervalMs: INTERVAL, consecutiveFailures: 3 } }, /failed 3 times/]
  ])('degraded (still 200) for %s', (_, override, message) => {
    const result = summarizeHealth({ ...healthy, ...override });
    expect(result.status).toBe('degraded');
    expect(result.httpStatus).toBe(200);
    expect(result.problems.join('; ')).toMatch(message);
  });

  it('a backup that is not configured is not a problem', () => {
    expect(summarizeHealth({ ...healthy, backup: { enabled: false, isHealthy: true } }).status).toBe('ok');
  });

  // #431: a services-cycle step that keeps failing freezes its numbers; health names it.
  it('names a service that failed 3 cycles in a row, with its last success', () => {
    const result = summarizeHealth({ ...healthy, now: NOW, services: {
      nodes: { lastSuccess: NOW, consecutiveFailures: 0 },
      cloud: { lastSuccess: NOW - 20 * 60000, consecutiveFailures: 3, lastError: 'upstream unavailable' }
    } });
    expect(result.status).toBe('degraded');
    expect(result.problems).toEqual(['cloud refresh failed 3 cycles in a row (last success 20 min ago)']);
  });

  it('two failures in a row are not yet a problem', () => {
    expect(summarizeHealth({ ...healthy, services: { cloud: { lastSuccess: NOW, consecutiveFailures: 2 } } }).status).toBe('ok');
  });

  it('says so when a failing service has not succeeded since the restart', () => {
    const result = summarizeHealth({ ...healthy, services: { gaming: { lastSuccess: null, consecutiveFailures: 4 } } });
    expect(result.problems[0]).toMatch(/gaming refresh failed 4 cycles in a row \(no success since restart\)/);
  });

  it('flags a lost live price', () => {
    expect(summarizeHealth({ ...healthy, livePriceLost: true }).problems).toContain('no live FLUX price and no usable fallback');
  });
});

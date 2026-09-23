import { describe, it, expect } from 'vitest';
import { fetchJson, formatClockTime } from './fetchJson.js';

/** A fetch stand-in answering with `status` and `body` (a string body = unparseable). */
const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (typeof body === 'string') throw new SyntaxError('Unexpected token');
    return body;
  }
});

describe('fetchJson (issue #319)', () => {
  it('resolves real data', async () => {
    await expect(fetchJson('/x', reply(200, { nodes: { total: 6570 } }))).resolves.toEqual({ nodes: { total: 6570 } });
  });

  it('rejects an error body even on a 200', async () => {
    await expect(fetchJson('/x', reply(200, { error: 'boom' }))).rejects.toThrow('boom');
  });

  it('rejects a 503 without data -- the case that used to render as zeros', async () => {
    await expect(fetchJson('/x', reply(503, { error: 'Service unavailable' }))).rejects.toMatchObject({ status: 503 });
  });

  it('accepts withDbFallback\'s 503 that still carries the stale cache', async () => {
    const body = { nodes: { total: 6500 }, _stale: true };
    await expect(fetchJson('/x', reply(503, body))).resolves.toEqual(body);
  });

  it('rejects an unparseable body', async () => {
    await expect(fetchJson('/x', reply(502, '<html>Bad gateway</html>'))).rejects.toThrow('HTTP 502');
  });

  it('propagates a network failure', async () => {
    const down = async () => { throw new TypeError('Failed to fetch'); };
    await expect(fetchJson('/x', down)).rejects.toThrow('Failed to fetch');
  });
});

describe('formatClockTime', () => {
  it('formats local HH:MM', () => {
    const ms = new Date(2026, 8, 23, 9, 5).getTime();
    expect(formatClockTime(ms)).toBe('09:05');
  });

  it('is null for a missing time', () => {
    expect(formatClockTime(null)).toBeNull();
  });
});

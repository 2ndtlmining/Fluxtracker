import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveBackfillRange } from '../admin/backfill.js';

/**
 * Issue #218 — POST /api/admin/backfill ignored its body and always rewrote the last 365
 * days. Repairing one known-bad week meant reprocessing a year, and the caller had no way
 * to say otherwise. The range is now explicit, with the old window as the documented
 * default, and validated in UTC so it does not drift with the host's timezone.
 */

const TZ = process.env.TZ;

beforeEach(() => {
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers();
    // 2026-03-12 01:30 UTC is still 2026-03-11 locally -- a default computed from local
    // date parts would be a day off.
    vi.setSystemTime(new Date('2026-03-12T01:30:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = TZ;
});

describe('resolveBackfillRange', () => {
    it('defaults to the year ending yesterday, in UTC', () => {
        expect(resolveBackfillRange({})).toEqual({ from: '2025-03-12', to: '2026-03-11' });
    });

    it('uses an explicit range when one is given', () => {
        expect(resolveBackfillRange({ from: '2026-01-01', to: '2026-01-07' }))
            .toEqual({ from: '2026-01-01', to: '2026-01-07' });
    });

    it('accepts one explicit bound and defaults the other', () => {
        expect(resolveBackfillRange({ from: '2026-03-01' }))
            .toEqual({ from: '2026-03-01', to: '2026-03-11' });
    });

    it('rejects a malformed date rather than silently backfilling a year', () => {
        expect(() => resolveBackfillRange({ from: '01/03/2026' })).toThrow(/YYYY-MM-DD/);
        expect(() => resolveBackfillRange({ to: '2026-13-45' })).toThrow(/YYYY-MM-DD/);
    });

    it('rejects a reversed range', () => {
        expect(() => resolveBackfillRange({ from: '2026-03-10', to: '2026-03-01' }))
            .toThrow(/before/i);
    });
});

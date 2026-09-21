import { describe, it, expect, beforeEach } from 'vitest';
import {
    instrumentAdapter,
    isDatabaseError,
    dbSuccessCount
} from '../dbCallTracker.js';

/**
 * Issue #219 — the database circuit breaker counted failures it had no business counting.
 *
 * withDbFallback's catch called recordFailure() for ANY error thrown inside it, including
 * errors from pure upstream-API work. A Flux API outage, polled from a few open tabs, took
 * the DATABASE breaker to OPEN in one burst: every other endpoint 503'd, snapshotManager
 * skipped its checks, and with SUPABASE_FAILOVER_URL set the process silently switched
 * instances -- while the primary database was perfectly healthy.
 *
 * Attribution is decided at the one place every database call already passes through,
 * rather than per-route, so a route that does BOTH kinds of work (/api/games/live) is
 * still judged on what actually failed.
 */

describe('instrumentAdapter', () => {
    it('marks an error thrown by a database call', async () => {
        const db = instrumentAdapter({ getThing: async () => { throw new Error('connection refused'); } });

        await expect(db.getThing()).rejects.toSatisfy(isDatabaseError);
    });

    it('leaves an unrelated error untagged', () => {
        expect(isDatabaseError(new Error('api.runonflux.io returned 502'))).toBe(false);
    });

    it('preserves the original error, message and identity', async () => {
        const original = new Error('connection refused');
        const db = instrumentAdapter({ getThing: async () => { throw original; } });

        await expect(db.getThing()).rejects.toBe(original);
        expect(original.message).toBe('connection refused');
    });

    it('passes arguments and return values through untouched', async () => {
        const db = instrumentAdapter({ add: async (a, b) => a + b });

        expect(await db.add(2, 3)).toBe(5);
    });

    it('tags a synchronous throw too', () => {
        const db = instrumentAdapter({ getDb: () => { throw new Error('no handle'); } });

        expect(() => db.getDb()).toThrow();
        try { db.getDb(); } catch (e) { expect(isDatabaseError(e)).toBe(true); }
    });

    it('passes non-function properties through', () => {
        const db = instrumentAdapter({ NAME: 'sqlite', getThing: async () => 1 });

        expect(db.NAME).toBe('sqlite');
    });
});

describe('dbSuccessCount', () => {
    it('advances only when a database call actually succeeds', async () => {
        const db = instrumentAdapter({
            ok: async () => 'fine',
            bad: async () => { throw new Error('down'); }
        });

        const before = dbSuccessCount();
        await db.ok();
        expect(dbSuccessCount()).toBe(before + 1);

        await expect(db.bad()).rejects.toThrow();
        expect(dbSuccessCount()).toBe(before + 1);
    });
});

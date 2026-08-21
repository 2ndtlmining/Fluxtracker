import { describe, it, expect, beforeEach } from 'vitest';
import { consumeRateLimit, refundTarget, resetRateLimits, LIMITS } from '../rateLimiter.js';

const T0 = Date.parse('2026-08-21T12:00:00Z');
const minutes = (n) => n * 60_000;
const hours = (n) => n * 3_600_000;

beforeEach(() => resetRateLimits());

describe('per-client limits', () => {
    it('allows up to the hourly limit', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) {
            // Different target each time so only the client limit is in play
            expect(consumeRateLimit('ip-1', `target-${i}`, T0).allowed, `send ${i + 1}`).toBe(true);
        }
        expect(consumeRateLimit('ip-1', 'target-new', T0).allowed).toBe(false);
    });

    it('explains the hourly limit and when to retry', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) consumeRateLimit('ip-1', `t${i}`, T0);

        const result = consumeRateLimit('ip-1', 'fresh', T0 + minutes(10));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/in the last hour/);
        expect(result.reason).toMatch(/50 minutes/);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('frees up once the hour window slides past', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) consumeRateLimit('ip-1', `t${i}`, T0);
        expect(consumeRateLimit('ip-1', 'fresh', T0 + hours(1) + 1000).allowed).toBe(true);
    });

    it('enforces the daily cap beyond the hourly one', () => {
        // Spread sends across the day so the hourly window never fills
        for (let i = 0; i < LIMITS.perClientPerDay; i++) {
            consumeRateLimit('ip-1', `t${i}`, T0 + minutes(i * 61));
        }
        const later = T0 + minutes(LIMITS.perClientPerDay * 61);
        const result = consumeRateLimit('ip-1', 'fresh', later);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/daily limit/);
    });

    it('tracks clients independently', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) consumeRateLimit('ip-1', `t${i}`, T0);
        expect(consumeRateLimit('ip-1', 'x', T0).allowed).toBe(false);
        expect(consumeRateLimit('ip-2', 'x', T0).allowed).toBe(true);
    });
});

describe('per-destination limit', () => {
    it('blocks a second send to the same target inside the window', () => {
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        const result = consumeRateLimit('ip-1', 'discord:hook-a', T0 + minutes(1));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/just sent to this destination/);
    });

    it('blocks a different client hitting the same target — stops harassment', () => {
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        expect(consumeRateLimit('ip-2', 'discord:hook-a', T0 + minutes(1)).allowed).toBe(false);
    });

    it('allows the same target again once the window passes', () => {
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        const after = T0 + LIMITS.perTargetSeconds * 1000 + 1000;
        expect(consumeRateLimit('ip-1', 'discord:hook-a', after).allowed).toBe(true);
    });

    it('leaves other targets unaffected', () => {
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        expect(consumeRateLimit('ip-1', 'discord:hook-b', T0).allowed).toBe(true);
    });
});

describe('behaviour', () => {
    it('claims the slot in the same pass as the check', () => {
        // The bug this replaces: check and record were separate calls with the outbound
        // Discord POST between them, so two parallel requests both passed the check before
        // either recorded and both sends went to the same destination.
        expect(consumeRateLimit('ip-1', 'target', T0).allowed).toBe(true);
        expect(consumeRateLimit('ip-2', 'target', T0).allowed).toBe(false);
    });

    it('refunds the destination when delivery fails, but not the client attempt', () => {
        expect(consumeRateLimit('ip-1', 'discord:hook-a', T0).allowed).toBe(true);
        refundTarget('discord:hook-a');

        // The destination was never messaged, so a corrected retry goes straight through
        expect(consumeRateLimit('ip-1', 'discord:hook-a', T0).allowed).toBe(true);
        refundTarget('discord:hook-a');

        // ...but the failed attempts still counted against the client's hourly allowance
        for (let i = 2; i < LIMITS.perClientPerHour; i++) {
            expect(consumeRateLimit('ip-1', `other-${i}`, T0).allowed).toBe(true);
        }
        expect(consumeRateLimit('ip-1', 'anything', T0).allowed).toBe(false);
    });

    it('refunding returns only the latest slot, leaving an earlier send counted', () => {
        const later = T0 + minutes(6);   // past the per-target window
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        consumeRateLimit('ip-2', 'discord:hook-a', later);
        refundTarget('discord:hook-a');

        // The T0 send is still on record; only the `later` one was handed back
        expect(consumeRateLimit('ip-3', 'discord:hook-a', later).allowed).toBe(true);
    });

    it('refunding an unknown destination is a no-op, not a crash', () => {
        expect(() => refundTarget('discord:never-seen')).not.toThrow();
    });

    it('reports a retry delay in whole units a user can act on', () => {
        consumeRateLimit('ip-1', 'discord:hook-a', T0);
        const result = consumeRateLimit('ip-1', 'discord:hook-a', T0 + minutes(4));
        expect(result.reason).toMatch(/1 minute\./);
    });
});

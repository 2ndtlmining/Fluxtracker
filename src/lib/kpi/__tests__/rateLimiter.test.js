import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, recordSend, resetRateLimits, LIMITS } from '../rateLimiter.js';

const T0 = Date.parse('2026-08-21T12:00:00Z');
const minutes = (n) => n * 60_000;
const hours = (n) => n * 3_600_000;

beforeEach(() => resetRateLimits());

describe('per-client limits', () => {
    it('allows up to the hourly limit', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) {
            // Different target each time so only the client limit is in play
            expect(checkRateLimit('ip-1', `target-${i}`, T0).allowed, `send ${i + 1}`).toBe(true);
            recordSend('ip-1', `target-${i}`, T0);
        }
        expect(checkRateLimit('ip-1', 'target-new', T0).allowed).toBe(false);
    });

    it('explains the hourly limit and when to retry', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) recordSend('ip-1', `t${i}`, T0);

        const result = checkRateLimit('ip-1', 'fresh', T0 + minutes(10));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/in the last hour/);
        expect(result.reason).toMatch(/50 minutes/);
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('frees up once the hour window slides past', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) recordSend('ip-1', `t${i}`, T0);
        expect(checkRateLimit('ip-1', 'fresh', T0 + hours(1) + 1000).allowed).toBe(true);
    });

    it('enforces the daily cap beyond the hourly one', () => {
        // Spread sends across the day so the hourly window never fills
        for (let i = 0; i < LIMITS.perClientPerDay; i++) {
            recordSend('ip-1', `t${i}`, T0 + minutes(i * 61));
        }
        const later = T0 + minutes(LIMITS.perClientPerDay * 61);
        const result = checkRateLimit('ip-1', 'fresh', later);
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/daily limit/);
    });

    it('tracks clients independently', () => {
        for (let i = 0; i < LIMITS.perClientPerHour; i++) recordSend('ip-1', `t${i}`, T0);
        expect(checkRateLimit('ip-1', 'x', T0).allowed).toBe(false);
        expect(checkRateLimit('ip-2', 'x', T0).allowed).toBe(true);
    });
});

describe('per-destination limit', () => {
    it('blocks a second send to the same target inside the window', () => {
        recordSend('ip-1', 'discord:hook-a', T0);
        const result = checkRateLimit('ip-1', 'discord:hook-a', T0 + minutes(1));
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/just sent to this destination/);
    });

    it('blocks a different client hitting the same target — stops harassment', () => {
        recordSend('ip-1', 'discord:hook-a', T0);
        expect(checkRateLimit('ip-2', 'discord:hook-a', T0 + minutes(1)).allowed).toBe(false);
    });

    it('allows the same target again once the window passes', () => {
        recordSend('ip-1', 'discord:hook-a', T0);
        const after = T0 + LIMITS.perTargetSeconds * 1000 + 1000;
        expect(checkRateLimit('ip-1', 'discord:hook-a', after).allowed).toBe(true);
    });

    it('leaves other targets unaffected', () => {
        recordSend('ip-1', 'discord:hook-a', T0);
        expect(checkRateLimit('ip-1', 'discord:hook-b', T0).allowed).toBe(true);
    });
});

describe('behaviour', () => {
    it('checking does not consume quota — only recordSend does', () => {
        for (let i = 0; i < 20; i++) {
            expect(checkRateLimit('ip-1', 'target', T0).allowed).toBe(true);
        }
    });

    it('reports a retry delay in whole units a user can act on', () => {
        recordSend('ip-1', 'discord:hook-a', T0);
        const result = checkRateLimit('ip-1', 'discord:hook-a', T0 + minutes(4));
        expect(result.reason).toMatch(/1 minute\./);
    });
});

import { describe, it, expect } from 'vitest';
import { shapeExpiredRunning } from '../analytics.js';

/**
 * /api/apps/expired-running response shape (spec 2026-10-06). The card reads `available`
 * first, so an uncomputable figure must say so rather than arrive as a plausible 0.
 */
describe('shapeExpiredRunning', () => {
    it('says unavailable rather than 0 when the figure could not be computed', () => {
        expect(shapeExpiredRunning(null)).toEqual({ available: false });
    });

    it('serves counts, the grace period in days and the top list without internals', () => {
        const shaped = shapeExpiredRunning({
            apps: 18, instances: 21, unresolved: 1, currentBlock: 3_012_176, computedAt: 1,
            top: [{ name: 'palworld1785555251684', instances: 1, daysExpired: 50, endBlock: 2_868_075 }]
        });
        expect(shaped).toEqual({
            available: true, apps: 18, instances: 21, unresolved: 1, graceDays: 1,
            top: [{ name: 'palworld1785555251684', instances: 1, daysExpired: 50 }]
        });
    });

    it('passes a real zero through', () => {
        expect(shapeExpiredRunning({ apps: 0, instances: 0, unresolved: 0, top: [] }))
            .toMatchObject({ available: true, apps: 0, top: [] });
    });
});

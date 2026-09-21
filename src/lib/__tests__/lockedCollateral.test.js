import { describe, it, expect } from 'vitest';
import { NODE_COLLATERAL, calculateLockedCollateral } from '../config.js';

/**
 * Issue #210 — FLUX locked as node collateral.
 *
 * Running a Flux node requires locking collateral, fixed per tier. The network-wide
 * locked supply is therefore the tier counts multiplied by their rates, which makes it a
 * pure function of three numbers the snapshot has recorded since day one.
 *
 * The invariant the whole feature rests on: the total is the SUM OF THE PARTS, computed
 * in one place. If the total were ever computed independently of the per-tier values, the
 * four columns could disagree and the graph would show a total that no breakdown explains.
 */

describe('NODE_COLLATERAL', () => {
    it('holds the per-tier collateral required to run a node', () => {
        expect(NODE_COLLATERAL).toEqual({ cumulus: 1000, nimbus: 12500, stratus: 40000 });
    });
});

describe('calculateLockedCollateral', () => {
    it('multiplies each tier count by its collateral rate', () => {
        const result = calculateLockedCollateral({ cumulus: 2, nimbus: 3, stratus: 4 });

        expect(result.locked_collateral_cumulus).toBe(2000);
        expect(result.locked_collateral_nimbus).toBe(37500);
        expect(result.locked_collateral_stratus).toBe(160000);
    });

    it('returns a total that is exactly the sum of the three tiers', () => {
        // The load-bearing invariant. A total computed any other way could drift from the
        // breakdown that is supposed to explain it.
        const result = calculateLockedCollateral({ cumulus: 2907, nimbus: 1578, stratus: 1692 });

        expect(result.locked_collateral).toBe(
            result.locked_collateral_cumulus
            + result.locked_collateral_nimbus
            + result.locked_collateral_stratus
        );
        expect(result.locked_collateral).toBe(2907 * 1000 + 1578 * 12500 + 1692 * 40000);
    });

    it('computes the real network figure for the measured tier counts', () => {
        // Live counts 2026-09-21. Pinned so a change to a rate or an operator precedence
        // shows up as a failing number rather than a plausible-looking one.
        const result = calculateLockedCollateral({ cumulus: 2907, nimbus: 1578, stratus: 1692 });

        expect(result.locked_collateral).toBe(90_312_000);   // ~90.3M FLUX locked
    });

    it('returns all four values as null when any tier count is missing', () => {
        // Node collection is all-or-nothing: fetchNodeStats writes the three counts
        // together or throws. A partial reading would understate the locked supply by a
        // whole tier -- and a 40,000-FLUX tier is most of it -- so absent must stay absent
        // rather than become a plausible smaller number.
        for (const partial of [
            { cumulus: 1, nimbus: 2 },
            { cumulus: 1, nimbus: 2, stratus: null },
            { cumulus: 1, nimbus: undefined, stratus: 3 },
            null
        ]) {
            expect(calculateLockedCollateral(partial)).toEqual({
                locked_collateral_cumulus: null,
                locked_collateral_nimbus: null,
                locked_collateral_stratus: null,
                locked_collateral: null
            });
        }
    });

    it('rejects a non-numeric tier count rather than coercing it', () => {
        expect(calculateLockedCollateral({ cumulus: '2907', nimbus: 1578, stratus: 1692 }))
            .toEqual({
                locked_collateral_cumulus: null,
                locked_collateral_nimbus: null,
                locked_collateral_stratus: null,
                locked_collateral: null
            });
    });

    it('accepts a genuine zero for a tier', () => {
        // Unlike a missing reading, zero nodes in a tier is a real (if unlikely) fact and
        // must not be confused with "not collected".
        const result = calculateLockedCollateral({ cumulus: 0, nimbus: 0, stratus: 1 });

        expect(result).toEqual({
            locked_collateral_cumulus: 0,
            locked_collateral_nimbus: 0,
            locked_collateral_stratus: 40000,
            locked_collateral: 40000
        });
    });
});

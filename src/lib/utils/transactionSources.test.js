import { describe, it, expect } from 'vitest';
import { serialiseSources, toggleSource } from './transactionSources.js';

/**
 * Issue #173: the badges and the data disagreed by exactly one click -- clearing Team still
 * showed Team's rows, selecting Team showed everything. The cause was reading a Svelte
 * reactive variable inside the click handler that had just reassigned its dependency;
 * Svelte 4 batches those until the next update cycle, so the handler saw the old value.
 *
 * These cover the pure logic. The ordering fix itself is in the component: the handler now
 * computes the parameter from the new Set and passes it to fetchTransactions, so there is
 * no reactive read left to be stale.
 */

describe('toggleSource', () => {
    it('adds a source that is not selected', () => {
        expect([...toggleSource(new Set(), 'team')]).toEqual(['team']);
    });

    it('removes a source that is already selected', () => {
        expect([...toggleSource(new Set(['team']), 'team')]).toEqual([]);
    });

    it('is additive -- the two badges combine rather than replace', () => {
        const both = toggleSource(new Set(['team']), 'fiat');
        expect([...both].sort()).toEqual(['fiat', 'team']);
    });

    it('removes only the clicked source, leaving the other active', () => {
        expect([...toggleSource(new Set(['team', 'fiat']), 'team')]).toEqual(['fiat']);
    });

    it('returns a NEW set -- Svelte 4 does not track Set mutation', () => {
        const before = new Set(['team']);
        const after = toggleSource(before, 'fiat');
        expect(after).not.toBe(before);
        expect([...before]).toEqual(['team']); // original untouched
    });

    it('round-trips back to empty', () => {
        let s = new Set();
        s = toggleSource(s, 'team');
        s = toggleSource(s, 'fiat');
        s = toggleSource(s, 'team');
        s = toggleSource(s, 'fiat');
        expect([...s]).toEqual([]);
    });
});

describe('serialiseSources', () => {
    it('returns an empty string for no filter', () => {
        expect(serialiseSources(new Set())).toBe('');
        expect(serialiseSources(null)).toBe('');
        expect(serialiseSources(undefined)).toBe('');
    });

    it('serialises a single source', () => {
        expect(serialiseSources(new Set(['team']))).toBe('team');
    });

    it('sorts, so click order cannot change the string', () => {
        expect(serialiseSources(new Set(['team', 'fiat']))).toBe('fiat,team');
        expect(serialiseSources(new Set(['fiat', 'team']))).toBe('fiat,team');
    });

    // The pairing that actually broke: the value must reflect the set handed in RIGHT NOW,
    // never a previously computed one. Calling it is what guarantees that.
    it('reflects the set it is given, including immediately after a toggle', () => {
        const before = new Set(['team']);
        expect(serialiseSources(before)).toBe('team');

        const after = toggleSource(before, 'team');
        expect(serialiseSources(after)).toBe('');          // cleared means cleared
        expect(serialiseSources(before)).toBe('team');     // and the old set is unchanged
    });
});

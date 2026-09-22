import { describe, it, expect } from 'vitest';
import {
    TRACKED_GAMES,
    GAME_COLUMN_BY_NAME,
    GAMING_REPOS,
    GAME_APP_PREFIXES,
    METRIC_COLUMNS
} from '../config.js';

/**
 * Issue #231 — the per-game columns are app-name counts now, not image-only ones.
 *
 * They used to be driven by GAMING_REPOS, which is the list of games with a *matchable
 * Docker image*. That structurally excluded every game deployed with an enterprise-
 * encrypted spec: RuneScape: Dragonwilds — the largest game on the network at 249
 * instances — had no column at all, and Valheim's column read 3 against a real 108.
 *
 * TRACKED_GAMES is the list that drives the columns now. These tests are the drift guard:
 * adding a game to either identification path without giving it a column would silently
 * drop it from the stored history again, which is exactly how this happened.
 */

describe('TRACKED_GAMES', () => {
    it('gives every image-matched game a column', () => {
        const missing = GAMING_REPOS.filter(r => !GAME_COLUMN_BY_NAME.has(r.name)).map(r => r.name);

        expect(missing, `GAMING_REPOS entries with no column: ${missing.join(', ')}`).toEqual([]);
    });

    it('gives every app-name-matched game a column', () => {
        // The regression itself: Dragonwilds, FiveM and Project Zomboid are prefix-only.
        const names = [...new Set(GAME_APP_PREFIXES.map(p => p.name))];
        const missing = names.filter(n => !GAME_COLUMN_BY_NAME.has(n));

        expect(missing, `GAME_APP_PREFIXES games with no column: ${missing.join(', ')}`).toEqual([]);
    });

    it('covers the games that only image keyword matching finds', () => {
        // Factorio reaches the breakdown through categorizeImage()'s keyword rule rather
        // than through either explicit list, and still needs somewhere to be stored.
        expect(GAME_COLUMN_BY_NAME.has('Factorio')).toBe(true);
    });

    it('has one column per game and no duplicates', () => {
        const keys = TRACKED_GAMES.map(g => g.dbKey);
        const names = TRACKED_GAMES.map(g => g.name);

        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names every column gaming_*', () => {
        const odd = TRACKED_GAMES.filter(g => !/^gaming_[a-z0-9_]+$/.test(g.dbKey)).map(g => g.dbKey);

        expect(odd).toEqual([]);
    });

    it('keeps the columns GAMING_REPOS already created, so no history is orphaned', () => {
        // Renaming an existing dbKey would strand years of stored values in a column
        // nothing reads any more.
        for (const repo of GAMING_REPOS) {
            expect(GAME_COLUMN_BY_NAME.get(repo.name)).toBe(repo.dbKey);
        }
    });

    it('persists every tracked game through METRIC_COLUMNS', () => {
        const missing = TRACKED_GAMES.filter(g => !METRIC_COLUMNS.includes(g.dbKey)).map(g => g.dbKey);

        expect(missing, `not persisted: ${missing.join(', ')}`).toEqual([]);
    });
});

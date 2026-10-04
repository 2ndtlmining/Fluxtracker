import { describe, it, expect } from 'vitest';
import { TRACKED_GAMES, GAME_APP_PREFIXES } from '../config.js';
import { GAME_ICONS, FALLBACK_GAME_ICON, gameIcon } from '../gameIcons.js';

/**
 * Issue #512 — every game in the Gaming breakdown gets a game-icons.net bullet.
 *
 * The drift guard: a game added to either identification path without an icon would quietly
 * render the joystick fallback instead of its own art, so a missing entry fails here.
 */
describe('gameIcons', () => {
    const names = [...new Set([...TRACKED_GAMES, ...GAME_APP_PREFIXES].map(g => g.name))];

    it('has an icon for every tracked game', () => {
        const missing = names.filter(n => !GAME_ICONS[n]);
        expect(missing, `games with no icon: ${missing.join(', ')}`).toEqual([]);
    });

    it('falls back to the joystick for an unknown game, never null', () => {
        expect(gameIcon('Some Browser Game')).toBe(FALLBACK_GAME_ICON);
        expect(gameIcon(undefined)).toBe(FALLBACK_GAME_ICON);
    });

    it('keeps each icon a single drawable path', () => {
        for (const { source, d } of [...Object.values(GAME_ICONS), FALLBACK_GAME_ICON]) {
            expect(source).toMatch(/^[a-z-]+\/[a-z0-9-]+$/);
            expect(d).toMatch(/^M[\d.]/);
        }
    });
});

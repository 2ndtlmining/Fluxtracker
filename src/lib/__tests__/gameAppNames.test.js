import { describe, it, expect } from 'vitest';
import { resolveGameFromAppName, GAME_APP_PREFIXES } from '../config.js';

/**
 * Issue #162/#163: a second way to recognise a game, by app name rather than image.
 *
 * Needed because Flux app specs can be enterprise-encrypted -- `compose: []` and no repotag
 * anywhere in globalappsspecifications -- so categorizeImage() structurally cannot see them.
 * Measured against the live network: image matching found 4 Valheim instances where 84 were
 * running, and zero of the 82 FiveM and 1 Dragonwilds instances.
 */
describe('resolveGameFromAppName', () => {
    it('identifies a game that has no readable image at all (the whole point)', () => {
        expect(resolveGameFromAppName('fivem1787211516616')).toBe('FiveM');
        expect(resolveGameFromAppName('dragonwilds1789155733040')).toBe('RuneScape: Dragonwilds');
    });

    it('totals every plan of one game under the canonical name', () => {
        // Minecraft ships java/bedrock as separate prefixes; splitting the card by plan
        // would answer a question nobody asked.
        for (const name of [
            'minecraftj1788000000000',
            'minecraftb1788000000000',
            'minecraftserver1788000000000',
            'minecraftbedrockserver1788000000000'
        ]) {
            expect(resolveGameFromAppName(name)).toBe('Minecraft');
        }
        expect(resolveGameFromAppName('rustserver1788000000000')).toBe('Rust');
        expect(resolveGameFromAppName('rustserveroxide1788000000000')).toBe('Rust');
    });

    // A shorter prefix must not shadow a longer one: matching "minecraftb" first would leave
    // "edrockserver1788..." to fail the digit anchor, dropping the app entirely rather than
    // merely mislabelling it.
    it('prefers the longest matching prefix', () => {
        expect(resolveGameFromAppName('minecraftbedrockserver1788000000000')).toBe('Minecraft');
        expect(resolveGameFromAppName('rustserveroxide1788000000000')).toBe('Rust');
    });

    it('requires the 13-digit timestamp, so a hand-named app is not swept in', () => {
        expect(resolveGameFromAppName('palworld16slots')).toBeNull();
        expect(resolveGameFromAppName('palworld')).toBeNull();
        expect(resolveGameFromAppName('palworldcommunityserver')).toBeNull();
        // Too few digits to be a Date.now().
        expect(resolveGameFromAppName('palworld12345')).toBeNull();
    });

    it('does not claim the non-game dedicated sites', () => {
        // WordPress, Hermes, n8n and OpenClaw deploy the same way but are not games; counting
        // them would make the gaming figure mean something other than its label.
        expect(resolveGameFromAppName('wordpress1788000000000')).toBeNull();
        expect(resolveGameFromAppName('hermesagent1788000000000')).toBeNull();
        expect(resolveGameFromAppName('n8nstarter1788000000000')).toBeNull();
        expect(resolveGameFromAppName('openclaw1788000000000')).toBeNull();
    });

    it('is case insensitive -- marketplace deploys keep their original casing', () => {
        expect(resolveGameFromAppName('FiveM1787211516616')).toBe('FiveM');
        expect(resolveGameFromAppName('DragonWilds1789155733040')).toBe('RuneScape: Dragonwilds');
    });

    it('handles missing input rather than throwing', () => {
        expect(resolveGameFromAppName('')).toBeNull();
        expect(resolveGameFromAppName(null)).toBeNull();
        expect(resolveGameFromAppName(undefined)).toBeNull();
    });

    it('every configured prefix actually resolves, so a typo cannot sit here unnoticed', () => {
        for (const { prefix, name } of GAME_APP_PREFIXES) {
            expect(resolveGameFromAppName(`${prefix}1788000000000`)).toBe(name);
        }
    });
});

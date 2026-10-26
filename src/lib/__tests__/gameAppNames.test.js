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
        // Issue #409: live names from the games hub, 2026-09-27.
        expect(resolveGameFromAppName('vrising1790333632959')).toBe('V Rising');
        expect(resolveGameFromAppName('vrising1790277053099')).toBe('V Rising');
        // Issue #496: live names from the games hub, 2026-09-30. Their specs are public today,
        // but the name must not depend on that.
        expect(resolveGameFromAppName('satisfactory1790517689678')).toBe('Satisfactory');
        expect(resolveGameFromAppName('factorio1790517689678')).toBe('Factorio');
        // Issue #505: live names from the games hub, 2026-10-03.
        expect(resolveGameFromAppName('7daystodie1790705531162')).toBe('7 Days to Die');
        expect(resolveGameFromAppName('7daystodie1790716527525')).toBe('7 Days to Die');
        // Issue #514: live names from the games hub, 2026-10-06. Encrypted specs, so the
        // name is the only thing that counts them -- and it is not 'ARK Survival' (Evolved).
        expect(resolveGameFromAppName('arksurvivalascended1791140248911')).toBe('ARK: Survival Ascended');
        expect(resolveGameFromAppName('arksurvivalascended1791211319721')).toBe('ARK: Survival Ascended');
        expect(resolveGameFromAppName('ark')).toBeNull();
        // Issue #518: live names from the games hub, 2026-10-07.
        expect(resolveGameFromAppName('hytale1791208306845')).toBe('Hytale');
        expect(resolveGameFromAppName('hytale1791278027708')).toBe('Hytale');
        // Issue #521: the live name from the games hub, 2026-10-08 (encrypted spec).
        expect(resolveGameFromAppName('armareforger1791371186445')).toBe('Arma Reforger');
        // Issue #524: the live name from the games hub, 2026-10-09 (encrypted spec).
        expect(resolveGameFromAppName('garrysmod1791592436724')).toBe("Garry's Mod");
        // Issue #525: the hub's shape, not live yet (2026-10-14).
        expect(resolveGameFromAppName('unturned1791700000000')).toBe('Unturned');
        // Issue #526: the hub's shape, not live yet (2026-10-14).
        expect(resolveGameFromAppName('dontstarvetogether1791800000000')).toBe("Don't Starve Together");
        // Issue #530: the hub's shape, not live yet (2026-10-15).
        expect(resolveGameFromAppName('corekeeper1791900000000')).toBe('Core Keeper');
        // Issue #535: the hub's shape, not live yet (2026-10-17).
        expect(resolveGameFromAppName('theisle1792200000000')).toBe('The Isle');
        // Issue #533: the hub's shape, not live yet (2026-10-17). Not Terraria's prefix.
        expect(resolveGameFromAppName('tmodloader1792200000000')).toBe('tModLoader');
        // Issue #538: the hub's two editions, not live yet (2026-10-18), are one game.
        expect(resolveGameFromAppName('eurotrucksimulator21792300000000')).toBe('Truck Simulator');
        expect(resolveGameFromAppName('americantrucksimulator1792300000000')).toBe('Truck Simulator');
        // Issue #540: the hub's shape, not live yet (2026-10-19).
        expect(resolveGameFromAppName('teamfortress21792400000000')).toBe('Team Fortress 2');
        // Issue #547: the hub's shape, not live yet (2026-10-22).
        expect(resolveGameFromAppName('vintagestory1792500000000')).toBe('Vintage Story');
        // Issue #549: the hub's shape, not live yet (2026-10-23).
        expect(resolveGameFromAppName('beammp1792600000000')).toBe('BeamMP');
        // Issue #556: the hub's shape, not live yet (2026-10-24).
        expect(resolveGameFromAppName('soulmask1792700000000')).toBe('Soulmask');
        // A hand-named server is not a hub deployment.
        expect(resolveGameFromAppName('soulmaskserver1')).not.toBe('Soulmask');
        // Conan Exiles: the hub's shape, not live yet (2026-10-25).
        expect(resolveGameFromAppName('conanexiles1792800000000')).toBe('Conan Exiles');
        expect(resolveGameFromAppName('conanexilesserver1')).not.toBe('Conan Exiles');
        // Sons of the Forest: the hub's shape, not live yet (2026-10-26).
        expect(resolveGameFromAppName('sonsoftheforest1792900000000')).toBe('Sons of the Forest');
        expect(resolveGameFromAppName('sonsoftheforestserver1')).not.toBe('Sons of the Forest');
        // Counter-Strike 2: the hub's shape, not live yet (2026-10-27).
        expect(resolveGameFromAppName('counterstrike21792900000000')).toBe('Counter-Strike 2');
        expect(resolveGameFromAppName('counterstrike2server1')).not.toBe('Counter-Strike 2');
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

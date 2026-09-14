import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #162/#163: per-game instance counts that combine both identification paths.
 *
 * Neither path alone is correct. Measured against the live network:
 *   - Valheim: image matching finds 4, app names find 80, and they overlap by ZERO -- the 4
 *     are marketplace deploys with unprefixed names, the 80 are site deploys with encrypted
 *     specs. The true figure is 84.
 *   - Minecraft is the reverse: images find 61, app names 53, true figure 61.
 *   - FiveM: images find 0 of 82.
 *
 * So the count is a per-CONTAINER union: each running container contributes exactly once,
 * labelled by whichever path identifies it. Counting per path and adding would double count
 * every container both paths can see.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn(async () => {}),
    resolveRunningAppName: vi.fn()
}));

import { resilientFetch } from '../resilientFetch.js';
import { resolveRunningAppName } from '../appSpecsCache.js';
import { getRunningApps, clearRunningAppsCache, countGames } from '../runningAppsProvider.js';

/** One node document carrying the given container names. */
function node(...names) {
    return { apps: { runningapps: names.map(n => ({ Names: [n] })) } };
}

// A non-game app that always resolves to an image. Every fixture carries one because the
// provider deliberately throws when NOTHING resolves -- that means globalappsspecifications
// is unavailable, which would otherwise have crypto/wordpress/cloud silently write zeros.
// A real network always has resolvable apps; a fixture without any is testing an outage.
const FILLER = '/fluxpresearch_filler';

function mockNetwork(nodes, imageByContainer = {}) {
    const withFiller = [...nodes, { apps: { runningapps: [{ Names: [FILLER] }] } }];
    resilientFetch.mockResolvedValue({ status: 'success', data: withFiller });
    resolveRunningAppName.mockImplementation(containerName => {
        if (containerName === FILLER) return { appName: 'filler', repotag: 'presearch/node:latest' };
        const repotag = imageByContainer[containerName];
        return repotag ? { appName: containerName, repotag } : null;
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    clearRunningAppsCache();
});

describe('countGames', () => {
    it('counts a game whose spec is encrypted and has no image', async () => {
        // Nothing resolves to a repotag -- exactly the FiveM situation.
        mockNetwork([node('/fluxfivem1787211516616', '/fluxfivem1787295903549')], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('FiveM')).toBe(2);
    });

    it('counts a game identified only by its image', async () => {
        mockNetwork([node('/fluxsomeoldvalheimbox')], {
            '/fluxsomeoldvalheimbox': 'mbround18/valheim:latest'
        });
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Valheim')).toBe(1);
    });

    it('counts a container ONCE when both paths identify it', async () => {
        // The overlap case: a site-deployed Palworld whose spec is also readable.
        mockNetwork([node('/fluxpalworld_palworld1788108278166')], {
            '/fluxpalworld_palworld1788108278166': 'runonflux/palworld-server-flux:latest'
        });
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Palworld')).toBe(1);
    });

    it('unions the two paths instead of adding them', async () => {
        // Mirrors Valheim's real shape: image-only and name-only instances, zero overlap.
        mockNetwork(
            [node(
                '/fluxvalheim1788000000000',      // site deploy, encrypted
                '/fluxvalheim1788000000001',      // site deploy, encrypted
                '/fluxlegacyvalheimserver'        // marketplace deploy, readable image
            )],
            { '/fluxlegacyvalheimserver': 'mbround18/valheim:latest' }
        );
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Valheim')).toBe(3);
    });

    it('prefers the app-name label when the two paths disagree', async () => {
        // The site is authoritative about which game it deployed. A bedrock image under a
        // java-plan name must not split one game into two rows.
        mockNetwork([node('/fluxminecraftb1788000000000')], {
            '/fluxminecraftb1788000000000': 'itzg/minecraft-bedrock-server:latest'
        });
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Minecraft')).toBe(1);
        expect([...games.keys()]).toEqual(['Minecraft']);
    });

    it('merges plan variants of one game into a single total', async () => {
        mockNetwork([node(
            '/fluxminecraftj1788000000000',
            '/fluxminecraftb1788000000001',
            '/fluxminecraftbedrockserver1788000000002'
        )], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Minecraft')).toBe(3);
    });

    it('ignores non-game containers entirely', async () => {
        mockNetwork([node(
            '/fluxwordpress1788000000000',        // dedicated site, but not a game
            '/fluxwatchtower',                    // infrastructure
            '/fluxpresearch_somenode'             // crypto
        )], { '/fluxpresearch_somenode': 'presearch/node:latest' });
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.size).toBe(0);
    });

    it('counts the same game across different nodes', async () => {
        mockNetwork([
            node('/fluxpalworld_palworld1788000000000'),
            node('/fluxpalworld_palworld1788000000001'),
            node('/fluxpalworld_palworld1788000000002')
        ], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Palworld')).toBe(3);
    });

    it('strips the component segment before matching the app name', async () => {
        // Real container names carry a component prefix: fluxpalworldpalworld_palworld<ts>.
        mockNetwork([node('/fluxpalworldpalworld_palworld1785869615115')], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Palworld')).toBe(1);
    });

    // ---------------------------------------------------------------
    // Multi-component apps: sidecars are not instances of the game
    // ---------------------------------------------------------------
    // FiveM is a compose app. Every placement runs `operator` + `mariadb`, and the actual
    // `fivem` game server runs on only ONE of the three nodes. Counting containers reported
    // 84 FiveM "instances" where 12 game servers were running -- a 7x overcount.
    //
    // The image path never had this problem: mariadb and operator carry non-game images, so
    // categorizeImage() ignores them. The app-name path sees the SAME app name on every
    // component, so it needs the equivalent rule -- the same idea as CATEGORY_EXCLUDE, which
    // already drops the *-server-website companion frontends.
    it('counts the game server, not its database and operator sidecars', async () => {
        mockNetwork([
            // One FiveM app spread over three nodes, exactly as observed live.
            node('/fluxoperator_fivem1788120258844', '/fluxmariadb_fivem1788120258844', '/fluxfivem_fivem1788120258844'),
            node('/fluxoperator_fivem1788120258844', '/fluxmariadb_fivem1788120258844'),
            node('/fluxoperator_fivem1788120258844', '/fluxmariadb_fivem1788120258844')
        ], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('FiveM')).toBe(1);
    });

    it('drops the companion website component, as the image path already does', async () => {
        mockNetwork([node(
            '/fluxvalheimvalheim_valheim1788000000000',
            '/fluxvalheimwebsite_valheim1788000000000'
        )], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Valheim')).toBe(1);
    });

    it('still counts a game whose component name differs from its plan prefix', async () => {
        // App "minecraftj<ts>" runs a component called "minecraftserver" -- the component
        // name is not derivable from the prefix, so the rule must be an exclusion of known
        // helpers, not a requirement that the component match the game.
        mockNetwork([node('/fluxminecraftserver_minecraftj1788000000000')], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Minecraft')).toBe(1);
    });

    it('counts one game server per node when the game really is replicated', async () => {
        // Palworld is single-component and genuinely runs one container per placement --
        // the helper rule must not collapse those into one.
        mockNetwork([
            node('/fluxpalworld_palworld1788000000000'),
            node('/fluxpalworld_palworld1788000000000')
        ], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect(games.get('Palworld')).toBe(2);
    });

    it('returns counts sorted high to low, for a top-N card', async () => {
        mockNetwork([node(
            '/fluxfivem1788000000000',
            '/fluxpalworld_palworld1788000000001',
            '/fluxpalworld_palworld1788000000002',
            '/fluxpalworld_palworld1788000000003',
            '/fluxvalheim1788000000004',
            '/fluxvalheim1788000000005'
        )], {});
        const games = countGames(await getRunningApps({ force: true }));
        expect([...games.entries()]).toEqual([['Palworld', 3], ['Valheim', 2], ['FiveM', 1]]);
    });
});

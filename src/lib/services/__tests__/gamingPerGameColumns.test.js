import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #231 — what fetchGamingStats() writes into the per-game columns.
 *
 * It used countConfiguredRepos(runningApps, GAMING_REPOS), which counts by Docker image
 * only. Every game deployed with an enterprise-encrypted spec was invisible to it:
 * gaming_valheim stored 3 against a real 108, and RuneScape: Dragonwilds — the largest
 * game on the network — had no column to store anything in.
 *
 * The columns now take the same app-name-aware per-game counts the Gaming card and
 * game_snapshots use, so all three agree.
 */

vi.mock('../../db/database.js', () => ({
    updateCurrentMetrics: vi.fn(),
    updateSyncStatus: vi.fn()
}));
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: vi.fn(),
    countByCategory: vi.fn(() => 40),
    countConfiguredRepos: vi.fn(() => ({ gaming_valheim: 3, gaming_palworld: 227 })),
    countGames: vi.fn(),
    countGamingInstances: vi.fn(() => 695)
}));

import { updateCurrentMetrics } from '../../db/database.js';
import { getRunningApps, countGames } from '../runningAppsProvider.js';
import { fetchGamingStats } from '../gamingService.js';

/** The live breakdown, as countGames() returns it: canonical name -> instances. */
const liveBreakdown = new Map([
    ['RuneScape: Dragonwilds', 249],
    ['Palworld', 227],
    ['Valheim', 108],
    ['Minecraft', 62],
    ['FiveM', 12],
    ['Rust', 8],
    ['Project Zomboid', 7]
]);

beforeEach(() => {
    vi.clearAllMocks();
    getRunningApps.mockResolvedValue({ fetchedAt: Date.now() });
    countGames.mockReturnValue(liveBreakdown);
});

const written = () => updateCurrentMetrics.mock.calls[0][0];

describe('fetchGamingStats per-game columns (issue #231)', () => {
    it('stores the app-name-aware count, not the image-only one', async () => {
        await fetchGamingStats();

        // The headline regression: 108 running, 3 visible by image.
        expect(written().gaming_valheim).toBe(108);
    });

    it('stores games that have no matchable image at all', async () => {
        await fetchGamingStats();

        expect(written().gaming_dragonwilds).toBe(249);
        expect(written().gaming_fivem).toBe(12);
        expect(written().gaming_project_zomboid).toBe(7);
    });

    it('agrees with the Gaming card for every game in the breakdown', async () => {
        await fetchGamingStats();

        const row = written();
        expect(row.gaming_palworld).toBe(227);
        expect(row.gaming_minecraft).toBe(62);
        expect(row.gaming_rust).toBe(8);
    });

    it('writes 0 for a tracked game absent from the breakdown', async () => {
        // Absent from a successful breakdown means it genuinely ran nothing, which is a
        // real reading of zero -- distinct from the NULL that means "not collected".
        await fetchGamingStats();

        expect(written().gaming_terraria).toBe(0);
    });

    it('still records both gaming totals', async () => {
        await fetchGamingStats();

        expect(written().gaming_apps_total).toBe(40);
        expect(written().gaming_instances_total).toBe(695);
    });

    it('ignores a game with no column rather than inventing a key', async () => {
        countGames.mockReturnValue(new Map([['Some Brand New Game', 5], ['Valheim', 108]]));

        await fetchGamingStats();

        const row = written();
        expect(row.gaming_valheim).toBe(108);
        expect(Object.keys(row).some(k => k.toLowerCase().includes('brand'))).toBe(false);
    });
});

// Historical data endpoints: full snapshot history, daily revenue history, Docker repo
// history, and category history. Mounted at '/api/history' in server.js.
import express from 'express';

import {
    getSnapshotsInRange,
    getLastNSnapshots,
    getDailyRevenueFromTransactions,
    getDailyRevenueInRange,
    getDailyRevenueUSDFromTransactions,
    getDailyRevenueUSDInRange,
    getDailyRevenueFromAddressesInRange,
    getDailyRevenueUSDFromAddressesInRange,
    getDistinctRepos,
    getRepoHistory,
    getLatestRepoSnapshot,
    getCategoryHistory,
    getReposByCategory,
    getGameSnapshotHistory
} from '../../lib/db/database.js';

import { getDisplayName, CATEGORY_CONFIG, FLUX_TEAM_ADDRESSES } from '../../lib/config.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';
import { createLogger } from '../../lib/logger.js';

const router = express.Router();
const log = createLogger('server');

const revenueCache = createCache(300_000); // 5 min

// Enhanced endpoint with full snapshot data for charts
router.get('/snapshots/full', async (req, res) => {
    try {
        const { limit, start_date, end_date } = req.query;

        // Get snapshots using existing function
        const snapshots = (start_date && end_date)
            ? await getSnapshotsInRange(start_date, end_date)
            : await getLastNSnapshots(parseInt(limit) || 30);

        // Return FULL snapshot data (not summarized)
        res.json({
            count: snapshots.length,
            data: snapshots
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// NEW: Endpoint to get daily revenue from transactions (not snapshots)
router.get('/revenue/daily', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `daily:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const revenueData = (start_date && end_date)
            ? await getDailyRevenueInRange(start_date, end_date)
            : await getDailyRevenueFromTransactions(parseInt(limit) || 30);
        return { count: revenueData.length, data: revenueData };
    });
});

// Endpoint to get daily revenue in USD from transactions
router.get('/revenue/daily-usd', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `daily-usd:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const revenueData = (start_date && end_date)
            ? await getDailyRevenueUSDInRange(start_date, end_date)
            : await getDailyRevenueUSDFromTransactions(parseInt(limit) || 30);
        return { count: revenueData.length, data: revenueData };
    });
});

// Team Funded historical trend (issue #146): daily FLUX + USD revenue from
// FLUX_TEAM_ADDRESSES, merged by date. Transaction-based (not snapshot-based), so full
// history is available immediately rather than only from the day snapshotting started.
router.get('/revenue/team-funded/daily', async (req, res) => {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
        return res.status(400).json({ error: 'start_date and end_date query parameters are required' });
    }

    const cacheKey = `team-funded:${start_date}:${end_date}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const [fluxRows, usdRows] = await Promise.all([
            getDailyRevenueFromAddressesInRange(start_date, end_date, FLUX_TEAM_ADDRESSES),
            getDailyRevenueUSDFromAddressesInRange(start_date, end_date, FLUX_TEAM_ADDRESSES)
        ]);

        const byDate = new Map();
        for (const row of fluxRows) {
            byDate.set(row.date, { date: row.date, daily_revenue: row.daily_revenue, daily_revenue_usd: 0 });
        }
        for (const row of usdRows) {
            const existing = byDate.get(row.date);
            if (existing) {
                existing.daily_revenue_usd = row.daily_revenue_usd;
            } else {
                byDate.set(row.date, { date: row.date, daily_revenue: 0, daily_revenue_usd: row.daily_revenue_usd });
            }
        }

        const history = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        return { count: history.length, data: history };
    });
});

// Historical snapshots
router.get('/snapshots', async (req, res) => {
    const { limit, start_date, end_date } = req.query;
    const cacheKey = `snapshots:${start_date || ''}:${end_date || ''}:${limit || 30}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const snapshots = (start_date && end_date)
            ? await getSnapshotsInRange(start_date, end_date)
            : await getLastNSnapshots(parseInt(limit) || 30);

        return {
            count: snapshots.length,
            data: snapshots.map(s => ({
                date: s.snapshot_date,
                revenue: s.daily_revenue,
                nodes: { total: s.node_total, cumulus: s.node_cumulus, nimbus: s.node_nimbus },
                apps: {
                    total: s.total_apps,
                    gaming: s.gaming_apps_total,
                    crypto: s.crypto_nodes_total,
                    gitapps: s.gitapps_count || 0,
                    dockerapps: s.dockerapps_count || 0
                }
            }))
        };
    });
});

/**
 * Per-game history for the Historical Performance chart's Gaming category (issue #175).
 *
 * ONE fetch serves the whole category -- the total line and every per-game line -- so
 * switching games in the dropdown is a client-side re-derive with no network round trip.
 * Same shape of deal as /api/decentralization/history.
 *
 * `games` is derived from the data rather than from GAME_APP_PREFIXES: the game set is
 * open-ended, so a newly-tracked dedicated site appears in the dropdown on its own.
 *
 * Both reads are isolated. A Supabase instance without migration 013 applied throws
 * "relation does not exist" for game_snapshots, and that must degrade to an empty series
 * rather than 500 the whole category -- the same failure mode already handled in
 * /api/decentralization/history for migration 009.
 */
router.get('/games', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 90, 1), 3650);
    const cacheKey = `games:${days}`;

    return withDbFallback(revenueCache, cacheKey, res, async () => {
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

        const [rows, snapshots] = await Promise.all([
            getGameSnapshotHistory(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'per-game history unavailable, continuing without it');
                return [];
            }),
            getSnapshotsInRange(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'gaming total history unavailable, continuing without it');
                return [];
            })
        ]);

        return shapeGameHistory(rows, snapshots);
    });
});

/**
 * Pure shaping for /api/history/games -- exported so the ordering and the NULL handling can
 * be tested without standing up Express (same reason revenue.js exports
 * resolveSourceAddresses).
 *
 * @param {Array<{snapshot_date: string, game_name: string, instance_count: number}>} rows
 * @param {Array<{snapshot_date: string, gaming_instances_total: ?number}>} snapshots
 */
export function shapeGameHistory(rows, snapshots) {
    // Most recent count per game decides dropdown order, so the list reads the same way the
    // Gaming card does -- biggest game first. rows arrive date-ascending, so a plain
    // overwrite leaves the latest reading in place.
    const latestByGame = new Map();
    for (const r of rows) latestByGame.set(r.game_name, r.instance_count);
    const games = [...latestByGame.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name);

    return {
        games,
        history: rows.map(r => ({ date: r.snapshot_date, game: r.game_name, count: r.instance_count })),
        // NULL is dropped, never coerced to 0: every row written before migration 012 has no
        // reading at all, and a fabricated zero would draw as "no games ran that day".
        total: snapshots
            .filter(s => s.gaming_instances_total != null)
            .map(s => ({ date: s.snapshot_date, count: s.gaming_instances_total }))
    };
}

// Docker repo history endpoints
router.get('/repos/list', async (req, res) => {
    try {
        const repos = await getDistinctRepos();
        res.json({ count: repos.length, data: repos });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/repos/history', async (req, res) => {
    try {
        const { image, limit } = req.query;
        if (!image) {
            return res.status(400).json({ error: 'image query parameter is required' });
        }
        const history = await getRepoHistory(image, parseInt(limit) || 90);
        res.json({ count: history.length, data: history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/repos/latest', async (req, res) => {
    try {
        const repos = await getLatestRepoSnapshot();
        res.json({ count: repos.length, data: repos });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Category history (aggregated daily totals, used by charts)
router.get('/category/:category', async (req, res) => {
    try {
        const { category } = req.params;
        const limit = parseInt(req.query.limit) || 90;

        if (!CATEGORY_CONFIG[category]) {
            return res.status(400).json({ error: `Unknown category: ${category}` });
        }

        const history = await getCategoryHistory(category, limit);
        res.json({ count: history.length, data: history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// List repos in a category (for chart dropdown)
router.get('/category/:category/repos', async (req, res) => {
    try {
        const { category } = req.params;
        if (!CATEGORY_CONFIG[category]) {
            return res.status(400).json({ error: `Unknown category: ${category}` });
        }

        const repos = await getReposByCategory(category);

        // Deduplicate by displayName — multiple images can map to the same game/app
        // (e.g. mbround18/valheim, littlestache/valheim-flux both → "Valheim")
        const seen = new Map();
        for (const r of repos) {
            const displayName = getDisplayName(r.image_name);
            if (!seen.has(displayName)) {
                seen.set(displayName, { image_name: r.image_name, displayName });
            }
        }
        const deduplicated = [...seen.values()];

        res.json({ count: deduplicated.length, data: deduplicated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;

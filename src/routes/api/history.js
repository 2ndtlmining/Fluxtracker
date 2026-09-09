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
    getDistinctRepos,
    getRepoHistory,
    getLatestRepoSnapshot,
    getCategoryHistory,
    getReposByCategory
} from '../../lib/db/database.js';

import { getDisplayName, CATEGORY_CONFIG } from '../../lib/config.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';

const router = express.Router();

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

// Live dashboard cards' data sources: carousel stats, app activity, busiest node,
// decentralization. Mounted at '/api' in server.js (no common sub-prefix).
import express from 'express';

import { getSnapshotsInRange, getDecentralizationSnapshotHistory } from '../../lib/db/database.js';
import { getCachedCarouselData, getCachedDeployedApps, getCachedExpiringApps, getFluxCloudActivity } from '../../lib/services/carouselService.js';
import { getBusiestNode } from '../../lib/services/busiestNodeService.js';
import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('server');
const router = express.Router();

router.get('/carousel/stats', (req, res) => {
    try {
        const result = getCachedCarouselData();  // ✅ New function

        res.json({
            stats: result.stats || [],  // ✅ New field name
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error({ err: error }, 'carousel API error');

        res.status(500).json({
            error: 'Failed to fetch carousel stats',
            message: error.message,
            stats: [],
            cached: false
        });
    }
});

// Busiest Node card (issue #108) — on-demand fetch-if-stale, same pattern as the carousel
// endpoints above, just on its own (slower) TTL.
router.get('/busiest-node', async (req, res) => {
    try {
        const node = await getBusiestNode();
        res.json({ node, timestamp: new Date().toISOString() });
    } catch (error) {
        log.error({ err: error }, 'busiest node API error');
        res.status(500).json({
            error: 'Failed to fetch busiest node',
            message: error.message,
            node: null
        });
    }
});

// Decentralization metric (issue #108) — the scheduler (servicesScheduler.js) refreshes
// this in the background every 5 minutes; this just returns the cached snapshot instantly.
router.get('/decentralization', async (req, res) => {
    try {
        const stats = await getDecentralizationStats();
        res.json({ ...stats, timestamp: new Date().toISOString() });
    } catch (error) {
        log.error({ err: error }, 'decentralization stats API error');
        res.status(500).json({
            error: 'Failed to fetch decentralization stats',
            message: error.message
        });
    }
});

// Decentralization historical data (issue #108 Phase 3) -- backs the CSV export in
// DecentralizationCard.svelte. `days` mirrors Chart.svelte's own timeframe options.
router.get('/decentralization/history', async (req, res) => {
    try {
        const days = Math.max(1, parseInt(req.query.days) || 90);
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];

        const [breakdown, snapshots] = await Promise.all([
            getDecentralizationSnapshotHistory(startDate, endDate),
            getSnapshotsInRange(startDate, endDate)
        ]);

        const headline = snapshots
            .filter(s => s.decentralization_datacenter_percent != null)
            .map(s => ({
                date: s.snapshot_date,
                datacenterCount: s.decentralization_datacenter_count,
                independentCount: s.decentralization_independent_count,
                datacenterPercent: s.decentralization_datacenter_percent,
                totalNodes: s.node_total
            }));

        res.json({
            history: breakdown.map(r => ({ date: r.snapshot_date, org: r.org, count: r.node_count })),
            headline
        });
    } catch (error) {
        log.error({ err: error }, 'decentralization history API error');
        res.status(500).json({ error: 'Failed to fetch decentralization history', message: error.message });
    }
});

// Carousel endpoint for latest deployed apps
router.get('/carousel/deployed', async (req, res) => {
    try {
        const result = await getCachedDeployedApps();

        res.json({
            stats: result.stats || [],
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error({ err: error }, 'deployed apps API error');

        res.status(500).json({
            error: 'Failed to fetch deployed apps',
            message: error.message,
            stats: [],
            cached: false
        });
    }
});

// Carousel endpoint for expiring soon apps
router.get('/carousel/expiring', async (req, res) => {
    try {
        const result = await getCachedExpiringApps();
        res.json({
            stats: result.stats || [],
            cached: result.cached,
            cacheAge: result.cacheAge,
            fresh: result.fresh,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log.error({ err: error }, 'expiring apps API error');
        res.status(500).json({ error: 'Failed to fetch expiring apps', message: error.message, stats: [], cached: false });
    }
});

// Deduped deployed/expiring counts for the Total App Instances card (item 3 of the
// decentralization follow-ups) -- same getFluxCloudActivity() the KPI report and the
// daily snapshot collector use, so this card's numbers can never disagree with theirs.
router.get('/apps/activity', async (req, res) => {
    try {
        const activity = await getFluxCloudActivity();
        res.json({
            deployedToday: {
                cached: activity.deployedToday.cached,
                count: activity.deployedToday.cached ? activity.deployedToday.apps.length : null
            },
            expiring24h: {
                cached: activity.expiring24h.cached,
                count: activity.expiring24h.cached ? activity.expiring24h.apps.length : null
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        log.error({ err: error }, 'apps activity API error');
        res.status(500).json({ error: 'Failed to fetch apps activity', message: error.message });
    }
});

export default router;

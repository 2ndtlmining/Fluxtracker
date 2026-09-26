// Live dashboard cards' data sources: carousel stats, app activity, busiest node,
// decentralization. Mounted at '/api' in server.js (no common sub-prefix).
import express from 'express';

import {
    getSnapshotsInRange,
    getDecentralizationSnapshotHistory,
    getDecentralizationCountrySnapshotHistory,
    getDecentralizationContinentSnapshotHistory
} from '../../lib/db/database.js';
import { getCachedCarouselData, getCachedDeployedApps, getCachedExpiringApps, getCachedMissingDeployments, getFluxCloudActivity } from '../../lib/services/carouselService.js';
import { getBusiestNode, getCachedNodeContinents } from '../../lib/services/busiestNodeService.js';
import { classifyDeployment } from '../../lib/services/revenueService.js';
import { getSharedFluxApiData } from '../../lib/services/carouselService.js';
import { continentDemand, demandVsSupply } from '../../lib/utils/geoDemand.js';
import { createCache, withDbFallback } from '../../lib/serverHelpers.js';
import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('server');
const router = express.Router();
const demandCache = createCache(10 * 60_000); // 10 min -- both inputs refresh hourly
// Issue #384: the history is written once a day, so 10 minutes is plenty; it was the only
// history read with no cache at all, paging three tables 1,000 rows at a time per request.
const decentralizationHistoryCache = createCache(10 * 60_000);

router.get('/carousel/stats', (req, res) => {
    try {
        const result = getCachedCarouselData();  // ✅ New function

        res.json({
            stats: result.stats || [],  // ✅ New field name
            cached: result.cached,
            // fetchedAt, not a per-request cacheAge/timestamp: a body that changes on every
            // request can never match its ETag, so every poll was a full 200 (issue #383).
            fetchedAt: result.fetchedAt,
            fresh: result.fresh
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
        res.json({ node });
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
        res.json(stats);
    } catch (error) {
        log.error({ err: error }, 'decentralization stats API error');
        res.status(500).json({
            error: 'Failed to fetch decentralization stats',
            message: error.message
        });
    }
});

// Geographic demand vs supply (issue #268): where region-locked apps are allowed to run,
// beside where the nodes are, per continent. Both inputs are already fetched and cached
// (the app registry, the hourly node list), so this makes no upstream call of its own
// beyond warming those caches. available:false when the node list has never loaded.
router.get('/decentralization/demand', async (req, res) => {
    return withDbFallback(demandCache, 'demand', res, async () => {
        try {
            await getBusiestNode();
        } catch (error) {
            log.warn('Node list unavailable for demand vs supply: %s', error.message);
        }
        const nodes = getCachedNodeContinents();
        if (!nodes || nodes.located === 0) return { available: false };
        const { currentBlockHeight, appsData } = await getSharedFluxApiData();
        const demand = continentDemand(appsData, currentBlockHeight);
        return {
            available: true,
            continents: demandVsSupply(demand.instances, nodes.counts),
            restrictedApps: demand.restrictedApps,
            runningApps: demand.runningApps,
            excludeOnlyApps: demand.excludeOnlyApps,
            nodesLocated: nodes.located,
            nodesTotal: nodes.total,
            generatedAt: Date.now()
        };
    });
});

// Decentralization historical data (issue #108 Phase 3, country/continent added in #138)
// -- backs the CSV export and chart in DecentralizationCard.svelte. `days` mirrors
// Chart.svelte's own timeframe options.
router.get('/decentralization/history', async (req, res) => {
    try {
        const days = Math.min(Math.max(1, parseInt(req.query.days) || 90), 3650); // bounded (#295)
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().split('T')[0];
        const cacheKey = `history:${days}:${endDate}`;
        const hit = decentralizationHistoryCache.get(cacheKey);
        if (hit) return res.json(hit);

        // Each read isolated in its own try/catch: a Supabase instance where migration
        // 009_decentralization_country_continent.sql hasn't been applied yet would throw
        // "relation does not exist" for the two new tables and reject the whole Promise.all,
        // 500ing the org breakdown and CSV export that have worked since #108 Phase 3 -- the
        // exact failure mode already fixed for the comparison endpoint after issue #138
        // shipped (see analytics.js). A missing dimension here degrades to an empty array
        // instead of taking the others down with it.
        const [breakdown, countryBreakdown, continentBreakdown, snapshots] = await Promise.all([
            getDecentralizationSnapshotHistory(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'decentralization org history unavailable, continuing without it');
                return [];
            }),
            getDecentralizationCountrySnapshotHistory(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'decentralization country history unavailable, continuing without it');
                return [];
            }),
            getDecentralizationContinentSnapshotHistory(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'decentralization continent history unavailable, continuing without it');
                return [];
            }),
            getSnapshotsInRange(startDate, endDate).catch(error => {
                log.warn({ err: error }, 'decentralization headline snapshots unavailable, continuing without it');
                return [];
            })
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

        const body = {
            history: breakdown.map(r => ({ date: r.snapshot_date, org: r.org, count: r.node_count })),
            countryHistory: countryBreakdown.map(r => ({ date: r.snapshot_date, country: r.country, countryCode: r.country_code, count: r.node_count })),
            continentHistory: continentBreakdown.map(r => ({ date: r.snapshot_date, continent: r.continent, continentCode: r.continent_code, count: r.node_count })),
            headline
        };
        decentralizationHistoryCache.set(cacheKey, body);
        res.json(body);
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
            // fetchedAt, not a per-request cacheAge/timestamp: a body that changes on every
            // request can never match its ETag, so every poll was a full 200 (issue #383).
            fetchedAt: result.fetchedAt,
            fresh: result.fresh
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

// Carousel endpoint for apps not running everything they ordered (issue #213)
router.get('/carousel/missing', async (req, res) => {
    try {
        const result = await getCachedMissingDeployments();
        res.json({
            stats: result.stats || [],
            cached: result.cached,
            // fetchedAt, not a per-request cacheAge/timestamp: a body that changes on every
            // request can never match its ETag, so every poll was a full 200 (issue #383).
            fetchedAt: result.fetchedAt,
            fresh: result.fresh
        });
    } catch (error) {
        log.error({ err: error }, 'missing deployments API error');
        res.status(500).json({ error: 'Failed to fetch missing deployments', message: error.message, stats: [], cached: false });
    }
});

// Carousel endpoint for expiring soon apps
router.get('/carousel/expiring', async (req, res) => {
    try {
        const result = await getCachedExpiringApps();
        res.json({
            stats: result.stats || [],
            cached: result.cached,
            // fetchedAt, not a per-request cacheAge/timestamp: a body that changes on every
            // request can never match its ETag, so every poll was a full 200 (issue #383).
            fetchedAt: result.fetchedAt,
            fresh: result.fresh
        });
    } catch (error) {
        log.error({ err: error }, 'expiring apps API error');
        res.status(500).json({ error: 'Failed to fetch expiring apps', message: error.message, stats: [], cached: false });
    }
});

// Issue #400: of the apps deployed or updated in the last 24h, how many are brand new (their
// registration is inside the day, even if updated again since) vs renewals/updates of apps
// already running. Read from the permanent-message cache the revenue sync keeps warm -- this
// endpoint is polled by every viewer and never downloads anything itself. Null (no split
// shown) while that cache is cold, so the two parts always add up to the total.
function splitNewVsUpdated(apps) {
    let newCount = 0;
    let updatedCount = 0;
    for (const app of apps) {
        const currentHeight = Number(app.height) + Number(app.blockAge);
        const kind = classifyDeployment(app.name, currentHeight - BLOCKS_PER_DAY);
        if (kind === 'new') newCount++;
        else if (kind === 'updated') updatedCount++;
        else return null;
    }
    return { newCount, updatedCount };
}
const BLOCKS_PER_DAY = 2880;

// Deduped deployed/expiring counts for the Total App Instances card (item 3 of the
// decentralization follow-ups) -- same getFluxCloudActivity() the KPI report and the
// daily snapshot collector use, so this card's numbers can never disagree with theirs.
router.get('/apps/activity', async (req, res) => {
    try {
        const activity = await getFluxCloudActivity();
        const split = activity.deployedToday.cached ? splitNewVsUpdated(activity.deployedToday.apps) : null;
        res.json({
            deployedToday: {
                cached: activity.deployedToday.cached,
                count: activity.deployedToday.cached ? activity.deployedToday.apps.length : null,
                // Issue #400: of those, brand-new apps vs renewals/updates of running ones.
                // null when the permanent messages could not be read -- never a guess.
                newCount: split?.newCount ?? null,
                updatedCount: split?.updatedCount ?? null
            },
            expiring24h: {
                cached: activity.expiring24h.cached,
                count: activity.expiring24h.cached ? activity.expiring24h.apps.length : null
            }
        });
    } catch (error) {
        log.error({ err: error }, 'apps activity API error');
        res.status(500).json({ error: 'Failed to fetch apps activity', message: error.message });
    }
});

export default router;

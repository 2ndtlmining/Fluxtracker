// Analytics/metrics/category endpoints: current metrics, top repos per category, app
// revenue analytics, category snapshots, and the period-comparison endpoint. Mounted at
// '/api' in server.js ('/metrics/*', '/analytics/*' and '/categories/*' don't share a
// common sub-prefix).
import express from 'express';

import {
    getCurrentMetrics,
    getPaymentCountForDateRange,
    getTopReposByCategory,
    getCategoryTotal,
    getRepoHistory,
    getAppAnalytics,
    getLastNSnapshots,
    getSnapshotByDate,
    getRevenueForDateRange
} from '../../lib/db/database.js';

import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { getFluxCloudActivity } from '../../lib/services/carouselService.js';
import { groupReposByCanonicalName, categorizeImage, CATEGORY_CONFIG } from '../../lib/config.js';
import { createLogger } from '../../lib/logger.js';
import { createCache, withDbFallback, calculateChange } from '../../lib/serverHelpers.js';

const log = createLogger('server');
const router = express.Router();

const metricsCache = createCache(60_000);     // 60s
const analyticsCache = createCache(300_000);  // 5 min
const categoryCache = createCache(300_000);   // 5 min

// repo_snapshots stores one row per Docker image, but a game usually ships as several
// images (Minecraft Java + Bedrock, three Valheim images, two Rust images). Users think
// of those as one game, so the category cards group on the canonical name. Pull the whole
// category before grouping — slicing first would drop instances from the merged totals.
const CATEGORY_FETCH_LIMIT = 200;

// Current metrics
router.get('/metrics/current', async (req, res) => {
    return withDbFallback(metricsCache, 'current', res, async () => {
        const metrics = await getCurrentMetrics();
        if (!metrics) throw new Error('No metrics found');

        const today = new Date().toISOString().split('T')[0];
        const paymentCount = await getPaymentCountForDateRange(today, today);

        return {
            lastUpdate: metrics.last_update,
            revenue: {
                current: metrics.current_revenue,
                fluxPriceUsd: metrics.flux_price_usd,
                usdValue: metrics.flux_price_usd ? metrics.current_revenue * metrics.flux_price_usd : null,
                paymentCount: paymentCount
            },
            cloud: {
                cpu: { total: metrics.total_cpu_cores, used: metrics.used_cpu_cores, utilization: metrics.cpu_utilization_percent },
                ram: { total: metrics.total_ram_gb, used: metrics.used_ram_gb, utilization: metrics.ram_utilization_percent },
                storage: { total: metrics.total_storage_gb, used: metrics.used_storage_gb, utilization: metrics.storage_utilization_percent }
            },
            apps: {
                total: metrics.total_apps,
                watchtower: metrics.watchtower_count,
                gitapps: metrics.gitapps_count || 0,
                dockerapps: metrics.dockerapps_count || 0,
                gitapps_percent: metrics.gitapps_percent || 0,
                dockerapps_percent: metrics.dockerapps_percent || 0
            },
            gaming: { total: metrics.gaming_apps_total, palworld: metrics.gaming_palworld, enshrouded: metrics.gaming_enshrouded, minecraft: metrics.gaming_minecraft },
            crypto: { total: metrics.crypto_nodes_total, presearch: metrics.crypto_presearch, kaspa: metrics.crypto_kaspa, alephium: metrics.crypto_alephium },
            wordpress: { count: metrics.wordpress_count },
            nodes: { cumulus: metrics.node_cumulus, nimbus: metrics.node_nimbus, stratus: metrics.node_stratus, total: metrics.node_total }
        };
    });
});

// Top repos for a category (used by CategoryCard)
router.get('/metrics/category/:category/top', async (req, res) => {
    const { category } = req.params;
    const limit = parseInt(req.query.limit) || 3;
    const days = parseInt(req.query.days) || 7;

    if (!CATEGORY_CONFIG[category]) {
        return res.status(400).json({ error: `Unknown category: ${category}` });
    }

    const cacheKey = `${category}:${limit}:${days}`;

    return withDbFallback(categoryCache, cacheKey, res, async () => {
        // Pull the whole category, not just `limit` rows: variants of one game (Minecraft
        // Java + Bedrock, the several Valheim/Rust images) are separate rows here and get
        // merged below, so slicing before grouping would drop instances from the totals.
        const { date, repos: storedRepos } = await getTopReposByCategory(category, CATEGORY_FETCH_LIMIT);
        if (!date) {
            return { category, date: null, total: 0, previousTotal: 0, repos: [], previousRepos: [], days };
        }

        // Re-check the category against current config rather than trusting the value
        // stored at write time. Category config is hand-edited, and without this an image
        // that has since been excluded (the *-server-website frontends) keeps showing up
        // on the card until someone remembers to POST /api/admin/recategorize-repos.
        const repos = storedRepos.filter(r => categorizeImage(r.image_name) === category);
        const excluded = storedRepos.length - repos.length;

        let total = await getCategoryTotal(category, date);
        if (excluded > 0) {
            // Stored total still counts the now-excluded images, so recompute from the rows
            total = repos.reduce((sum, r) => sum + r.instance_count, 0);
            log.info(
                { category, excluded },
                '%s: %d stored image(s) no longer match the category — run /api/admin/recategorize-repos to update history',
                category,
                excluded
            );
        }

        // Get comparison data from N days ago (based on query param)
        const prevDate = new Date(date);
        prevDate.setDate(prevDate.getDate() - days);
        const prevDateStr = prevDate.toISOString().split('T')[0];
        const previousTotal = await getCategoryTotal(category, prevDateStr);

        const grouped = groupReposByCanonicalName(repos).slice(0, limit);

        // Previous counts for the same groups — sum every image in the group
        const previousRepos = [];
        for (const group of grouped) {
            let prevCount = 0;
            for (const image of group.images) {
                try {
                    const history = await getRepoHistory(image, Math.max(days + 7, 90));
                    const match = history.find(h => h.snapshot_date === prevDateStr);
                    if (match) prevCount += match.instance_count;
                } catch { /* missing history for one variant shouldn't zero the group */ }
            }
            previousRepos.push({ image_name: group.image_name, instance_count: prevCount });
        }

        return {
            category,
            date,
            total,
            previousTotal,
            repos: grouped.map(g => ({
                image_name: g.image_name,
                instance_count: g.instance_count,
                displayName: g.displayName,
                images: g.images
            })),
            previousRepos,
            days
        };
    });
});

// App Revenue Analytics - grouped by app_name
router.get('/analytics/apps', async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const search = req.query.search || '';
    const cacheKey = `apps:${page}:${limit}:${search}`;

    return withDbFallback(analyticsCache, cacheKey, res, async () => {
        const result = await getAppAnalytics(page, limit, search);
        return {
            apps: result.apps,
            total: result.total,
            page,
            limit,
            totalPages: Math.ceil(result.total / limit)
        };
    });
});

// Gaming category
router.get('/categories/gaming', async (req, res) => {
    try {
        log.info('fetching gaming category');
        const current = await getCurrentMetrics();
        const snapshots = await getLastNSnapshots(parseInt(req.query.days) || 30);

        res.json({
            current: {
                total: current.gaming_apps_total,
                palworld: current.gaming_palworld,
                minecraft: current.gaming_minecraft
            },
            history: snapshots.reverse().map(s => ({
                date: s.snapshot_date,
                total: s.gaming_apps_total
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Crypto category
router.get('/categories/crypto', async (req, res) => {
    try {
        log.info('fetching crypto category');
        const current = await getCurrentMetrics();
        res.json({
            current: {
                total: current.crypto_nodes_total,
                presearch: current.crypto_presearch,
                kadena: current.crypto_kadena,
                kaspa: current.crypto_kaspa
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Nodes category
router.get('/categories/nodes', async (req, res) => {
    try {
        log.info('fetching node category');
        const current = await getCurrentMetrics();
        res.json({
            current: {
                total: current.node_total,
                cumulus: current.node_cumulus,
                nimbus: current.node_nimbus,
                stratus: current.node_stratus
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analytics comparison endpoint
// CORRECTED Analytics comparison endpoint
// This version TRANSFORMS getCurrentMetrics() to match the structure your frontend expects
// Replace the endpoint starting at line ~547 in server.js with this code

router.get('/analytics/comparison/:days', async (req, res) => {
    try {
        const days = parseInt(req.params.days);

        if (isNaN(days) || days < 1) {
            return res.status(400).json({ error: 'Invalid days parameter' });
        }

        const rawCurrent = await getCurrentMetrics();
        if (!rawCurrent) {
            return res.status(404).json({ error: 'No current metrics found' });
        }

        // CRITICAL: Transform raw database columns into nested structure
        // This matches what the OLD endpoint returned from snapshot.js
        const current = {
            nodes: {
                total: rawCurrent.node_total,
                cumulus: rawCurrent.node_cumulus,
                nimbus: rawCurrent.node_nimbus,
                stratus: rawCurrent.node_stratus
            },
            apps: {
                total: rawCurrent.total_apps,
                gitapps: rawCurrent.gitapps_count || 0,
                dockerapps: rawCurrent.dockerapps_count || 0
            },
            gaming: {
                total: rawCurrent.gaming_apps_total,
                minecraft: rawCurrent.gaming_minecraft,
                palworld: rawCurrent.gaming_palworld,
                enshrouded: rawCurrent.gaming_enshrouded
            },
            crypto: {
                total: rawCurrent.crypto_nodes_total,
                presearch: rawCurrent.crypto_presearch,
                kaspa: rawCurrent.crypto_kaspa,
                alephium: rawCurrent.crypto_alephium
            },
            cloud: {
                cpu: { utilization: rawCurrent.cpu_utilization_percent },
                ram: { utilization: rawCurrent.ram_utilization_percent },
                storage: { utilization: rawCurrent.storage_utilization_percent }
            },
            wordpress: {
                count: rawCurrent.wordpress_count
            }
        };

        // Get dates for comparison
        const today = new Date().toISOString().split('T')[0];
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        log.info({ today, targetDate: targetDateStr, days }, 'comparison request');

        // REVENUE: compare period totals, not single days.
        // Revenue is a flow, so "vs 30 days" has to mean the last 30 days against the 30
        // before that. Comparing today against the one day 30 days ago made every period
        // report today's number, which is what issue #48 reported.
        const shiftDays = (dateStr, n) => {
            const d = new Date(`${dateStr}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + n);
            return d.toISOString().split('T')[0];
        };

        const currentStart = shiftDays(today, -(days - 1));
        const previousEnd = shiftDays(currentStart, -1);
        const previousStart = shiftDays(previousEnd, -(days - 1));

        const currentRevenue = await getRevenueForDateRange(currentStart, today);
        const comparisonRevenue = await getRevenueForDateRange(previousStart, previousEnd);

        let revenueComparison;
        if (comparisonRevenue > 0) {
            revenueComparison = calculateChange(currentRevenue, comparisonRevenue);
        } else {
            revenueComparison = {
                change: 0,
                trend: 'neutral',
                note: `No revenue data for ${previousStart}..${previousEnd}`
            };
        }

        revenueComparison.current = currentRevenue;
        revenueComparison.previous = comparisonRevenue;
        revenueComparison.currentRange = { start: currentStart, end: today };
        revenueComparison.previousRange = { start: previousStart, end: previousEnd };

        // For other metrics, we need snapshot data
        const pastSnapshot = await getSnapshotByDate(targetDateStr);

        // Build response
        const response = {
            period: days,
            currentDate: today,
            comparisonDate: targetDateStr,
            changes: {
                revenue: revenueComparison
            }
        };

        // Add other metrics only if snapshot exists
        if (pastSnapshot) {
            log.info({ targetDate: targetDateStr }, 'found snapshot for comparison');

            // Node comparisons with individual breakdowns
            const nodeChange = calculateChange(current.nodes?.total || 0, pastSnapshot.node_total);
            const cumulusChange = (current.nodes?.cumulus || 0) - (pastSnapshot.node_cumulus || 0);
            const nimbusChange = (current.nodes?.nimbus || 0) - (pastSnapshot.node_nimbus || 0);
            const stratusChange = (current.nodes?.stratus || 0) - (pastSnapshot.node_stratus || 0);

            response.changes.nodes = {
                ...nodeChange,
                difference: (current.nodes?.total || 0) - (pastSnapshot.node_total || 0),
                cumulusChange: cumulusChange,
                cumulusTrend: cumulusChange > 0 ? 'up' : cumulusChange < 0 ? 'down' : 'neutral',
                nimbusChange: nimbusChange,
                nimbusTrend: nimbusChange > 0 ? 'up' : nimbusChange < 0 ? 'down' : 'neutral',
                stratusChange: stratusChange,
                stratusTrend: stratusChange > 0 ? 'up' : stratusChange < 0 ? 'down' : 'neutral'
            };

            response.changes.apps = {
                ...calculateChange(current.apps?.total || 0, pastSnapshot.total_apps),
                difference: (current.apps?.total || 0) - (pastSnapshot.total_apps || 0),
                gitChange: (current.apps?.gitapps || 0) - (pastSnapshot.gitapps_count || 0),
                gitTrend: (current.apps?.gitapps || 0) > (pastSnapshot.gitapps_count || 0) ? 'up' :
                         (current.apps?.gitapps || 0) < (pastSnapshot.gitapps_count || 0) ? 'down' : 'neutral',
                dockerChange: (current.apps?.dockerapps || 0) - (pastSnapshot.dockerapps_count || 0),
                dockerTrend: (current.apps?.dockerapps || 0) > (pastSnapshot.dockerapps_count || 0) ? 'up' :
                            (current.apps?.dockerapps || 0) < (pastSnapshot.dockerapps_count || 0) ? 'down' : 'neutral'
            };

            // CLOUD COMPARISONS - Now using transformed data
            response.changes.cpu = calculateChange(current.cloud?.cpu?.utilization || 0, pastSnapshot.cpu_utilization_percent);
            response.changes.ram = calculateChange(current.cloud?.ram?.utilization || 0, pastSnapshot.ram_utilization_percent);
            response.changes.storage = calculateChange(current.cloud?.storage?.utilization || 0, pastSnapshot.storage_utilization_percent);

            // Decentralization (issue #108 Phase 3): "current" reads live from
            // decentralizationService rather than rawCurrent/current_metrics, since that's
            // where the always-fresh reading actually lives -- same reasoning /api/decentralization
            // already uses. Isolated in its own try/catch: this endpoint's revenue/nodes/
            // gaming/crypto sections have nothing to do with decentralization, so a failure
            // here (e.g. a DB schema not yet migrated to a newer decentralizationService
            // column) must not 500 the whole comparison response -- it did exactly that
            // before this fix, reported live after issue #138 shipped.
            try {
                const liveDecentralization = await getDecentralizationStats();
                response.changes.decentralization = calculateChange(
                    liveDecentralization.datacenterPercent ?? 0,
                    pastSnapshot.decentralization_datacenter_percent
                );
            } catch (error) {
                log.warn({ err: error }, 'decentralization comparison unavailable, continuing without it');
            }

            // Apps deployed/expiring (item 3 of the decentralization follow-ups): "current"
            // reads live from carouselService, same reasoning as decentralization above --
            // an uncached live read (`cached: false`) is treated as 0 for the comparison
            // rather than blocking the rest of the response, matching liveDecentralization's
            // `?? 0` fallback just above. Isolated in its own try/catch for the same reason
            // as the decentralization block above -- a live-read failure here shouldn't cost
            // the rest of the comparison response either.
            try {
                const liveActivity = await getFluxCloudActivity();
                response.changes.appsDeployed = calculateChange(
                    liveActivity.deployedToday.cached ? liveActivity.deployedToday.apps.length : 0,
                    pastSnapshot.apps_deployed_today
                );
                response.changes.appsExpiring = calculateChange(
                    liveActivity.expiring24h.cached ? liveActivity.expiring24h.apps.length : 0,
                    pastSnapshot.apps_expiring_today
                );
            } catch (error) {
                log.warn({ err: error }, 'apps deployed/expiring comparison unavailable, continuing without it');
            }

            // Gaming comparisons with individual breakdowns
            response.changes.gaming = {
                ...calculateChange(current.gaming?.total || 0, pastSnapshot.gaming_apps_total),
                difference: (current.gaming?.total || 0) - (pastSnapshot.gaming_apps_total || 0),
                minecraftChange: (current.gaming?.minecraft || 0) - (pastSnapshot.gaming_minecraft || 0),
                minecraftTrend: (current.gaming?.minecraft || 0) > (pastSnapshot.gaming_minecraft || 0) ? 'up' :
                               (current.gaming?.minecraft || 0) < (pastSnapshot.gaming_minecraft || 0) ? 'down' : 'neutral',
                palworldChange: (current.gaming?.palworld || 0) - (pastSnapshot.gaming_palworld || 0),
                palworldTrend: (current.gaming?.palworld || 0) > (pastSnapshot.gaming_palworld || 0) ? 'up' :
                              (current.gaming?.palworld || 0) < (pastSnapshot.gaming_palworld || 0) ? 'down' : 'neutral',
                enshroudedChange: (current.gaming?.enshrouded || 0) - (pastSnapshot.gaming_enshrouded || 0),
                enshroudedTrend: (current.gaming?.enshrouded || 0) > (pastSnapshot.gaming_enshrouded || 0) ? 'up' :
                                (current.gaming?.enshrouded || 0) < (pastSnapshot.gaming_enshrouded || 0) ? 'down' : 'neutral'
            };

            // Crypto comparisons with individual breakdowns
            response.changes.crypto = {
                ...calculateChange(current.crypto?.total || 0, pastSnapshot.crypto_nodes_total),
                difference: (current.crypto?.total || 0) - (pastSnapshot.crypto_nodes_total || 0),
                presearchChange: (current.crypto?.presearch || 0) - (pastSnapshot.crypto_presearch || 0),
                presearchTrend: (current.crypto?.presearch || 0) > (pastSnapshot.crypto_presearch || 0) ? 'up' :
                               (current.crypto?.presearch || 0) < (pastSnapshot.crypto_presearch || 0) ? 'down' : 'neutral',
                kaspaChange: (current.crypto?.kaspa || 0) - (pastSnapshot.crypto_kaspa || 0),
                kaspaTrend: (current.crypto?.kaspa || 0) > (pastSnapshot.crypto_kaspa || 0) ? 'up' :
                           (current.crypto?.kaspa || 0) < (pastSnapshot.crypto_kaspa || 0) ? 'down' : 'neutral',
                alephiumChange: (current.crypto?.alephium || 0) - (pastSnapshot.crypto_alephium || 0),
                alephiumTrend: (current.crypto?.alephium || 0) > (pastSnapshot.crypto_alephium || 0) ? 'up' :
                              (current.crypto?.alephium || 0) < (pastSnapshot.crypto_alephium || 0) ? 'down' : 'neutral'
            };

            response.changes.wordpress = {
                ...calculateChange(current.wordpress?.count || 0, pastSnapshot.wordpress_count),
                difference: (current.wordpress?.count || 0) - (pastSnapshot.wordpress_count || 0)
            };

        } else {
            log.warn({ targetDate: targetDateStr, days }, 'no snapshot found for comparison');
            log.info('revenue comparison still available using transaction data');

            response.partialData = true;
            response.message = `Snapshot data not available for ${targetDateStr}, but revenue comparison is available from transaction history.`;

            // Calculate Git/Docker comparison even without past snapshot (compare against 0)
            response.changes.apps = {
                change: 0,
                difference: 0,
                trend: 'neutral',
                gitChange: current.apps?.gitapps || 0,
                gitTrend: (current.apps?.gitapps || 0) > 0 ? 'up' : 'neutral',
                dockerChange: current.apps?.dockerapps || 0,
                dockerTrend: (current.apps?.dockerapps || 0) > 0 ? 'up' : 'neutral'
            };

        }

        res.json(response);

    } catch (error) {
        log.error({ err: error }, 'comparison endpoint error');
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});

export default router;

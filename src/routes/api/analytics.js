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
    getAppRevenueConcentration,
    getLastNSnapshots,
    getGameSnapshotsByDate,
    getSnapshotByDate,
    getRevenueForDateRange,
    getDailyGameRevenueInRange
} from '../../lib/db/database.js';

import { getDecentralizationStats } from '../../lib/services/decentralizationService.js';
import { getFluxCloudActivity, getSharedFluxApiData } from '../../lib/services/carouselService.js';
import { computeUtilizationProjection } from '../../lib/utils/utilizationProjection.js';
import { shapeConcentration, isMissingFunctionError } from '../../lib/utils/revenueSources.js';
import { getLiveGameBreakdown } from '../../lib/services/gamingService.js';
import { getRunningApps, computeDeploymentFill, READ_PATH_TTL_MS } from '../../lib/services/runningAppsProvider.js';
import { groupReposByCanonicalName, categorizeImage, CATEGORY_CONFIG, GAME_APP_NAME_PATTERN } from '../../lib/config.js';
import { summarizeGameRevenue } from '../../lib/utils/gameRevenue.js';
import { createLogger } from '../../lib/logger.js';
import { createCache, withDbFallback, calculateChange } from '../../lib/serverHelpers.js';

const log = createLogger('server');
const router = express.Router();

const metricsCache = createCache(60_000);     // 60s
const analyticsCache = createCache(300_000);  // 5 min
const categoryCache = createCache(300_000);   // 5 min
// Matches the running-apps payload's own ~60s TTL -- caching longer here would just serve
// a stale copy of data the provider has already refreshed.
const gamesCache = createCache(60_000);       // 60s
const fillCache = createCache(60_000);        // 60s -- issue #200
const projectionCache = createCache(600_000); // 10 min -- issue #347; expiries move by the day
// Comparison (issue #295). The page asks for D on load, prefetches W and M, and refetches on
// every refresh -- and each call ran six reads. 60s means a viewer's burst is one run.
const comparisonCache = createCache(60_000);

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
            nodes: { cumulus: metrics.node_cumulus, nimbus: metrics.node_nimbus, stratus: metrics.node_stratus, total: metrics.node_total },
            // Issue #210. `?? null` rather than `|| 0`: a consumer must be able to tell
            // "not collected yet" from "nothing locked", which is never a real reading.
            lockedCollateral: {
                cumulus: metrics.locked_collateral_cumulus ?? null,
                nimbus: metrics.locked_collateral_nimbus ?? null,
                stratus: metrics.locked_collateral_stratus ?? null,
                total: metrics.locked_collateral ?? null
            },
            // Issue #201. `?? null` rather than `|| 0`: the card must be able to tell
            // "not collected yet" from "zero wallets", and hide the row in the first case.
            wallets: { unique: metrics.unique_wallets ?? null },
            // Issue #209, same `?? null` reasoning as wallets above.
            appOwners: { unique: metrics.unique_app_owners ?? null }
        };
    });
});

// Top repos for a category (used by CategoryCard)
router.get('/metrics/category/:category/top', async (req, res) => {
    const { category } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 3, 1), 50);
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);

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

/**
 * GET /api/games/revenue -- issue #265. What game servers earned over the last 30 days: $ at
 * the time of payment, FLUX, and share of all revenue. Recognised by app name
 * (GAME_APP_NAME_PATTERN), so it covers game servers deployed through Flux's game sites.
 * available:false until migration 024 is applied.
 */
router.get('/games/revenue', async (req, res) => {
    return withDbFallback(gamesCache, 'revenue:30', res, async () => {
        // The last 30 days, today included -- the same window whatever the dashboard's
        // period toggle says, because the card labels it "last 30 days".
        const end = new Date();
        const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - 29);
        try {
            const rows = await getDailyGameRevenueInRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), GAME_APP_NAME_PATTERN);
            return { available: true, days: 30, ...summarizeGameRevenue(rows) };
        } catch (error) {
            if (isMissingFunctionError(error, 'get_daily_game_revenue')) return { available: false };
            throw error;
        }
    });
});

/**
 * GET /api/games/live — per-game running instance counts (issue #162/#163).
 *
 * Separate from /api/metrics/category/gaming/top, which reads repo_snapshots and therefore
 * can only report games with a readable Docker image. This counts by app name as well, so
 * enterprise-encrypted deployments (most of FiveM, Valheim and RuneScape: Dragonwilds) are
 * included.
 *
 * ?limit=N for a top-N breakdown; omit for every game.
 */
router.get('/games/live', async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 50);
    const days = Math.min(Math.max(parseInt(req.query.days) || 1, 1), 365);

    return withDbFallback(gamesCache, `live:${limit}:${days}`, res, async () => {
        const breakdown = await getLiveGameBreakdown(limit);

        // Per-game history for the comparison arrows. game_snapshots only starts filling on
        // the first daily snapshot after this ships, so `previous` is legitimately empty for
        // the first few days -- the card renders no arrow rather than a fabricated 0%.
        const since = new Date();
        since.setDate(since.getDate() - days);
        const previousRows = await getGameSnapshotsByDate(since.toISOString().split('T')[0]);
        const previous = new Map(previousRows.map(r => [r.game_name, r.instance_count]));

        return {
            total: breakdown.total,
            gameCount: breakdown.gameCount,
            days,
            games: breakdown.games.map(g => ({
                ...g,
                // undefined, not 0: "we have no reading for that day" is a different claim
                // from "this game had no instances", and only one of them justifies an arrow.
                previousInstances: previous.has(g.name) ? previous.get(g.name) : undefined
            })),
            previousTotal: previousRows.length > 0
                ? previousRows.reduce((sum, r) => sum + r.instance_count, 0)
                : undefined,
            fetchedAt: breakdown.fetchedAt
        };
    });
});

/**
 * GET /api/apps/deployment-fill — how many ordered deployments are actually running (#200).
 *
 * Reads the shared running-apps census (one fetch per cycle, TTL-cached) and the app specs
 * cache, so it adds no upstream call of its own.
 *
 * `containers` and `deployments` are BOTH reported because the gap between them is the
 * compose factor and is meaningful in itself: a compose app runs one container per component
 * but is one deployment on one node. Reporting only containers is what made the Apps card
 * read ~14% high against the word "instances".
 *
 * ?limit=N caps the shortfall breakdown; 0 omits it.
 */
router.get('/apps/deployment-fill', async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 0, 0), 100);

    return withDbFallback(fillCache, `fill:${limit}`, res, async () => {
        const apps = await getRunningApps({ ttlMs: READ_PATH_TTL_MS });
        const fill = computeDeploymentFill(apps.deploymentCounts);

        // null means the specs cache was empty -- a failed fetch, not a network that ordered
        // nothing. Say so rather than serving a 0% that reads as a total outage.
        if (!fill) {
            return {
                available: false,
                containers: apps.totalInstances - apps.watchtowerCount,
                deployments: null,
                fetchedAt: apps.fetchedAt
            };
        }

        return {
            available: true,
            ordered: fill.ordered,
            running: fill.running,
            missing: fill.missing,
            fillPct: fill.fillPct,
            // Containers minus watchtower, matching how total_apps is derived, so the two
            // figures on the card cannot disagree.
            containers: apps.totalInstances - apps.watchtowerCount,
            deployments: [...apps.deploymentCounts.values()].reduce((sum, n) => sum + n, 0),
            appsShort: fill.shortfalls.length,
            shortfalls: limit > 0 ? fill.shortfalls.slice(0, limit) : [],
            fetchedAt: apps.fetchedAt
        };
    });
});

/**
 * GET /api/cloud/utilization-projection -- issue #347. What the network would still run on
 * each of the next ?days (default 180, max 365) days if no app renewed, from every spec's
 * registration height + paid-for blocks. Instances cover every app; CPU covers only specs
 * whose resources are readable, and `coverage` says how many that is -- the card shows it.
 *
 * Reads the carousel's shared registry fetch (TTL-cached), so no upstream call of its own.
 */
router.get('/cloud/utilization-projection', async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days) || 180, 7), 365);
    return withDbFallback(projectionCache, `projection:${days}`, res, async () => {
        const { currentBlockHeight, appsData } = await getSharedFluxApiData();
        const projection = computeUtilizationProjection(appsData, currentBlockHeight, { horizonDays: days });
        if (!projection) return { available: false };
        return { available: true, ...projection, generatedAt: Date.now() };
    });
});

// App Revenue Analytics - grouped by app_name
router.get('/analytics/apps', async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    // Trimmed and bounded: every debounced keystroke is its own cache key (issue #291).
    const search = String(req.query.search || '').trim().slice(0, 100);
    const cacheKey = `apps:${page}:${limit}:${search.toLowerCase()}`;

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

/**
 * GET /api/analytics/apps/concentration -- issue #267. How dependent all-time revenue is on a
 * few apps: the top ten's share and how few apps make up 80% of it. Also the total the App
 * Analytics table needs for its share-of-total column. Aggregates only.
 */
router.get('/analytics/apps/concentration', async (req, res) => {
    return withDbFallback(analyticsCache, 'apps:concentration', res, async () => {
        try {
            return { available: true, ...shapeConcentration(await getAppRevenueConcentration()) };
        } catch (error) {
            if (isMissingFunctionError(error, 'get_app_revenue_concentration')) {
                return { available: false, reason: 'Apply supabase/migrations/018_payer_base.sql' };
            }
            throw error;
        }
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

/**
 * Shift a YYYY-MM-DD date string by n days, in UTC.
 *
 * UTC on purpose: a local-time Date would shift by 23 or 25 hours across a DST boundary and
 * land on the wrong day for half the year.
 */
function shiftDays(dateStr, n) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().split('T')[0];
}

/**
 * The two windows a "vs N days" comparison covers, plus the single past date the snapshot
 * comparison reads. Exported so the arithmetic can be tested without standing up Express
 * (same reason history.js exports shapeGameHistory).
 *
 * Revenue is a flow, so "vs 30 days" has to mean the last 30 days against the 30 before
 * that. Comparing today against the one day 30 days ago made every period report today's
 * number, which is what issue #48 reported -- and the page still renders perfectly either
 * way, which is how it shipped.
 */
export function comparisonWindows(today, days) {
    const currentStart = shiftDays(today, -(days - 1));
    const previousEnd = shiftDays(currentStart, -1);
    const previousStart = shiftDays(previousEnd, -(days - 1));
    return {
        currentStart,
        currentEnd: today,
        previousStart,
        previousEnd,
        targetDate: shiftDays(today, -days)
    };
}

/**
 * Flatten the current_metrics row into the nested shape the frontend expects. Exported for
 * the same reason as comparisonWindows: it is a pure transform, and a column renamed out
 * from under it reads as a zeroed metric rather than an error.
 */
export function shapeCurrentMetrics(rawCurrent) {
    return {
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
}

/** Direction of a raw difference, matching calculateChange's vocabulary. */
const trendOf = (difference) => (difference > 0 ? 'up' : difference < 0 ? 'down' : 'neutral');

/** A total's percentage change plus the per-member differences underneath it. */
function breakdown(currentTotal, pastTotal, members) {
    const section = {
        ...calculateChange(currentTotal || 0, pastTotal),
        difference: (currentTotal || 0) - (pastTotal || 0)
    };
    for (const [name, [currentValue, pastValue]] of Object.entries(members)) {
        const difference = (currentValue || 0) - (pastValue || 0);
        section[`${name}Change`] = difference;
        section[`${name}Trend`] = trendOf(difference);
    }
    return section;
}

/**
 * Assemble the comparison response. Pure: every live read is resolved by the caller and
 * passed in, so a section whose source failed arrives as null and is simply left out --
 * which is what keeps one failing live read from 500-ing the whole response (issue #138).
 */
export function buildComparisonResponse({
    days,
    windows,
    current,
    pastSnapshot,
    currentRevenue,
    previousRevenue,
    decentralization = null,
    activity = null
}) {
    const { currentStart, currentEnd: today, previousStart, previousEnd, targetDate } = windows;

    // A previous period with no revenue is not a -100% drop, it is an absent baseline; say so
    // rather than rendering a percentage computed from nothing.
    const revenueComparison = previousRevenue > 0
        ? calculateChange(currentRevenue, previousRevenue)
        : { change: 0, trend: 'neutral', note: `No revenue data for ${previousStart}..${previousEnd}` };

    revenueComparison.current = currentRevenue;
    revenueComparison.previous = previousRevenue;
    revenueComparison.currentRange = { start: currentStart, end: today };
    revenueComparison.previousRange = { start: previousStart, end: previousEnd };

    const response = {
        period: days,
        currentDate: today,
        comparisonDate: targetDate,
        changes: { revenue: revenueComparison }
    };

    if (!pastSnapshot) {
        response.partialData = true;
        response.message = `Snapshot data not available for ${targetDate}, but revenue comparison is available from transaction history.`;

        // Git/Docker still compare against 0 so the split renders on a day with no snapshot.
        response.changes.apps = {
            change: 0,
            difference: 0,
            trend: 'neutral',
            gitChange: current.apps?.gitapps || 0,
            gitTrend: (current.apps?.gitapps || 0) > 0 ? 'up' : 'neutral',
            dockerChange: current.apps?.dockerapps || 0,
            dockerTrend: (current.apps?.dockerapps || 0) > 0 ? 'up' : 'neutral'
        };

        return response;
    }

    response.changes.nodes = breakdown(current.nodes?.total, pastSnapshot.node_total, {
        cumulus: [current.nodes?.cumulus, pastSnapshot.node_cumulus],
        nimbus: [current.nodes?.nimbus, pastSnapshot.node_nimbus],
        stratus: [current.nodes?.stratus, pastSnapshot.node_stratus]
    });

    response.changes.apps = breakdown(current.apps?.total, pastSnapshot.total_apps, {
        git: [current.apps?.gitapps, pastSnapshot.gitapps_count],
        docker: [current.apps?.dockerapps, pastSnapshot.dockerapps_count]
    });

    response.changes.cpu = calculateChange(current.cloud?.cpu?.utilization || 0, pastSnapshot.cpu_utilization_percent);
    response.changes.ram = calculateChange(current.cloud?.ram?.utilization || 0, pastSnapshot.ram_utilization_percent);
    response.changes.storage = calculateChange(current.cloud?.storage?.utilization || 0, pastSnapshot.storage_utilization_percent);

    // Decentralization (issue #108 Phase 3): "current" comes from decentralizationService
    // rather than current_metrics, since that is where the always-fresh reading lives --
    // the same reasoning /api/decentralization already uses.
    if (decentralization) {
        response.changes.decentralization = calculateChange(
            decentralization.datacenterPercent ?? 0,
            pastSnapshot.decentralization_datacenter_percent
        );
    }

    // Apps deployed/expiring read live from carouselService for the same reason. An
    // uncached live read (`cached: false`) counts as 0 rather than blocking the section,
    // matching the `?? 0` fallback above.
    if (activity) {
        response.changes.appsDeployed = calculateChange(
            activity.deployedToday.cached ? activity.deployedToday.apps.length : 0,
            pastSnapshot.apps_deployed_today
        );
        response.changes.appsExpiring = calculateChange(
            activity.expiring24h.cached ? activity.expiring24h.apps.length : 0,
            pastSnapshot.apps_expiring_today
        );
    }

    response.changes.gaming = breakdown(current.gaming?.total, pastSnapshot.gaming_apps_total, {
        minecraft: [current.gaming?.minecraft, pastSnapshot.gaming_minecraft],
        palworld: [current.gaming?.palworld, pastSnapshot.gaming_palworld],
        enshrouded: [current.gaming?.enshrouded, pastSnapshot.gaming_enshrouded]
    });

    response.changes.crypto = breakdown(current.crypto?.total, pastSnapshot.crypto_nodes_total, {
        presearch: [current.crypto?.presearch, pastSnapshot.crypto_presearch],
        kaspa: [current.crypto?.kaspa, pastSnapshot.crypto_kaspa],
        alephium: [current.crypto?.alephium, pastSnapshot.crypto_alephium]
    });

    response.changes.wordpress = {
        ...calculateChange(current.wordpress?.count || 0, pastSnapshot.wordpress_count),
        difference: (current.wordpress?.count || 0) - (pastSnapshot.wordpress_count || 0)
    };

    return response;
}

/** Longest comparison window accepted -- ten years is past any real history (issue #295). */
export const MAX_COMPARISON_DAYS = 3650;

router.get('/analytics/comparison/:days', async (req, res) => {
    const days = parseInt(req.params.days, 10);

    // Bounded (issue #295): 100000000 used to reach Date arithmetic and 500 with
    // "Invalid time value".
    if (!Number.isFinite(days) || days < 1 || days > MAX_COMPARISON_DAYS) {
        return res.status(400).json({ error: `days must be between 1 and ${MAX_COMPARISON_DAYS}` });
    }

    // Cached and behind withDbFallback like every other read (issue #295): a DB blip now
    // serves the last good comparison (503 + _stale) instead of a bare 500 that left the
    // card broken until the next poll.
    return withDbFallback(comparisonCache, `comparison:${days}`, res, async () => {
        const today = new Date().toISOString().split('T')[0];
        const windows = comparisonWindows(today, days);

        // Independent reads, in parallel (they were six sequential awaits).
        const [rawCurrent, currentRevenue, previousRevenue, pastSnapshot] = await Promise.all([
            getCurrentMetrics(),
            getRevenueForDateRange(windows.currentStart, windows.currentEnd),
            getRevenueForDateRange(windows.previousStart, windows.previousEnd),
            getSnapshotByDate(windows.targetDate)
        ]);

        if (!rawCurrent) {
            throw Object.assign(new Error('No current metrics found'), { httpStatus: 404 });
        }
        if (!pastSnapshot) {
            log.warn({ targetDate: windows.targetDate, days }, 'no snapshot found for comparison -- revenue comparison only');
        }

        // Each live read is isolated: this endpoint's revenue/nodes/gaming/crypto sections
        // have nothing to do with decentralization or the carousel, so a failure there must
        // not fail the whole comparison response -- it did exactly that before issue #138.
        const [decentralization, activity] = pastSnapshot
            ? await Promise.all([
                getDecentralizationStats().catch(error => {
                    log.warn({ err: error }, 'decentralization comparison unavailable, continuing without it');
                    return null;
                }),
                getFluxCloudActivity().catch(error => {
                    log.warn({ err: error }, 'apps deployed/expiring comparison unavailable, continuing without it');
                    return null;
                })
            ])
            : [null, null];

        return buildComparisonResponse({
            days,
            windows,
            current: shapeCurrentMetrics(rawCurrent),
            pastSnapshot,
            currentRevenue,
            previousRevenue,
            decentralization,
            activity
        });
    });
});

export default router;

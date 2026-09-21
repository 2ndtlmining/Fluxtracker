import { API_ENDPOINTS, categorizeImage, getCanonicalName, resolveGameFromAppName, isGameHelperComponent } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, resolveRunningAppName, getAllAppSpecs } from './appSpecsCache.js';
import { createLogger } from '../logger.js';

const log = createLogger('runningAppsProvider');

// gaming, crypto, wordpress and cloud each used to download this ~450KB payload separately
// on every cycle. One fetch per cycle, shared.
const DEFAULT_TTL_MS = 60 * 1000;
const MAX_RETRIES = 2;    // attempts after the first (3 total, as the old inline loop had)
const RETRY_DELAY_MS = 5000;

let cache = null;      // { imageCounts, totalInstances, unresolvedCount, watchtowerCount, nodeCount, fetchedAt }
let inFlight = null;   // dedupes concurrent callers within one cycle

async function fetchRunningApps({ retries = MAX_RETRIES, delayMs = RETRY_DELAY_MS } = {}) {
    const [body] = await Promise.all([
        resilientFetch(API_ENDPOINTS.RUNNING_APPS, {
            timeout: 15000,
            retries,
            delayMs,
            breakerKey: 'running-apps'
        }),
        ensureGlobalSpecsCache()
    ]);

    if (body?.status === 'error' && body.data) {
        throw new Error(`API Error: ${body.data.name} - ${body.data.message}`);
    }

    const nodes = body?.data;
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('RUNNING_APPS returned empty or invalid data');
    }

    // FluxOS v8.18 dropped `Image` from this endpoint; each entry now carries `Names`
    // (the Docker container name), which we resolve back to a repotag via
    // appSpecsCache so categorizeImage() and friends keep working unchanged. An
    // unresolved name (spec not in globalappsspecifications — private/enterprise apps,
    // mostly) still counts toward totalInstances, just not toward any image bucket.
    //
    // Watchtower (containrrr/watchtower) is infrastructure, not a Flux marketplace app —
    // it has no globalappsspecifications entry and will never resolve. It used to be
    // identified via the (now-gone) Image string; the only signal left is the container
    // name itself, so it's tallied here, at the one place that still sees raw names,
    // rather than in cloudService (which only sees the already-resolved imageCounts).
    const imageCounts = new Map();
    // Per-game instance tally (issue #162/#163), built alongside imageCounts rather than
    // derived from it -- imageCounts cannot represent a game whose spec is encrypted, which
    // is most of several games. One entry per CONTAINER, so a container both paths can
    // identify is counted once, not twice.
    const gameCounts = new Map();
    // Deployments per app (issue #200): how many NODES each app runs on, which is a
    // different unit from the container count above. A compose app runs one container per
    // component but is ONE deployment on ONE node, so owncloudoffice's six components
    // contribute 6 containers and 1 deployment. Network-wide the gap is ~14%.
    const deploymentCounts = new Map();
    let totalInstances = 0;
    let unresolvedCount = 0;
    let watchtowerCount = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        if (!Array.isArray(runningApps)) continue;

        // App names seen on THIS node, so each app counts once per node however many
        // containers it runs there.
        const appsOnThisNode = new Set();

        for (const app of runningApps) {
            const containerName = app?.Names?.[0];
            if (!containerName) continue;
            totalInstances++;

            if (containerName.toLowerCase().includes('watchtower')) {
                watchtowerCount++;
                continue;
            }

            // App-name path first: the dedicated site is authoritative about which game it
            // deployed, and unlike the image it survives spec encryption. Runs before the
            // resolve() below precisely so an encrypted app still lands in a game bucket.
            //
            // A compose app runs every component under the same app name, so the sidecars
            // (mariadb, operator, the companion website) would otherwise each count as an
            // instance of the game -- 84 FiveM "instances" for 12 actual game servers.
            const { component, appName } = parseContainerName(containerName);
            if (appName) appsOnThisNode.add(appName.toLowerCase());
            const nameGame = isGameHelperComponent(component) ? null : resolveGameFromAppName(appName);

            const resolved = resolveRunningAppName(containerName);
            if (!resolved) {
                if (nameGame) tally(gameCounts, nameGame);
                unresolvedCount++;
                continue;
            }
            imageCounts.set(resolved.repotag, (imageCounts.get(resolved.repotag) || 0) + 1);

            // The name label wins when both paths fire: a bedrock image deployed under a
            // java-plan name is still one game, and letting the image decide would split
            // Minecraft across two rows.
            const game = nameGame
                || (categorizeImage(resolved.repotag) === 'gaming' ? getCanonicalName(resolved.repotag) : null);
            if (game) tally(gameCounts, game);
        }

        for (const name of appsOnThisNode) tally(deploymentCounts, name);
    }

    // A globalappsspecifications outage (or an open 'global-apps-specs' circuit breaker)
    // leaves every resolveRunningAppName() call returning null — the loop above still
    // "succeeds", but imageCounts silently ends up empty while totalInstances is real.
    // Every downstream consumer (gaming/crypto/wordpress/cloud metrics) would then write
    // zeros to the database with no error raised — the same failure class this branch
    // exists to fix, through a new dependency. Throw so callers fall back to cached
    // metrics instead, the same way an empty running-apps payload already does above.
    if (totalInstances > 0 && imageCounts.size === 0 && watchtowerCount < totalInstances) {
        throw new Error('RUNNING_APPS resolved zero apps — globalappsspecifications may be unavailable');
    }

    log.info(
        { nodes: nodes.length, uniqueImages: imageCounts.size, totalInstances, unresolvedCount, watchtowerCount },
        'Running apps fetched: %d instances across %d images (%d unresolved, %d watchtower)',
        totalInstances,
        imageCounts.size,
        unresolvedCount,
        watchtowerCount
    );

    return { imageCounts, gameCounts, deploymentCounts, totalInstances, unresolvedCount, watchtowerCount, nodeCount: nodes.length, fetchedAt: Date.now() };
}

function tally(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Component and app name from a Docker container name.
 * "/fluxmariadb_fivem1788120258844" -> { component: "mariadb", appName: "fivem1788120258844" }
 * "/fluxdragonwilds1789155733040"   -> { component: "",        appName: "dragonwilds1789155733040" }
 *
 * Split at the FIRST underscore: the component name always comes first, and an app name may
 * itself contain underscores (same rule as appSpecsCache.resolveRunningAppName). A flat
 * container has no component segment.
 */
function parseContainerName(containerName) {
    const stripped = containerName.replace(/^\//, '').replace(/^flux/, '');
    const i = stripped.indexOf('_');
    return i > 0
        ? { component: stripped.slice(0, i), appName: stripped.slice(i + 1) }
        : { component: '', appName: stripped };
}

/**
 * Shared snapshot of every running app on the network.
 * Concurrent callers within the TTL share one fetch.
 */
export async function getRunningApps({ ttlMs = DEFAULT_TTL_MS, force = false, retries, delayMs } = {}) {
    if (!force && cache && Date.now() - cache.fetchedAt < ttlMs) {
        return cache;
    }

    if (inFlight) return inFlight;

    inFlight = fetchRunningApps({ retries, delayMs })
        .then(result => {
            cache = result;
            return result;
        })
        .finally(() => {
            inFlight = null;
        });

    return inFlight;
}

/** Last successful fetch, or null. Never triggers a network call. */
export function getCachedRunningApps() {
    return cache;
}

/** Plain object of image -> instance count, for createRepoSnapshots(). */
export function toRepoCounts(runningApps) {
    return Object.fromEntries(runningApps.imageCounts);
}

/**
 * Total instances in a category, using the same categorizeImage() rule the category
 * cards use. This is what makes the top cards and the category cards agree.
 */
export function countByCategory(runningApps, category) {
    let total = 0;
    for (const [image, count] of runningApps.imageCounts) {
        if (categorizeImage(image) === category) total += count;
    }
    return total;
}

/**
 * Per-repo counts for a configured repo list (GAMING_REPOS / CRYPTO_REPOS shape).
 * Returns { [dbKey]: count } for the featured breakdown columns.
 */
export function countConfiguredRepos(runningApps, repos) {
    const counts = {};
    for (const repo of repos) counts[repo.dbKey] = 0;

    for (const [image, instances] of runningApps.imageCounts) {
        for (const repo of repos) {
            const matches = Array.isArray(repo.imageMatch)
                ? repo.imageMatch.some(m => image.includes(m))
                : image.includes(repo.imageMatch);
            if (matches) {
                counts[repo.dbKey] += instances;
                break; // an image belongs to at most one configured repo
            }
        }
    }

    return counts;
}

/**
 * Per-game instance counts, highest first -- the figure the Gaming card shows.
 *
 * Combines both identification paths as a per-container union (see fetchRunningApps). Sorted
 * here rather than by the caller so every consumer agrees on what "top 3 games" means.
 *
 * @returns {Map<string, number>} game name -> running instances
 */
export function countGames(runningApps) {
    const entries = [...(runningApps.gameCounts || new Map())];
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return new Map(entries);
}

/** Total running game instances, across every game. */
export function countGamingInstances(runningApps) {
    let total = 0;
    for (const count of (runningApps.gameCounts || new Map()).values()) total += count;
    return total;
}

/** Test hook — drops the cached payload. */
export function clearRunningAppsCache() {
    cache = null;
    inFlight = null;
}

/**
 * Deployment fill (issue #200): how many of the deployments app owners ordered are running.
 *
 *   ordered = sum of spec.instances across globalappsspecifications
 *   running = sum of min(deployments_running, spec.instances) per app
 *   fill %  = running / ordered
 *
 * Four rules, each of which produced a wrong-but-plausible number when it was got wrong:
 *
 * DIVIDE DEPLOYMENTS BY DEPLOYMENTS. `containers / ordered instances` reads a comfortable
 * 96% and is not a fill rate at all -- a perfectly filled network would read ~111%, because
 * it would run more containers than instances ordered (compose apps run several containers
 * each). A percentage that cannot reach 100 when everything is correct is measuring the
 * compose factor, not fill.
 *
 * DO NOT USE instances x components AS THE DENOMINATOR. It is unit-correct but `compose` is
 * encrypted for enterprise apps -- readable for roughly 1,022 of 1,709 specs -- so that
 * denominator is a floor and the figure a permanent ceiling. Deployments need no component
 * count at all.
 *
 * CAP EACH APP AT WHAT IT ORDERED. An app running 4 against 3 is filled, not 133%. Without
 * the cap one over-deployed app silently offsets another's shortfall and the headline says
 * everything is fine.
 *
 * IGNORE APPS WITH NO SPEC. A lapsed registration keeps running (26 such names measured
 * 2026-09-21) but nobody ordered it, so counting it would add to the numerator against a
 * denominator it never contributed to.
 *
 * EXCLUDE LAPSED REGISTRATIONS, when a currentBlock is supplied (issue #213). The registry
 * keeps serving a spec past its expiry block, and a deployment nobody ordered any more is
 * not missing. Measured against the live network 2026-09-21: 50 expired specs ordering 176
 * instances, 2.1% of everything ordered -- and `EthereumNodeLight` alone orders 30, enough
 * to land near the top of a most-missing-first ranking on the carousel.
 *
 * Returns null when no specs are loaded: an empty cache is a failed fetch, not a network
 * that ordered nothing, and 0% would render as a catastrophic outage.
 *
 * @param {Map<string, number>} deploymentCounts  app name (lowercase) -> distinct nodes running it
 * @param {object}  [options]
 * @param {number}  [options.currentBlock]  chain height; when a positive number, specs whose
 *   lease has run out are excluded. Omitted, every spec counts -- the behaviour the Apps
 *   card had before #213, kept so an omitted block cannot silently restate its figure. A
 *   non-positive value is ignored for the same reason: carouselService coerces a failed
 *   height fetch to 0, and a 0 reaching the filter would mark EVERY spec as lapsed and
 *   report "nothing is short", the exact opposite of the truth.
 */
export function computeDeploymentFill(deploymentCounts, { currentBlock } = {}) {
    const specs = getAllAppSpecs();
    if (!specs || specs.length === 0) return null;

    const counts = deploymentCounts instanceof Map ? deploymentCounts : new Map();
    const filterExpired = typeof currentBlock === 'number' && currentBlock > 0;

    let ordered = 0;
    let running = 0;
    const shortfalls = [];

    for (const spec of specs) {
        const wanted = spec?.instances;
        // No instances field is absence of information, not an order for zero.
        if (typeof wanted !== 'number' || wanted <= 0) continue;

        // A lease that ran out ON this block is over, hence <= and not <.
        if (filterExpired && (spec.height || 0) + (spec.expire || 0) <= currentBlock) continue;

        ordered += wanted;

        const got = counts.get((spec.name || '').toLowerCase()) || 0;
        const counted = Math.min(got, wanted);
        running += counted;

        if (counted < wanted) {
            shortfalls.push({
                name: spec.name,
                ordered: wanted,
                running: got,
                short: wanted - counted,
                // Resources PER DEPLOYMENT, matching Latest Deployed Apps, so cpu/ram/hdd
                // mean the same thing on every carousel tab (issue #213).
                ...specResources(spec),
                // Only `compose` is encrypted for enterprise apps -- `instances` is still
                // readable, so the missing count is known even when the resources are not.
                // They keep their rank and show the pill instead of the figures.
                isEnterprise: !!spec.enterprise
            });
        }
    }

    if (ordered === 0) return null;

    // Worst-first so a breakdown leads with the apps that actually move the figure, then by
    // name so ties have a stable order -- the same tiebreak fetchLatestDeployedApps uses.
    // Without it the carousel's #rank badges reshuffle between polls for no visible reason.
    shortfalls.sort((a, b) => {
        if (b.short !== a.short) return b.short - a.short;
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
    });

    return {
        ordered,
        running,
        missing: ordered - running,
        fillPct: (running / ordered) * 100,
        shortfalls
    };
}

/**
 * Resources for ONE deployment of an app: summed across compose components when the spec is
 * readable, falling back to the flat top-level fields for legacy specs. Mirrors what
 * fetchLatestDeployedApps does, so the two tabs cannot drift apart on what a figure means.
 * Enterprise specs have no readable compose and come back as zeros; the isEnterprise flag is
 * what the renderer keys on, so those figures are never shown.
 */
function specResources(spec) {
    if (Array.isArray(spec?.compose)) {
        return {
            cpu: spec.compose.reduce((sum, c) => sum + (c.cpu || 0), 0),
            ram: spec.compose.reduce((sum, c) => sum + (c.ram || 0), 0),
            hdd: spec.compose.reduce((sum, c) => sum + (c.hdd || 0), 0)
        };
    }
    return { cpu: spec?.cpu || 0, ram: spec?.ram || 0, hdd: spec?.hdd || 0 };
}

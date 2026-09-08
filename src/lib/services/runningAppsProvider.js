import { API_ENDPOINTS, categorizeImage } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, resolveRunningAppName } from './appSpecsCache.js';
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
    let totalInstances = 0;
    let unresolvedCount = 0;
    let watchtowerCount = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        if (!Array.isArray(runningApps)) continue;

        for (const app of runningApps) {
            const containerName = app?.Names?.[0];
            if (!containerName) continue;
            totalInstances++;

            if (containerName.toLowerCase().includes('watchtower')) {
                watchtowerCount++;
                continue;
            }

            const resolved = resolveRunningAppName(containerName);
            if (!resolved) {
                unresolvedCount++;
                continue;
            }
            imageCounts.set(resolved.repotag, (imageCounts.get(resolved.repotag) || 0) + 1);
        }
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

    return { imageCounts, totalInstances, unresolvedCount, watchtowerCount, nodeCount: nodes.length, fetchedAt: Date.now() };
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

/** Test hook — drops the cached payload. */
export function clearRunningAppsCache() {
    cache = null;
    inFlight = null;
}

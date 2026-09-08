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

let cache = null;      // { imageCounts, totalInstances, nodeCount, fetchedAt }
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
    const imageCounts = new Map();
    let totalInstances = 0;
    let unresolvedCount = 0;

    for (const node of nodes) {
        const runningApps = node?.apps?.runningapps;
        if (!Array.isArray(runningApps)) continue;

        for (const app of runningApps) {
            const containerName = app?.Names?.[0];
            if (!containerName) continue;
            totalInstances++;

            const resolved = resolveRunningAppName(containerName);
            if (!resolved) {
                unresolvedCount++;
                continue;
            }
            imageCounts.set(resolved.repotag, (imageCounts.get(resolved.repotag) || 0) + 1);
        }
    }

    log.info(
        { nodes: nodes.length, uniqueImages: imageCounts.size, totalInstances, unresolvedCount },
        'Running apps fetched: %d instances across %d images (%d unresolved)',
        totalInstances,
        imageCounts.size,
        unresolvedCount
    );

    return { imageCounts, totalInstances, nodeCount: nodes.length, fetchedAt: Date.now() };
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

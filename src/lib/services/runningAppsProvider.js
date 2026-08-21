import axios from 'axios';
import { API_ENDPOINTS, categorizeImage } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('runningAppsProvider');

// gaming, crypto, wordpress and cloud each used to download this ~450KB payload separately
// on every cycle. One fetch per cycle, shared.
const DEFAULT_TTL_MS = 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

let cache = null;      // { imageCounts, totalInstances, nodeCount, fetchedAt }
let inFlight = null;   // dedupes concurrent callers within one cycle

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRunningApps() {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.get(API_ENDPOINTS.RUNNING_APPS, { timeout: 15000 });

            if (response.data?.status === 'error' && response.data.data) {
                throw new Error(`API Error: ${response.data.data.name} - ${response.data.data.message}`);
            }

            const nodes = response.data?.data;
            if (!Array.isArray(nodes) || nodes.length === 0) {
                throw new Error('RUNNING_APPS returned empty or invalid data');
            }

            // Key on the full image string (tag included) — that's what repo_snapshots stores,
            // and the read queries strip the tag when they group.
            const imageCounts = new Map();
            let totalInstances = 0;

            for (const node of nodes) {
                const runningApps = node?.apps?.runningapps;
                if (!Array.isArray(runningApps)) continue;

                for (const app of runningApps) {
                    const image = app?.Image || '';
                    if (!image) continue;
                    imageCounts.set(image, (imageCounts.get(image) || 0) + 1);
                    totalInstances++;
                }
            }

            log.info(
                { nodes: nodes.length, uniqueImages: imageCounts.size, totalInstances },
                'Running apps fetched: %d instances across %d images',
                totalInstances,
                imageCounts.size
            );

            return { imageCounts, totalInstances, nodeCount: nodes.length, fetchedAt: Date.now() };

        } catch (error) {
            lastError = error;
            log.warn('Running apps fetch attempt %d/%d failed: %s', attempt, MAX_RETRIES, error.message);
            if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        }
    }

    throw lastError;
}

/**
 * Shared snapshot of every running app on the network.
 * Concurrent callers within the TTL share one fetch.
 */
export async function getRunningApps({ ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
    if (!force && cache && Date.now() - cache.fetchedAt < ttlMs) {
        return cache;
    }

    if (inFlight) return inFlight;

    inFlight = fetchRunningApps()
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

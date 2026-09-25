import { API_ENDPOINTS, APP_OWNER_CONFIG } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { ensureGlobalSpecsCache, getAllAppSpecs } from './appSpecsCache.js';
import { medianDaysLeft } from '../utils/appTimeLeft.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('appOwnerService');

// Timestamp of the last SUCCESSFUL count. Only successes refresh it, so a failed hour is
// retried on the next cycle rather than waiting out a full interval on stale state.
let lastSuccessMs = 0;

/**
 * Unique app owners on the Flux network (issue #209).
 *
 * Every spec in `globalappsspecifications` carries the deploying ZelID in `owner`, so the
 * number of distinct owners is the number of distinct app operators. That is a very
 * different figure from the app count -- measured 2026-09-21, 1,659 unexpired apps were
 * run by 1,143 owners -- which is why this is a DISTINCT count and never a length.
 *
 * The specs come from appSpecsCache, which the service cycle already refreshes hourly for
 * name resolution and the deployment-fill calculation. This service adds no second fetch
 * of that ~2.2MB payload; the only network call it owns is the block height.
 *
 * Expired specs are excluded. The registry lags pruning them -- 51 of 1,710 were already
 * past their expiry block when this shipped -- and counting their owners would answer
 * "who has ever deployed" rather than "who is running something", which is the figure the
 * Applications metric group is about.
 */
export async function fetchUniqueAppOwners() {
    try {
        log.info('Counting unique app owners from global app specs...');

        // Fetched before the specs so a height failure costs nothing: a stale cache would
        // otherwise be refreshed for a count that is about to be thrown away.
        const heightBody = await resilientFetch(`${API_ENDPOINTS.DAEMON}/getblockcount`, {
            timeout: 15000,
            retries: 2,
            delayMs: 5000,
            breakerKey: 'flux-blockheight',
            // A height of 0 is rejected here rather than downstream. carouselService coerces
            // a failed height to 0, and a 0 reaching the expiry filter would mark every spec
            // as expiring in the future -- a silently wrong count instead of an absent one.
            validate: d => typeof d?.data === 'number' && d.data > 0
        });
        const currentBlock = heightBody.data;

        await ensureGlobalSpecsCache();
        const specs = getAllAppSpecs();

        if (specs.length === 0) {
            // appSpecsCache swallows its own fetch errors and leaves the cache empty, so an
            // empty list is indistinguishable from an upstream fault -- never a network on
            // which nobody is running an app.
            throw new Error('Global app specs cache is empty — cannot count owners');
        }

        const owners = new Set();
        let expired = 0;
        for (const spec of specs) {
            // A lease that ran out ON this block is over, hence > and not >=.
            const expiryBlock = (spec?.height || 0) + (spec?.expire || 0);
            if (expiryBlock <= currentBlock) {
                expired++;
                continue;
            }
            // Falsy owners are absence of information, not an operator. Without this guard
            // every owner-less spec collapses into one phantom owner in the Set.
            if (spec?.owner) owners.add(spec.owner);
        }

        if (owners.size === 0) {
            throw new Error(
                `${specs.length} specs carried no unexpired owner (${expired} expired)`
            );
        }

        const ownerData = { unique_app_owners: owners.size };
        // Median days left on running apps -- the same specs and height, so the two figures
        // always describe the same set of apps. Omitted (not 0) when nothing is readable.
        const timeLeft = medianDaysLeft(specs, currentBlock);
        if (timeLeft) ownerData.median_days_left = timeLeft.medianDays;

        await updateCurrentMetrics(ownerData);
        await updateSyncStatus('app-owners', 'completed');
        lastSuccessMs = Date.now();

        log.info(
            { ownerData, specs: specs.length, expired },
            'Unique app owners updated: %d owners across %d unexpired apps (%d expired ignored)',
            owners.size, specs.length - expired, expired
        );

        return ownerData;

    } catch (error) {
        log.error({ err: error }, 'Error counting unique app owners');
        await updateSyncStatus('app-owners', 'failed', error.message);
        throw error;
    }
}

/**
 * The service-cycle entry point.
 *
 * The cycle runs every few minutes but the answer barely moves within an hour, so the work
 * is gated to APP_OWNER_CONFIG.updateInterval and the step is a cheap no-op in between.
 *
 * The gate lives here rather than on its own setInterval for the same reason as
 * walletService's: updateCurrentMetrics() is a read-modify-write of the single
 * current_metrics row, so a refresh firing on its own timer could land between another
 * service's read and write and silently drop that service's columns. Staying inside the
 * sequential cycle is what makes that impossible.
 */
export async function refreshUniqueAppOwnersIfStale() {
    const age = Date.now() - lastSuccessMs;
    if (lastSuccessMs > 0 && age < APP_OWNER_CONFIG.updateInterval) {
        log.debug({ ageMs: age }, 'Unique app owner count still fresh, skipping');
        return { skipped: true };
    }
    return fetchUniqueAppOwners();
}

/** Test seam — clears the freshness gate so each case starts from a cold cache. */
export function __resetAppOwnerCacheForTests() {
    lastSuccessMs = 0;
}

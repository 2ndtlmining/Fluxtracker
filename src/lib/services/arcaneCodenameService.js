import { resilientFetch } from './resilientFetch.js';
import { API_ENDPOINTS } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('arcaneCodenameService');

/**
 * The ArcaneOS codename shown on the header's build line (issue #221).
 *
 * The value lives in `stats.runonflux.io/fluxinfo?projection=flux`, a per-node document for
 * the entire network — measured live at 3,764,706 bytes and 1.28s — and the handler read it
 * by parsing the whole thing to `.find()` the first node that reports one. /api/header did
 * that on every cache miss, with a 30s cache sitting under a 30s client poll, so roughly
 * every second poll paid for it: ~1,440 fetches/day, ~5.4 GB/day inbound, regardless of how
 * many people were watching.
 *
 * The codename changes about monthly, so a 6-hour TTL is generous. Same shape as
 * hostLocationService: module-level cache, in-flight dedup, never throws.
 *
 * Going through resilientFetch matters more than the bytes. undici's fetch has no
 * per-request timeout (header/body defaults are 300s), so a *stalled* upstream — not a
 * rejected one — held each /api/header request for minutes, and the old `.catch(() => null)`
 * could do nothing about it. Header.svelte already documents net::ERR_NO_BUFFER_SPACE from
 * stalled /api/header fetches stacking up.
 */
export const ARCANE_CODENAME_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const TIMEOUT_MS = 20_000; // the payload is megabytes; 15s was tight even when healthy

let cache = null;   // { codename: string|null, fetchedAt: number }
let inFlight = null;

async function lookup() {
    const data = await resilientFetch(API_ENDPOINTS.FLUXINFO, {
        timeout: TIMEOUT_MS,
        breakerKey: 'fluxinfo-codename'
    });

    const node = data?.data?.find(n => n?.flux?.arcaneHumanVersion);
    return node?.flux?.arcaneHumanVersion || null;
}

/**
 * The current codename, or null. Never throws: the header degrades to hiding the codename
 * rather than failing the whole /api/header response, which is what it did before.
 */
export async function getArcaneCodename() {
    if (cache && Date.now() - cache.fetchedAt < ARCANE_CODENAME_TTL_MS) return cache.codename;
    if (inFlight) return inFlight;

    inFlight = lookup()
        .then(codename => {
            cache = { codename, fetchedAt: Date.now() };
            log.info({ codename }, 'ArcaneOS codename: %s', codename ?? '(none reported)');
            return codename;
        })
        .catch(error => {
            log.warn('ArcaneOS codename lookup failed: %s', error.message);
            // Stale beats blank, and null on a first failure matches the old behaviour.
            return cache?.codename ?? null;
        })
        .finally(() => { inFlight = null; });

    return inFlight;
}

/** Test hook. */
export function clearArcaneCodenameCache() {
    cache = null;
    inFlight = null;
}

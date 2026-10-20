import { resilientFetch } from './resilientFetch.js';
import { API_ENDPOINTS } from '../config.js';

/**
 * The one reader of `stats.runonflux.io/fluxinfo?projection=flux` (issues #221, #532).
 *
 * The document is a per-node record for the whole network -- ~3.7 MB, ~1.3 s -- and two
 * figures come out of it: the ArcaneOS codename for the header and the tunnel verdicts for
 * Node Distribution. Each used to be a reason to download it; now one download serves both.
 *
 * Only the summary is cached, never the parsed records: holding 7,000 node documents in
 * memory for hours to answer two small questions would cost far more than the fetch.
 */
const TIMEOUT_MS = 20_000; // the payload is megabytes; 15s was tight even when healthy

let cache = null;   // { summary, fetchedAt }
let inFlight = null;

/**
 * Tunnel verdicts from FluxOS 8.21's `flux.uplink.tunnel` (issue #532).
 *
 * Records with no `uplink` (nodes still on an older FluxOS) are left out of the
 * denominator: they have not said either way. A verdict other than likely/none -- FluxOS
 * reports `unknown` when the node's own public IP did not answer a ping -- counts as
 * unknown. Null when no record reports the field, so a failed or empty payload is a gap,
 * never "0% tunnelled".
 */
export function countTunnels(records) {
    let likely = 0, none = 0, unknown = 0;
    for (const record of Array.isArray(records) ? records : []) {
        const uplink = record?.flux?.uplink;
        if (!uplink || typeof uplink !== 'object') continue;
        if (uplink.tunnel === 'likely') likely++;
        else if (uplink.tunnel === 'none') none++;
        else unknown++;
    }
    const reporting = likely + none + unknown;
    if (reporting === 0) return null;
    return { likely, none, unknown, percent: Math.round((likely / reporting) * 10000) / 100 };
}

/** Everything the app reads from one fluxinfo payload. */
export function summariseFluxInfo(payload) {
    const records = Array.isArray(payload?.data) ? payload.data : [];
    const node = records.find(n => n?.flux?.arcaneHumanVersion);
    return {
        codename: node?.flux?.arcaneHumanVersion || null,
        tunnels: countTunnels(records)
    };
}

/**
 * The summary, fetched at most once per `maxAgeMs`. Concurrent callers share one download.
 * Throws when the fetch fails; each caller decides what a failure means for it.
 */
export async function getFluxInfoSummary(maxAgeMs) {
    if (cache && Date.now() - cache.fetchedAt < maxAgeMs) return cache.summary;
    if (inFlight) return inFlight;

    inFlight = resilientFetch(API_ENDPOINTS.FLUXINFO, {
        timeout: TIMEOUT_MS,
        breakerKey: 'fluxinfo'
    })
        .then(payload => {
            const summary = summariseFluxInfo(payload);
            cache = { summary, fetchedAt: Date.now() };
            return summary;
        })
        .finally(() => { inFlight = null; });

    return inFlight;
}

/** Test hook. */
export function clearFluxInfoCache() {
    cache = null;
    inFlight = null;
}

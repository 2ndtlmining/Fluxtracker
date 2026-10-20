import { TUNNEL_CONFIG } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { getFluxInfoSummary } from './fluxInfoFeed.js';
import { createLogger } from '../logger.js';

const log = createLogger('tunnelService');

// Timestamp of the last SUCCESSFUL count. Only successes refresh it, so a failed hour is
// retried on the next cycle rather than waiting out a full interval on stale state.
let lastSuccessMs = 0;

/**
 * Nodes that reach the internet through a tunnel (issue #532).
 *
 * FluxOS 8.21 reports `flux.uplink.tunnel` on every node: `likely` when the node's traffic
 * leaves through a tunnel to a rented box, `none`, or `unknown`. A tunnelled node's
 * geolocation is the rented box's, not the node's. The figure comes from the same fluxinfo
 * download as the header's codename (fluxInfoFeed.js), so it costs no extra fetch.
 *
 * Uses: https://stats.runonflux.io/fluxinfo?projection=flux
 */
export async function fetchTunnelStats() {
    try {
        log.info('Counting tunnelled nodes...');

        const { tunnels } = await getFluxInfoSummary(TUNNEL_CONFIG.updateInterval);

        // Nothing reported the field: an upstream fault or a payload with no nodes. Throwing
        // records a failed step, so a long outage leaves a gap in the snapshot instead of a
        // frozen figure.
        if (!tunnels) throw new Error('No node in the fluxinfo payload reports flux.uplink');

        const tunnelData = {
            node_tunnel_likely: tunnels.likely,
            node_tunnel_none: tunnels.none,
            node_tunnel_unknown: tunnels.unknown,
            node_tunnel_percent: tunnels.percent
        };

        await updateCurrentMetrics(tunnelData);
        await updateSyncStatus('tunnels', 'completed');
        lastSuccessMs = Date.now();

        log.info({ tunnelData }, 'Tunnelled nodes updated: %d likely (%s%%)', tunnels.likely, tunnels.percent);

        return tunnelData;

    } catch (error) {
        log.error({ err: error }, 'Error counting tunnelled nodes');
        await updateSyncStatus('tunnels', 'failed', error.message);
        throw error;
    }
}

/**
 * The service-cycle entry point, gated to TUNNEL_CONFIG.updateInterval like the wallet
 * count: the payload is megabytes and the verdicts barely move within an hour.
 */
export async function refreshTunnelStatsIfStale() {
    const age = Date.now() - lastSuccessMs;
    if (lastSuccessMs > 0 && age < TUNNEL_CONFIG.updateInterval) {
        log.debug({ ageMs: age }, 'Tunnel count still fresh, skipping fetch');
        return { skipped: true };
    }
    return fetchTunnelStats();
}

/** Test seam: clears the freshness gate so each case starts from a cold cache. */
export function __resetTunnelCacheForTests() {
    lastSuccessMs = 0;
}

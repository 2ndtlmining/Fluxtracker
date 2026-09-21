import { API_ENDPOINTS, calculateLockedCollateral } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('nodeService');

/**
 * Fetch node statistics from Flux API
 * Uses: https://api.runonflux.io/daemon/getzelnodecount
 */
export async function fetchNodeStats() {
    try {
        log.info('Fetching node statistics...');

        const body = await resilientFetch(`${API_ENDPOINTS.DAEMON}/getzelnodecount`, {
            timeout: 15000,
            retries: 2,
            delayMs: 5000,
            breakerKey: 'flux-daemon-nodecount',
            validate: d => d?.status === 'success'
        });

        const stats = body.data;

        const nodeData = {
            node_cumulus: stats['cumulus-enabled'] || 0,
            node_nimbus: stats['nimbus-enabled'] || 0,
            node_stratus: stats['stratus-enabled'] || 0,
            node_total: stats['total'] || 0,

            // Locked collateral (issue #210). Computed here rather than by a service of
            // its own because this is the one place the tier counts are produced --
            // deriving the two apart is exactly how they would drift.
            //
            // Deliberately fed the RAW payload values, not the `|| 0` columns above. A
            // tier missing from the response must leave collateral NULL, and a 0 that has
            // already been substituted for "absent" is indistinguishable from a real zero
            // by the time it gets here. The counts keep their `|| 0` because years of
            // history were written that way.
            ...calculateLockedCollateral({
                cumulus: stats['cumulus-enabled'],
                nimbus: stats['nimbus-enabled'],
                stratus: stats['stratus-enabled']
            })
        };

        // ONE write, covering counts and collateral together: current_metrics is a
        // read-modify-write of a single row, so a second call could be interleaved by
        // another service in the cycle and lose one of the two sets of columns.
        await updateCurrentMetrics(nodeData);
        await updateSyncStatus('nodes', 'completed');

        log.info(
            { nodeData },
            'Node stats updated: %d nodes, %s FLUX locked',
            nodeData.node_total,
            nodeData.locked_collateral?.toLocaleString() ?? 'no'
        );

        return nodeData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching node stats');
        await updateSyncStatus('nodes', 'failed', error.message);
        throw error;
    }
}

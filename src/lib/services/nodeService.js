import { API_ENDPOINTS } from '../config.js';
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
            node_total: stats['total'] || 0
        };

        // Update current metrics in database
        await updateCurrentMetrics(nodeData);
        await updateSyncStatus('nodes', 'completed');

        log.info({ nodeData }, 'Node stats updated: %d nodes', nodeData.node_total);

        return nodeData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching node stats');
        await updateSyncStatus('nodes', 'failed', error.message);
        throw error;
    }
}

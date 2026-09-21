import { API_ENDPOINTS, WALLET_CONFIG } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('walletService');

// Timestamp of the last SUCCESSFUL count. Only successes refresh it, so a failed hour is
// retried on the next cycle rather than waiting out a full interval on stale state.
let lastSuccessMs = 0;

/**
 * Unique wallets running Flux nodes (issue #201).
 *
 * The deterministic node list carries one entry per node with the operator's
 * payment_address, so the number of distinct addresses is the number of distinct
 * node operators. That is a very different figure from the node count -- measured
 * 2026-09-21, 6,448 nodes were run by 830 wallets, ~7.8 nodes each -- which is why
 * this is a DISTINCT count and never a length.
 *
 * Uses: https://api.runonflux.io/daemon/viewdeterministiczelnodelist
 */
export async function fetchUniqueWallets() {
    try {
        log.info('Fetching deterministic node list for unique wallet count...');

        const body = await resilientFetch(API_ENDPOINTS.DETERMINISTIC_NODE_LIST, {
            timeout: 30000,     // ~4MB payload -- the default is not generous enough for it
            retries: 2,
            delayMs: 5000,
            breakerKey: 'flux-deterministic-nodelist',
            // An empty list is rejected here rather than downstream: a successful-looking
            // response with no nodes is an upstream fault, and letting it through would
            // persist a 0 that reads as "the network lost every operator".
            validate: d => d?.status === 'success' && Array.isArray(d.data) && d.data.length > 0
        });

        const wallets = new Set();
        for (const node of body.data) {
            // Falsy addresses are absence of information, not a wallet. Without this guard
            // every address-less entry collapses into one phantom wallet in the Set.
            if (node?.payment_address) wallets.add(node.payment_address);
        }

        if (wallets.size === 0) {
            throw new Error(`Node list had ${body.data.length} nodes but no payment addresses`);
        }

        const walletData = { unique_wallets: wallets.size };

        await updateCurrentMetrics(walletData);
        await updateSyncStatus('wallets', 'completed');
        lastSuccessMs = Date.now();

        log.info(
            { walletData, nodes: body.data.length },
            'Unique wallets updated: %d wallets across %d nodes (%s nodes/wallet)',
            wallets.size, body.data.length, (body.data.length / wallets.size).toFixed(2)
        );

        return walletData;

    } catch (error) {
        log.error({ err: error }, 'Error fetching unique wallet count');
        await updateSyncStatus('wallets', 'failed', error.message);
        throw error;
    }
}

/**
 * The service-cycle entry point.
 *
 * The cycle runs every few minutes but this payload is ~4MB and the answer barely moves
 * within an hour, so the fetch is gated to WALLET_CONFIG.updateInterval and the step is a
 * cheap no-op in between.
 *
 * The gate lives here rather than on its own setInterval for a specific reason:
 * updateCurrentMetrics() is a read-modify-write of the single current_metrics row, so a
 * wallet refresh firing on its own timer could land between another service's read and
 * write and silently drop that service's columns. Staying inside the sequential cycle is
 * what makes that impossible.
 */
export async function refreshUniqueWalletsIfStale() {
    const age = Date.now() - lastSuccessMs;
    if (lastSuccessMs > 0 && age < WALLET_CONFIG.updateInterval) {
        log.debug({ ageMs: age }, 'Unique wallet count still fresh, skipping fetch');
        return { skipped: true };
    }
    return fetchUniqueWallets();
}

/** Test seam — clears the freshness gate so each case starts from a cold cache. */
export function __resetWalletCacheForTests() {
    lastSuccessMs = 0;
}

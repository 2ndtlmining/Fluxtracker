// flux-performance-dashboard/src/lib/services/cryptoService.js

import axios from 'axios';
import { API_ENDPOINTS, CRYPTO_REPOS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Fetch crypto node statistics
 * Counts specific crypto repos running on the network
 */
export async function fetchCryptoStats() {
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
        try {
            console.log('🔍 Fetching crypto node statistics...');

            const response = await axios.get(
                API_ENDPOINTS.RUNNING_APPS,
                { timeout: 15000 }
            );

            if (response.data && response.data.status === 'error' && response.data.data) {
                const errorMessage = `API Error: ${response.data.data.name} - ${response.data.data.message}`;
                console.error(errorMessage);
                updateSyncStatus('crypto', 'failed', errorMessage);
                return; // Exit the function early
            }

            const appsData = response.data.data;

            // Check if appsData is an array or an object with a message
            if (Array.isArray(appsData)) {
                // Initialize counts for each crypto node
                const cryptoCounts = {};
                CRYPTO_REPOS.forEach(crypto => {
                    cryptoCounts[crypto.dbKey] = 0;
                });

                // Process each node's running apps
                appsData.forEach(app => {
                    if (app.apps && app.apps.runningapps) {
                        app.apps.runningapps.forEach(runningApp => {
                            const image = runningApp.Image || '';

                            // Check against all configured crypto repos
                            CRYPTO_REPOS.forEach(crypto => {
                                if (Array.isArray(crypto.imageMatch)) {
                                    crypto.imageMatch.some(match => image.includes(match)) ? cryptoCounts[crypto.dbKey]++ : null;
                                } else {
                                    if (image.includes(crypto.imageMatch)) {
                                        cryptoCounts[crypto.dbKey]++;
                                    }
                                }
                            });
                        });
                    }
                });

                // Calculate total
                const total = Object.values(cryptoCounts).reduce((sum, count) => sum + count, 0);

                // Build database update object
                const cryptoData = {
                    ...cryptoCounts,
                    crypto_nodes_total: total
                };

                // Update database
                updateCurrentMetrics(cryptoData);
                updateSyncStatus('crypto', 'completed');

                console.log('✅ Crypto stats updated:', cryptoData);

                return cryptoData;

            } else if (typeof appsData === 'object' && appsData.message) {
                // Handle error response
                const errorMessage = `API Error: ${appsData.name} - ${appsData.message}`;
                throw new Error(errorMessage);
            } else {
                // Handle unexpected data structure
                const errorMessage = `Unexpected data structure for appsData: ${JSON.stringify(appsData)}`;
                throw new Error(errorMessage);
            }

        } catch (error) {
            retries++;
            console.error(`❌ Attempt ${retries}/${MAX_RETRIES} Error fetching crypto stats:`, error.message);

            if (retries >= MAX_RETRIES) {
                updateSyncStatus('crypto', 'failed', error.message);
                throw new Error(error.message);
            }

            // Wait for a short duration before retrying
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds delay
        }
    }
}

/**
 * Format crypto stats for display
 */
export function formatCryptoStats(cryptoData) {
    return {
        total: cryptoData.crypto_nodes_total,
        nodes: CRYPTO_REPOS.map(crypto => ({
            name: crypto.name,
            count: cryptoData[crypto.dbKey] || 0,
            repo: crypto.imageMatch
        }))
    };
}

/**
 * Get breakdown by crypto category
 */
export function getCryptoBreakdown(cryptoData) {
    const total = cryptoData.crypto_nodes_total || 0;
    
    // Find specific repos dynamically
    const timpiCollector = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_timpi_collector');
    const timpiGeocore = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_timpi_geocore');
    const ravencoin = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_ravencoin');
    const kadena = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_kadena');
    const kaspa = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_kaspa');
    const alephium = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_alephium');
    const presearch = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_presearch');
    const streamr = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_streamr');
    const bittensor = CRYPTO_REPOS.find(c => c.dbKey === 'crypto_bittensor');
    
    const breakdown = {
        timpi: {
            count: (cryptoData[timpiCollector?.dbKey] || 0) + (cryptoData[timpiGeocore?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[timpiCollector?.dbKey] || 0) + (cryptoData[timpiGeocore?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        },
        mining: {
            count: (cryptoData[ravencoin?.dbKey] || 0) + (cryptoData[kadena?.dbKey] || 0) + (cryptoData[kaspa?.dbKey] || 0) + (cryptoData[alephium?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[ravencoin?.dbKey] || 0) + (cryptoData[kadena?.dbKey] || 0) + (cryptoData[kaspa?.dbKey] || 0) + (cryptoData[alephium?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        },
        other: {
            count: (cryptoData[presearch?.dbKey] || 0) + (cryptoData[streamr?.dbKey] || 0) + (cryptoData[bittensor?.dbKey] || 0),
            percentage: total > 0 ? (((cryptoData[presearch?.dbKey] || 0) + (cryptoData[streamr?.dbKey] || 0) + (cryptoData[bittensor?.dbKey] || 0)) / total * 100).toFixed(1) : 0
        }
    };
    
    return breakdown;
}
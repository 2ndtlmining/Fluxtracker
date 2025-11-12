import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Crypto repositories to track
 */
export const CRYPTO_REPOS = [
    {
        name: 'Presearch',
        image: 'presearch/node:latest',
        searchPattern: 'presearch/node'
    },
    {
        name: 'Streamr',
        image: 'streamr/node:latest',
        searchPattern: 'streamr/node'
    },
    {
        name: 'Ravencoin',
        image: 'dramirezrt/ravencoin-core-server:latest',
        searchPattern: 'dramirezrt/ravencoin-core-server'
    },
    {
        name: 'Kadena',
        image: 'runonflux/kadena-chainweb-node:latest',
        searchPattern: 'runonflux/kadena-chainweb-node'
    },
    {
        name: 'Alephium',
        image: 'touilleio/alephium-standalone:latest-root',
        searchPattern: 'touilleio/alephium-standalone'
    },
    {
        name: 'Bittensor',
        image: 'opentensor/subtensor:latest',
        searchPattern: 'opentensor/subtensor'
    },
    {
        name: 'Timpi Collector',
        image: 'timpiltd/timpi-collector:latest',
        searchPattern: 'timpiltd/timpi-collector'
    },
    {
        name: 'Timpi Geocore',
        image: 'timpiltd/timpi-geocore:latest',
        searchPattern: 'timpiltd/timpi-geocore'
    },
    {
        name: 'Kaspa',
        image: 'kaspanet/rusty-kaspad:latest',
        searchPattern: 'kaspanet/rusty-kaspad'
    }
];

/**
 * Fetch crypto node statistics
 * Counts specific crypto repos running on the network
 */
export async function fetchCryptoStats() {
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
        
        // Initialize counters for each crypto
        const counts = {
            presearch: 0,
            streamr: 0,
            ravencoin: 0,
            kadena: 0,
            alephium: 0,
            bittensor: 0,
            timpi_collector: 0,
            timpi_geocore: 0,
            kaspa: 0
        };
        
        
        
        // Process each node's running apps
        appsData.forEach(app => {
            if (app.apps && app.apps.runningapps) {
                app.apps.runningapps.forEach(runningApp => {
                    const image = runningApp.Image || '';
                    
                    // Check for each crypto repo
                    if (image.includes('presearch/node')) {
                        counts.presearch++;
                    }
                    if (image.includes('streamr/node')) {
                        counts.streamr++;
                    }
                    if (image.includes('dramirezrt/ravencoin-core-server')) {
                        counts.ravencoin++;
                    }
                    if (image.includes('runonflux/kadena-chainweb-node')) {
                        counts.kadena++;
                    }
                    if (image.includes('touilleio/alephium-standalone')) {
                        counts.alephium++;
                    }
                    if (image.includes('opentensor/subtensor')) {
                        counts.bittensor++;
                    }
                    if (image.includes('timpiltd/timpi-collector')) {
                        counts.timpi_collector++;
                    }
                    if (image.includes('timpiltd/timpi-geocore')) {
                        counts.timpi_geocore++;
                    }
                    if (image.includes('kaspanet/rusty-kaspad')) {
                        counts.kaspa++;
                    }
                });
            }
        });
        
        // Calculate total
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        
        const cryptoData = {
            crypto_presearch: counts.presearch,
            crypto_streamr: counts.streamr,
            crypto_ravencoin: counts.ravencoin,
            crypto_kadena: counts.kadena,
            crypto_alephium: counts.alephium,
            crypto_bittensor: counts.bittensor,
            crypto_timpi_collector: counts.timpi_collector,
            crypto_timpi_geocore: counts.timpi_geocore,
            crypto_kaspa: counts.kaspa,
            crypto_nodes_total: total
        };
        
        // Update database
        updateCurrentMetrics(cryptoData);
        updateSyncStatus('crypto', 'completed');
        
        console.log('✅ Crypto stats updated:', cryptoData);
        
        return cryptoData;
        
    } catch (error) {
        console.error('❌ Error fetching crypto stats:', error.message);
        updateSyncStatus('crypto', 'failed', error.message);
        throw error;
    }
}

/**
 * Format crypto stats for display
 */
export function formatCryptoStats(cryptoData) {
    return {
        total: cryptoData.crypto_nodes_total || 0,
        nodes: [
            {
                name: 'Presearch',
                count: cryptoData.crypto_presearch || 0,
                repo: 'presearch/node:latest'
            },
            {
                name: 'Streamr',
                count: cryptoData.crypto_streamr || 0,
                repo: 'streamr/node:latest'
            },
            {
                name: 'Ravencoin',
                count: cryptoData.crypto_ravencoin || 0,
                repo: 'dramirezrt/ravencoin-core-server:latest'
            },
            {
                name: 'Kadena',
                count: cryptoData.crypto_kadena || 0,
                repo: 'runonflux/kadena-chainweb-node:latest'
            },
            {
                name: 'Alephium',
                count: cryptoData.crypto_alephium || 0,
                repo: 'touilleio/alephium-standalone:latest-root'
            },
            {
                name: 'Bittensor',
                count: cryptoData.crypto_bittensor || 0,
                repo: 'opentensor/subtensor:latest'
            },
            {
                name: 'Timpi Collector',
                count: cryptoData.crypto_timpi_collector || 0,
                repo: 'timpiltd/timpi-collector:latest'
            },
            {
                name: 'Timpi Geocore',
                count: cryptoData.crypto_timpi_geocore || 0,
                repo: 'timpiltd/timpi-geocore:latest'
            },
            {
                name: 'Kaspa',
                count: cryptoData.crypto_kaspa || 0,
                repo: 'kaspanet/rusty-kaspad:latest'
            }
        ]
    };
}

/**
 * Get breakdown by crypto category
 */
export function getCryptoBreakdown(cryptoData) {
    const total = cryptoData.crypto_nodes_total || 0;
    
    const breakdown = {
        timpi: {
            count: (cryptoData.crypto_timpi_collector || 0) + (cryptoData.crypto_timpi_geocore || 0),
            percentage: total > 0 ? (((cryptoData.crypto_timpi_collector || 0) + (cryptoData.crypto_timpi_geocore || 0)) / total * 100).toFixed(1) : 0
        },
        mining: {
            count: (cryptoData.crypto_ravencoin || 0) + (cryptoData.crypto_kadena || 0) + (cryptoData.crypto_kaspa || 0) + (cryptoData.crypto_alephium || 0),
            percentage: total > 0 ? (((cryptoData.crypto_ravencoin || 0) + (cryptoData.crypto_kadena || 0) + (cryptoData.crypto_kaspa || 0) + (cryptoData.crypto_alephium || 0)) / total * 100).toFixed(1) : 0
        },
        other: {
            count: (cryptoData.crypto_presearch || 0) + (cryptoData.crypto_streamr || 0) + (cryptoData.crypto_bittensor || 0),
            percentage: total > 0 ? (((cryptoData.crypto_presearch || 0) + (cryptoData.crypto_streamr || 0) + (cryptoData.crypto_bittensor || 0)) / total * 100).toFixed(1) : 0
        }
    };
    
    return breakdown;
}
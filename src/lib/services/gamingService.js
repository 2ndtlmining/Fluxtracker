// flux-performance-dashboard/src/lib/services/gamingService.js

import axios from 'axios';
import { API_ENDPOINTS, GAMING_REPOS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Fetch gaming app statistics
 * Counts specific gaming repos running on the network
 */
export async function fetchGamingStats() {
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
        try {
            console.log('🔍 Fetching gaming statistics...');

            const response = await axios.get(
                API_ENDPOINTS.RUNNING_APPS,
                { timeout: 15000 }
            );

            if (response.data && response.data.status === 'error' && response.data.data) {
                const errorMessage = `API Error: ${response.data.data.name} - ${response.data.data.message}`;
                console.error(errorMessage);
                updateSyncStatus('gaming', 'failed', errorMessage);
                return; // Exit the function early
            }

            const appsData = response.data.data;

            // Check if appsData is an array or an object with a message
            if (Array.isArray(appsData)) {
                // Initialize counts for each game
                const gameCounts = {};
                GAMING_REPOS.forEach(game => {
                    gameCounts[game.dbKey] = 0;
                });

                // Process each node's running apps
                appsData.forEach(app => {
                    if (app.apps && app.apps.runningapps) {
                        app.apps.runningapps.forEach(runningApp => {
                            const image = runningApp.Image || '';

                            // Check against all configured gaming repos
                            GAMING_REPOS.forEach(game => {
                                if (Array.isArray(game.imageMatch)) {
                                    game.imageMatch.some(match => image.includes(match)) ? gameCounts[game.dbKey]++ : null;
                                } else {
                                    if (image.includes(game.imageMatch)) {
                                    gameCounts[game.dbKey]++;
                                }
                            }
                            });
                        });
                    }
                });

                // Calculate total
                const total = Object.values(gameCounts).reduce((sum, count) => sum + count, 0);

                // Build database update object
                const gamingData = {
                    ...gameCounts,
                    gaming_apps_total: total
                };

                // Update database
                updateCurrentMetrics(gamingData);
                updateSyncStatus('gaming', 'completed');

                console.log('✅ Gaming stats updated:', gamingData);

                return gamingData;

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
            console.error(`❌ Attempt ${retries}/${MAX_RETRIES} Error fetching gaming stats:`, error.message);

            if (retries >= MAX_RETRIES) {
                updateSyncStatus('gaming', 'failed', error.message);
                throw new Error(error.message);
            }

            // Wait for a short duration before retrying
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds delay
        }
    }
}

/**
 * Format gaming stats for display
 */
export function formatGamingStats(gamingData) {
    return {
        total: gamingData.gaming_apps_total,
        games: GAMING_REPOS.map(game => ({
            name: game.name,
            count: gamingData[game.dbKey] || 0,
            repo: game.imageMatch
        }))
    };
}
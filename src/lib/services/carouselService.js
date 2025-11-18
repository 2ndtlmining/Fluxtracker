// flux-performance-dashboard/src/lib/services/carouselService.js

import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';

// Cache for top apps data
let cachedTopApps = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

// Images to exclude from carousel (health check/monitoring apps)
const EXCLUDED_IMAGES = [
    'containrrr/watchtower',  // Health check image on all servers
    // Add more exclusions here if needed:
    // 'some/other-image',
];

/**
 * Fetch and process top 10 running apps
 * Returns array of { rank, name, count } objects
 */
export async function fetchTopApps() {
    try {
        console.log('🎠 Fetching top running apps for carousel...');
        
        const response = await axios.get(
            API_ENDPOINTS.RUNNING_APPS,
            { timeout: 15000 }
        );
        
        // Check for API error response
        if (response.data && response.data.status === 'error' && response.data.data) {
            const errorMessage = `API Error: ${response.data.data.name} - ${response.data.data.message}`;
            console.error(errorMessage);
            
            // Return cached data if available
            if (cachedTopApps) {
                console.log('⚠️  Using cached carousel data due to API error');
                return cachedTopApps;
            }
            
            throw new Error(errorMessage);
        }
        
        const appsData = response.data.data;
        
        // Check if appsData is valid
        if (!Array.isArray(appsData)) {
            throw new Error('Invalid data structure received from API');
        }
        
        // Count all running images across all nodes
        const imageCounts = {};
        
        appsData.forEach(node => {
            if (node.apps && node.apps.runningapps) {
                node.apps.runningapps.forEach(app => {
                    const image = app.Image || '';
                    
                    // Skip empty images
                    if (!image) return;
                    
                    // Skip excluded images (watchtower, etc.)
                    const isExcluded = EXCLUDED_IMAGES.some(excluded => 
                        image.toLowerCase().includes(excluded.toLowerCase())
                    );
                    if (isExcluded) return;
                    
                    // Use the full image name (just remove the tag for counting purposes)
                    const imageWithoutTag = image.split(':')[0];
                    
                    if (!imageCounts[imageWithoutTag]) {
                        imageCounts[imageWithoutTag] = {
                            name: imageWithoutTag,  // Full image name without tag
                            count: 0
                        };
                    }
                    
                    imageCounts[imageWithoutTag].count++;
                });
            }
        });
        
        // Convert to array and sort by count
        const sortedApps = Object.values(imageCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10) // Top 10 only
            .map((app, index) => ({
                rank: index + 1,
                name: app.name,
                count: app.count
            }));
        
        // Cache the results
        cachedTopApps = sortedApps;
        lastFetchTime = Date.now();
        
        console.log('✅ Top apps fetched:', sortedApps.length);
        console.log(`   #1: ${sortedApps[0]?.name || 'N/A'} (${sortedApps[0]?.count || 0})`);
        console.log(`   #2: ${sortedApps[1]?.name || 'N/A'} (${sortedApps[1]?.count || 0})`);
        console.log(`   #3: ${sortedApps[2]?.name || 'N/A'} (${sortedApps[2]?.count || 0})`);
        
        return sortedApps;
        
    } catch (error) {
        console.error('❌ Error fetching top apps:', error.message);
        
        // Return cached data if available
        if (cachedTopApps) {
            console.log('⚠️  Using cached carousel data due to fetch error');
            return cachedTopApps;
        }
        
        // If no cache, return empty array
        return [];
    }
}

/**
 * Get cached top apps (used by API endpoint)
 */
export function getCachedTopApps() {
    const cacheAge = Date.now() - lastFetchTime;
    const isFresh = cacheAge < CACHE_DURATION;
    
    return {
        apps: cachedTopApps || [],
        cached: !!cachedTopApps,
        cacheAge: Math.floor(cacheAge / 1000), // seconds
        fresh: isFresh
    };
}

/**
 * Format top apps for display
 */
export function formatTopApps(apps) {
    return {
        total: apps.length,
        apps: apps.map(app => ({
            rank: app.rank,
            name: app.name,
            count: app.count,
            percentage: apps.length > 0 
                ? ((app.count / apps.reduce((sum, a) => sum + a.count, 0)) * 100).toFixed(1)
                : 0
        }))
    };
}
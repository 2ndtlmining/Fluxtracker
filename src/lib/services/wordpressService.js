import axios from 'axios';
import { API_ENDPOINTS, WORDPRESS_CONFIG } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Check if an image name matches the WordPress pattern
 * Handles variations like:
 * - runonflux/wp-nginx
 * - runonflux/wp-nginx:latest
 * - runonflux/wp-nginx:v1.0
 */
function matchesWordPressImage(imageName) {
    if (!imageName) return false;
    
    const imageMatch = WORDPRESS_CONFIG.imageMatch;
    
    // Normalize the image name (lowercase for comparison)
    const normalizedImage = imageName.toLowerCase();
    const normalizedMatch = imageMatch.toLowerCase();
    
    // Check if image name starts with the match pattern
    // This handles both exact matches and tag variations
    return normalizedImage === normalizedMatch || 
           normalizedImage.startsWith(`${normalizedMatch}:`);
}

/**
 * Count WordPress instances from running apps data
 * @param {Array} nodes - Array of node objects with runningapps
 * @returns {number} - Total count of WordPress instances
 */
function countWordPressInstances(nodes) {
    if (!Array.isArray(nodes)) {
        console.warn('Invalid nodes data structure');
        return 0;
    }
    
    let totalCount = 0;
    
    for (const node of nodes) {
        // Navigate the nested structure: node.apps.runningapps
        const runningApps = node?.apps?.runningapps;
        
        if (Array.isArray(runningApps)) {
            // Count WordPress instances in this node
            const wpCount = runningApps.filter(app => 
                matchesWordPressImage(app.Image)
            ).length;
            
            totalCount += wpCount;
        }
    }
    
    return totalCount;
}

/**
 * Fetch WordPress statistics
 * Uses the same running apps API as gaming repos
 */
export async function fetchWordPressStats() {
    try {
        console.log('🔍 Fetching WordPress statistics...');
        console.log(`   API: ${API_ENDPOINTS.WORDPRESS}`);
        console.log(`   Looking for image: ${WORDPRESS_CONFIG.imageMatch}`);
        
        const response = await axios.get(
            API_ENDPOINTS.WORDPRESS,
            { 
                timeout: 15000
            }
        );
        
        // Validate response structure
        if (!response.data || response.data.status !== 'success') {
            throw new Error('Invalid API response structure');
        }
        
        const nodes = response.data.data;
        
        if (!Array.isArray(nodes)) {
            throw new Error('Expected data array from API');
        }
        
        // Count WordPress instances
        const wpCount = countWordPressInstances(nodes);
        
        console.log(`   📊 Found ${nodes.length} nodes`);
        console.log(`   ✅ Counted ${wpCount} WordPress instances`);
        
        const wordpressData = {
            wordpress_count: wpCount
        };
        
        // Update database
        updateCurrentMetrics(wordpressData);
        updateSyncStatus('wordpress', 'completed');
        
        console.log('✅ WordPress stats updated:', wordpressData);
        
        return wordpressData;
        
    } catch (error) {
        console.error('❌ Error fetching WordPress stats:', error.message);
        
        // Provide more context for common errors
        if (error.response) {
            console.error(`   HTTP ${error.response.status}: ${error.response.statusText}`);
        } else if (error.code === 'ECONNABORTED') {
            console.error('   Request timeout - API took too long to respond');
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error('   Network error - could not reach API');
        }
        
        updateSyncStatus('wordpress', 'failed', error.message);
        throw error;
    }
}

/**
 * Format WordPress stats for display
 */
export function formatWordPressStats(wordpressData) {
    return {
        count: wordpressData.wordpress_count,
        label: 'WordPress Instances'
    };
}

/**
 * Get WordPress configuration
 * Useful for debugging or displaying config info
 */
export function getWordPressConfig() {
    return {
        name: WORDPRESS_CONFIG.name,
        dbKey: WORDPRESS_CONFIG.dbKey,
        imageMatch: WORDPRESS_CONFIG.imageMatch,
        apiEndpoint: API_ENDPOINTS.WORDPRESS
    };
}
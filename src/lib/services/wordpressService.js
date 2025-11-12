import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Fetch WordPress statistics
 * Uses the JetpackBridge API
 */
export async function fetchWordPressStats() {
    try {
        console.log('🔍 Fetching WordPress statistics...');
        
        const response = await axios.get(
            API_ENDPOINTS.WORDPRESS,
            { 
                timeout: 15000,
                // Don't parse as JSON automatically, get raw data first
                transformResponse: [(data) => data]
            }
        );
        
        // The API returns a plain string like "605"
        let wpCount = 0;
        
        if (response.data) {
            // Remove quotes if present and parse as integer
            const cleanData = response.data.toString().replace(/"/g, '').trim();
            wpCount = parseInt(cleanData, 10) || 0;
        }
        
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
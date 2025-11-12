import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus } from '../db/database.js';

/**
 * Fetch node statistics from Flux API
 * Uses: https://api.runonflux.io/daemon/getzelnodecount
 */
export async function fetchNodeStats() {
    try {
        console.log('🔍 Fetching node statistics...');
        
        const response = await axios.get(
            `${API_ENDPOINTS.DAEMON}/getzelnodecount`,
            { timeout: 15000 }
        );
        
        if (response.data.status !== 'success') {
            throw new Error('Failed to fetch node stats');
        }
        
        const stats = response.data.data;
        
        const nodeData = {
            node_cumulus: stats['cumulus-enabled'] || 0,
            node_nimbus: stats['nimbus-enabled'] || 0,
            node_stratus: stats['stratus-enabled'] || 0,
            node_total: stats['total'] || 0
        };
        
        // Update current metrics in database
        updateCurrentMetrics(nodeData);
        updateSyncStatus('nodes', 'completed');
        
        console.log('✅ Node stats updated:', nodeData);
        
        return nodeData;
        
    } catch (error) {
        console.error('❌ Error fetching node stats:', error.message);
        updateSyncStatus('nodes', 'failed', error.message);
        throw error;
    }
}

/**
 * Get formatted node statistics
 */
export function formatNodeStats(nodeData) {
    const total = nodeData.node_total || 0;
    
    return {
        cumulus: {
            count: nodeData.node_cumulus || 0,
            percentage: total > 0 ? ((nodeData.node_cumulus / total) * 100).toFixed(1) : 0
        },
        nimbus: {
            count: nodeData.node_nimbus || 0,
            percentage: total > 0 ? ((nodeData.node_nimbus / total) * 100).toFixed(1) : 0
        },
        stratus: {
            count: nodeData.node_stratus || 0,
            percentage: total > 0 ? ((nodeData.node_stratus / total) * 100).toFixed(1) : 0
        },
        total: total
    };
}
// Flux Performance Dashboard Configuration

// ============================================
// FLUX ADDRESSES TO TRACK
// ============================================
export const TARGET_ADDRESSES = [
    't3NryfAQLGeFs9jEoeqsxmBN2QLRaRKFLUX', // Your main revenue address
    // Add more addresses here as needed
];

// ============================================
// FLUX Donation address 
// ============================================
export const DONATION_ADDRESSES = [
    't1ebxupkNYVQiswfwi7xBTwwKtioJqwLmUG' // Your main donation address

];

// ============================================
// BLOCKCHAIN CONFIGURATION
// ============================================
// Updated for new block speed (30 seconds per block)
export const BLOCK_CONFIG = {
    SECONDS_PER_BLOCK: 30,           // 30 seconds per block (was 120)
    BLOCKS_PER_DAY: 2880,            // 24 * 60 * 60 / 30 = 2,880 blocks
    BLOCKS_PER_WEEK: 20160,          // 2,880 * 7 = 20,160 blocks
    BLOCKS_PER_MONTH: 86400,         // 2,880 * 30 = 86,400 blocks
    BLOCKS_PER_QUARTER: 259200,      // 2,880 * 90 = 259,200 blocks
    BLOCKS_PER_YEAR: 1051200,        // 2,880 * 365 = 1,051,200 blocks
    INCREMENTAL_THRESHOLD: 2880
};

// ============================================
// API ENDPOINTS
// ============================================
export const API_ENDPOINTS = {
    // Flux Core APIs
    FLUX_BASE: 'https://api.runonflux.io',
    EXPLORER: 'https://api.runonflux.io/explorer',
    APPS: 'https://api.runonflux.io/apps',
    DAEMON: 'https://api.runonflux.io/daemon',
    BLOCKBOOK: 'https://blockbook.runonflux.io/api/v2/',
    BLOCKBOOK2: 'https://blockbookflux.app.runonflux.io/api/v2/',
    //not using the backups just yet
    // Stats APIs
    STATS_BASE: 'https://stats.runonflux.io',
    RUNNING_APPS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
    
    // WordPress API
    WORDPRESS: 'https://jetpackbridge.runonflux.io/api/v1/wordpress.php?action=COUNT',
    
    // Price APIs
    PRICE_PRIMARY: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    PRICE_FALLBACK: 'https://explorer.runonflux.io/api/currency',
};

// ============================================
// GAMING REPOSITORIES TO TRACK
// ============================================
export const GAMING_REPOS = [
    {
        name: 'Palworld',
        dbKey: 'gaming_palworld',
        imageMatch: 'thijsvanloef/palworld-server-docker'
    },
    {
        name: 'Enshrouded',
        dbKey: 'gaming_enshrouded',
        imageMatch: 'jktuned/enshrouded-server'
    },
    {
        name: 'Minecraft',
        dbKey: 'gaming_minecraft',
        imageMatch: [
            'itzg/minecraft-server',
            'itzg/minecraft-bedrock-server'
        ]
    }
    // Add new games here:
    // {
    //     name: 'Valheim',
    //     dbKey: 'gaming_valheim',
    //     imageMatch: 'lloesche/valheim-server'
    // }
];

// ============================================
// REVENUE CALCULATION CONFIG
// ============================================
export const REVENUE_CONFIG = {
    updateInterval: 2 * 60 * 1000,      // Update every 2 minutes
    enableCache: true,                   // Enable revenue caching
    cacheDuration: 60 * 1000,           // Cache for 1 minute
    
    // Block-based periods (updated for new block speed)
    blockPeriods: {
        day: 2880,                       // ~24 hours
        week: 20160,                     // ~7 days
        month: 86400,                    // ~30 days
        quarter: 259200,                 // ~90 days
        year: 1051200                    // ~365 days
    }
};

// ============================================
// CLOUD UTILIZATION CONFIG
// ============================================
export const CLOUD_CONFIG = {
    updateInterval: 5 * 60 * 1000,      // Update every 5 minutes
    trackApps: true,                     // Track running apps count
    trackResources: true,                // Track CPU, RAM, Storage
    trackWatchtower: true,               // Track Watchtower instances
};

// ============================================
// GAMING TRACKING CONFIG
// ============================================
export const GAMING_CONFIG = {
    updateInterval: 10 * 60 * 1000,     // Update every 10 minutes
    repos: GAMING_REPOS,                 // Gaming repos to track
    enableCache: true,
    cacheDuration: 5 * 60 * 1000,       // Cache for 5 minutes
};

// ============================================
// WORDPRESS TRACKING CONFIG
// ============================================
export const WORDPRESS_CONFIG = {
    updateInterval: 10 * 60 * 1000,     // Update every 10 minutes
    apiUrl: API_ENDPOINTS.WORDPRESS,
    enableCache: true,
    cacheDuration: 5 * 60 * 1000,       // Cache for 5 minutes
};

// ============================================
// UI CONFIGURATION
// ============================================
export const UI_CONFIG = {
    defaultCurrency: 'FLUX',             // Default currency display
    enableCurrencyToggle: true,          // Allow USD/FLUX toggle
    theme: 'terminal',                   // Terminal theme (like your existing app)
    refreshInterval: 30000,              // UI refresh rate (30 seconds)
    
    // Dashboard colors (matching your terminal theme)
    colors: {
        primary: '#3b82f6',              // Blue
        success: '#10b981',              // Green
        warning: '#f59e0b',              // Orange
        danger: '#ef4444',               // Red
        info: '#06b6d4',                 // Cyan
        purple: '#a855f7',               // Purple
    }
};

// ============================================
// PERFORMANCE CONFIG
// ============================================
export const PERFORMANCE_CONFIG = {
    ENABLE_METRICS: true,                // Enable performance tracking
    LOG_API_CALLS: false,                // Log API calls (for debugging)
    MAX_CACHE_SIZE: 100,                 // Maximum cache entries
    REQUEST_TIMEOUT: 15000,              // API timeout (15 seconds)
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get the full API URL for address transactions
 */
export function getAddressUrl(address) {
    return `${API_ENDPOINTS.EXPLORER}/address/${address}`;
}

/**
 * Get block height URL
 */
export function getBlockHeightUrl() {
    return `${API_ENDPOINTS.DAEMON}/getblockcount`;
}

/**
 * Get apps running URL
 */
export function getAppsUrl() {
    return `${API_ENDPOINTS.APPS}/globalappsspecifications`;
}

/**
 * Calculate blocks for custom time period (in hours)
 */
export function blocksForHours(hours) {
    return Math.floor((hours * 60 * 60) / BLOCK_CONFIG.SECONDS_PER_BLOCK);
}

/**
 * Calculate time for blocks (returns hours)
 */
export function hoursForBlocks(blocks) {
    return (blocks * BLOCK_CONFIG.SECONDS_PER_BLOCK) / 3600;
}

// Configuration for API endpoints
// This allows the frontend to connect to the backend in different environments

// IMPORTANT: Don't use this directly in components - use getApiUrl() instead
export const API_BASE_URL = 'http://localhost:3000';  // Fallback only

// For server-side rendering, use localhost
export const API_BASE_URL_SSR = 'http://localhost:3000';

// Helper to get the correct API URL based on context
export function getApiUrl() {
    // CRITICAL: Check if we're in browser AND if window.location is actually available
    // During SSR, window might exist but not be properly initialized
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
        // We're in the browser - use the current hostname with API port 3000
        const hostname = window.location.hostname;
        console.log('[config] Browser mode - API URL:', `http://${hostname}:3000`);
        return `http://${hostname}:3000`;
    }
    
    // We're on the server (SSR) - use localhost for internal Docker communication
    console.log('[config] SSR mode - API URL: http://localhost:3000');
    return 'http://localhost:3000';
}
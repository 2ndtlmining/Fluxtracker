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

export const SYNC_INTERVALS = {
    REVENUE: 5 * 60 * 1000,      // 5 minutes (for progressive transaction sync)
    CLOUD: 10 * 60 * 1000,       // 10 minutes
    SNAPSHOT: 24 * 60 * 60 * 1000, // 24 hours (daily)
};

// ============================================
// RATE LIMITING
// ============================================

export const RATE_LIMITS = {
    // Delay between individual transaction detail fetches (milliseconds)
    TX_DETAIL_DELAY: 100,  // 100ms = max 10 tx/second
    
    // Delay between page fetches (milliseconds)
    PAGE_FETCH_DELAY: 500,  // 500ms = max 2 pages/second
    
    // Max retries for failed API calls
    MAX_RETRIES: 3,
    
    // Exponential backoff base (milliseconds)
    RETRY_BASE_DELAY: 1000
};

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

// ============================================
// DYNAMIC API URL CONFIGURATION
// ============================================

/**
 * CRITICAL FIX: Get the correct API URL based on environment
 * This function dynamically determines the backend API URL based on:
 * 1. Environment variables (for explicit configuration)
 * 2. Current hostname (for production deployment)
 * 3. Fallback to localhost (for SSR/development)
 * 
 * IMPORTANT: This function MUST be called in onMount() or client-side only,
 * NOT during module initialization or SSR.
 */
export function getApiUrl() {
    // CRITICAL: Only run this in the browser, never during SSR
    if (typeof window === 'undefined') {
        // During SSR, return empty string - components should handle this
        return '';
    }

    // Check for explicit environment variable override
    // This can be set during build: VITE_API_URL=http://your-api-server:3000
    if (import.meta.env.VITE_API_URL) {
        console.log('[config] Using VITE_API_URL:', import.meta.env.VITE_API_URL);
        return import.meta.env.VITE_API_URL;
    }

    // Get current browser location
    const protocol = window.location.protocol; // 'http:' or 'https:'
    const hostname = window.location.hostname; // e.g., 'localhost', '127.0.0.1', or '149.154.176.158'
    
    // Determine API port (default 3000, but can be overridden)
    const apiPort = import.meta.env.VITE_API_PORT || '3000';
    
    // Construct the API URL using the SAME protocol and hostname as the frontend
    const apiUrl = `${protocol}//${hostname}:${apiPort}`;
    
    console.log('[config] Dynamic API URL:', apiUrl);
    return apiUrl;
}

/**
 * Alternative function for SSR contexts (server-side rendering)
 * This always returns localhost for internal Docker communication
 */
export function getApiUrlSSR() {
    return 'http://localhost:3000';
}

// Fallback constants (do not use these directly - use getApiUrl() instead)
export const API_BASE_URL = 'http://localhost:3000';  // Fallback only
export const API_BASE_URL_SSR = 'http://localhost:3000'; // SSR only
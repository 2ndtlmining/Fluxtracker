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

// Initial sync lookback for first run.
// 1,500,000 covers all Flux history (chain launched ~2018, mixed 120s/30s blocks).
// Increase if you need more. The getaddresstxids API handles large ranges natively.
export const INITIAL_SYNC_LOOKBACK_BLOCKS = 2000000;

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
    
    // WordPress API - UPDATED to use running apps endpoint
    WORDPRESS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
    
    // Price APIs (tried in order)
    PRICE_COINGECKO: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    PRICE_PRIMARY: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    PRICE_EXPLORER: 'https://explorer.runonflux.io/api/currency',
    PRICE_CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data/price?fsym=FLUX&tsyms=USD',
    PRICE_HISTORY_CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=FLUX&tsym=USD&limit=2000',
    PRICE_FALLBACK: 'https://explorer.runonflux.io/api/currency',

    //cloud stats
    API_FLUX_NETWORK_UTILISATION: 'https://stats.runonflux.io/fluxinfo?projection=apps.resources',
    API_NODE_BENCHMARKS: 'https://stats.runonflux.io/fluxinfo?projection=benchmark',
    API_NODE_GEOLOCATION: 'https://stats.runonflux.io/fluxinfo?projection=geolocation',
};

// ============================================
// GAMING REPOSITORIES TO TRACK
// ============================================
export const GAMING_REPOS = [
    {
        name: 'Palworld',
        dbKey: 'gaming_palworld',
        imageMatch: [
            'thijsvanloef/palworld-server-docker'

        ]
    },
    {
        name: 'Enshrouded',
        dbKey: 'gaming_enshrouded',
        imageMatch: [
            'jktuned/enshrouded-server',
            'sknnr/enshrouded-dedicated-server'
        ]
    },
    {
        name: 'Minecraft',
        dbKey: 'gaming_minecraft',
        imageMatch: [
            'itzg/minecraft-server',
            'itzg/minecraft-bedrock-server'
        ]
    },
    {
        name: 'Valheim',
        dbKey: 'gaming_valheim',
        imageMatch: [
            'mbround18/valheim',
            'littlestache/valheim-flux'
        ] 
    },
    {
        name: 'Satisfactory',
        dbKey: 'gaming_satisfactory',
        imageMatch: 'wolveix/satisfactory-server'
    },


    // Add new games here:
    // {
    //     name: 'Rust',
    //     dbKey: 'gaming_rust',
    //     imageMatch: 'rust'
    // }
];

// ============================================
// CRYPTO NODE REPOSITORIES TO TRACK
// ============================================
export const CRYPTO_REPOS = [
    {
        name: 'Presearch',
        dbKey: 'crypto_presearch',
        imageMatch: 'presearch/node'
    },
    {
        name: 'Streamr',
        dbKey: 'crypto_streamr',
        imageMatch: 'streamr/node'
    },
    {
        name: 'Ravencoin',
        dbKey: 'crypto_ravencoin',
        imageMatch: 'dramirezrt/ravencoin-core-server'
    },
    {
        name: 'Kadena',
        dbKey: 'crypto_kadena',
        imageMatch: 'runonflux/kadena-chainweb-node'
    },
    {
        name: 'Alephium',
        dbKey: 'crypto_alephium',
        imageMatch: 'touilleio/alephium-standalone'
    },
    {
        name: 'Bittensor',
        dbKey: 'crypto_bittensor',
        imageMatch: 'opentensor/subtensor'
    },
    {
        name: 'Timpi Collector',
        dbKey: 'crypto_timpi_collector',
        imageMatch: 'timpiltd/timpi-collector'
    },
    {
        name: 'Timpi Geocore',
        dbKey: 'crypto_timpi_geocore',
        imageMatch: 'timpiltd/timpi-geocore'
    },
    {
        name: 'Kaspa',
        dbKey: 'crypto_kaspa',
        imageMatch: 'kaspanet/rusty-kaspad'
    }

    // Add new crypto nodes here:
    // {
    //     name: 'Ergo',
    //     dbKey: 'crypto_ergo',
    //     imageMatch: 'ergoplatform/ergo'
    // }
];

// ============================================
// WORDPRESS CONFIGURATION
// ============================================
export const WORDPRESS_CONFIG = {
    name: 'WordPress',
    dbKey: 'wordpress_count',
    // Match WordPress nginx image with or without tag
    imageMatch: 'runonflux/wp-nginx',
    updateInterval: 10 * 60 * 1000,     // Update every 10 minutes
    enableCache: true,
    cacheDuration: 5 * 60 * 1000,       // Cache for 5 minutes
};

// ============================================
// EXCLUDED TRANSACTION PATTERNS
// ============================================
export const EXCLUDED_TRANSACTIONS = [
    {
        from_address: 't1Mzja9iJcEYeW5B4m4s1tJG8M42odFZ16A',
        amount: 0.02  // FLUX (app spec-change fee – treated as free for end user)
    }
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
// UI CONFIGURATION
// ============================================
export const UI_CONFIG = {
    defaultCurrency: 'FLUX',             // Default currency display
    enableCurrencyToggle: true,          // Allow USD/FLUX toggle
    theme: 'terminal',                   // Terminal theme (like your existing app)
    refreshInterval: 60000,              // UI refresh rate (60 seconds)
    
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
// REVENUE SYNC TUNING
// ============================================
export const REVENUE_SYNC = {
    TXID_CHUNK_SIZE: 50000,         // Blocks per API call — conservative to avoid public API timeouts
    DB_FLUSH_SIZE: 200,             // Write to DB every N payments so graphs update progressively
    APP_NAME_BATCH_SIZE: 10,        // Concurrent app-name lookups per batch
    AUDIT_LOOKBACK_BLOCKS: 4320,    // ~3 days of blocks for audit re-scan
    AUDIT_BATCH_SIZE: 10,           // Concurrent fetches during audit retry
    PRICE_HISTORY_BATCH_SIZE: 1000, // Rows per insert batch for price history backfill
};

// ============================================
// SNAPSHOT TUNING
// ============================================
export const SNAPSHOT_CONFIG = {
    CHECK_INTERVAL_MS: 30 * 60 * 1000,  // Check every 30 minutes
    GRACE_PERIOD_MINUTES: 5,             // Wait 5 minutes after midnight before snapshotting
    MIN_VALID_METRICS: 2,                // Minimum non-zero key metrics required
    MAX_METRIC_AGE_HOURS: 24,            // Accept metrics up to this many hours old
    MAX_REPO_RETRIES: 5,                 // Max retries for missing repo snapshot data
};

// ============================================
// BACKUP TUNING
// ============================================
export const BACKUP_CONFIG = {
    RETENTION_DAYS: 30,              // Keep backups for this many days
    UPLOAD_MAX_RETRIES: 3,           // Retry failed S3 uploads this many times
    UPLOAD_INITIAL_BACKOFF_MS: 1000, // First retry delay (quadrupled each retry: 1s, 4s, 16s)
};

// ============================================
// CIRCUIT BREAKER TUNING
// ============================================
export const CIRCUIT_BREAKER_CONFIG = {
    FAILURE_THRESHOLD: 5,   // Consecutive failures before tripping to OPEN
    COOLDOWN_MS: 60_000,    // Time in OPEN before probing (HALF_OPEN)
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
// SINGLE-PORT ARCHITECTURE API URL
// ============================================

/**
 * FINAL FIX: API URL for single-port architecture
 * 
 * Since Flux only exposes port 37000 for the domain, we serve everything
 * through the same port. SvelteKit's hooks.server.js proxies /api/* requests
 * to the Express backend on port 3000 internally.
 * 
 * How it works:
 * 1. Browser makes request to: http://fluxtracker.app.runonflux.io:37000/api/health
 * 2. SvelteKit server (running on port 5173, exposed as 37000) receives the request
 * 3. hooks.server.js sees "/api/" prefix and proxies to http://localhost:3000/api/health
 * 4. Express backend responds
 * 5. SvelteKit forwards response back to browser
 * 
 * This way, from the browser's perspective, everything comes from the same origin!
 * 
 * Access patterns:
 * - Development: http://localhost:5173/api/... → proxied to http://localhost:3000/api/...
 * - Production IP: http://149.154.176.249:37000/api/... → proxied to http://localhost:3000/api/...
 * - Production Domain: http://fluxtracker.app.runonflux.io:37000/api/... → proxied to http://localhost:3000/api/...
 */
export function getApiUrl() {
    // CRITICAL: Only run this in the browser, never during SSR
    if (typeof window === 'undefined') {
        // During SSR, return empty string - components should handle this
        return '';
    }

    // Check for explicit environment variable override
    if (import.meta.env.VITE_API_URL) {
        console.log('[config] Using VITE_API_URL:', import.meta.env.VITE_API_URL);
        return import.meta.env.VITE_API_URL;
    }

    // Use the SAME origin (protocol + hostname + port) as the frontend
    // The SvelteKit server will proxy /api/* requests to the Express backend
    const origin = window.location.origin;
    return origin;
}



// ============================================
// DYNAMIC CATEGORY CONFIG (for repo_snapshots)
// ============================================
export const CATEGORY_CONFIG = {
    gaming: {
        label: 'Gaming',
        keywords: ['minecraft', 'palworld', 'enshrouded', 'valheim', 'satisfactory',
                   'ark-survival', 'arkserver', 'rust-server', 'terraria', 'factorio',
                   '7daystodie', 'vrising', 'projectzomboid', 'conan-exiles',
                   'game-server', 'arma-reforger', 'soulmask', 'abioticfactor'],
        icon: 'Gamepad2'
    },
    crypto: {
        label: 'Crypto Nodes',
        // NOTE: Be specific! 'node' alone matches Node.js apps. Use full image paths where possible.
        keywords: [
            // Search/data nodes
            'presearch/node', 'streamr/node', 'streamr/broker-node',
            // PoW chains
            'ravencoin', 'kadena-chainweb', 'bitcoin-core', 'bitcoin-cash-node',
            'litecoin', 'dogecoin', 'zcash', 'monero', 'fironode', 'firod',
            'neoxa-node', 'iron-fish/ironfish',
            // PoS / Smart contract chains
            'rusty-kaspad', 'alephium-standalone', 'alephium/explorer',
            'bittensor', 'subtensor', 'client-go:stable', 'polkadot-docker',
            'wanchain/client-go', 'thornode', 'thorchain',
            // Other crypto services
            'timpi-collector', 'timpi-geocore', 'beldex',
            'mysteriumnetwork/myst',
        ],
        icon: 'Coins'
    },
    wordpress: {
        label: 'WordPress',
        keywords: ['wordpress', 'wp-nginx'],
        icon: 'Globe'
    }
};

// Map image name -> category using keyword substring match
export function categorizeImage(imageName) {
    const lower = imageName.toLowerCase();
    for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
        if (config.keywords.some(kw => lower.includes(kw))) {
            return category;
        }
    }
    return null;
}

// Clean display name: "runonflux/kadena-chainweb-node:latest" -> "Kadena"
// Strips common suffixes like -server, -node, -docker, -dedicated, etc.
const DISPLAY_NAME_OVERRIDES = {
    'presearch/node': 'Presearch',
    'kaspanet/rusty-kaspad': 'Kaspa',
    'itzg/minecraft-server': 'Minecraft',
    'itzg/minecraft-bedrock-server': 'Minecraft BE',
    'thijsvanloef/palworld-server-docker': 'Palworld',
    'jktuned/enshrouded-server': 'Enshrouded',
    'sknnr/enshrouded-dedicated-server': 'Enshrouded',
    'mbround18/valheim': 'Valheim',
    'littlestache/valheim-flux': 'Valheim',
    'wolveix/satisfactory-server': 'Satisfactory',
    'opentensor/subtensor': 'Bittensor',
    'timpiltd/timpi-collector': 'Timpi Collector',
    'timpiltd/timpi-geocore': 'Timpi Geocore',
    'runonflux/kadena-chainweb-node': 'Kadena',
    'touilleio/alephium-standalone': 'Alephium',
    'streamr/node': 'Streamr',
    'dramirezrt/ravencoin-core-server': 'Ravencoin',
    'runonflux/wp-nginx': 'WordPress',
    'runonflux/fironode': 'Firo',
    'runonflux/neoxa-node': 'Neoxa',
    'ethereum/client-go': 'Ethereum',
    'ruimarinho/bitcoin-core': 'Bitcoin',
    'zquestz/bitcoin-cash-node': 'Bitcoin Cash',
    'streamr/broker-node': 'Streamr Broker',
    'beldex/beldex-master-node': 'Beldex',
    'alephium/explorer-backend': 'Alephium Explorer BE',
    'alephium/explorer': 'Alephium Explorer',
    'thetrunk/alephium-standalone': 'Alephium',
    'firoorg/firod': 'Firo',
    'ghcr.io/iron-fish/ironfish': 'Iron Fish',
    'runonflux/polkadot-docker': 'Polkadot',
    'wanchain/client-go': 'Wanchain',
    'mysteriumnetwork/myst': 'Mysterium',
    'registry.gitlab.com/thorchain/thornode': 'THORChain',
    'thmhoag/arkserver': 'ARK Survival',
    'rouhim/arma-reforger-server': 'Arma Reforger',
    'kagurazakanyaa/soulmask': 'Soulmask',
    'littlestache/abioticfactorserver': 'Abiotic Factor',
    'factoriotools/factorio': 'Factorio',
    'littlestache/rust-server': 'Rust',
    'littlestache/terraria': 'Terraria',
};

export function getDisplayName(imageName) {
    // Check for exact overrides first (strip tag)
    const noTag = imageName.split(':')[0];
    if (DISPLAY_NAME_OVERRIDES[noTag]) {
        return DISPLAY_NAME_OVERRIDES[noTag];
    }

    // Fallback: clean up the image name
    let name = noTag.split('/').pop();
    // Remove common suffixes
    name = name.replace(/[-_](server|node|docker|dedicated|standalone|core|flux)$/gi, '');
    name = name.replace(/[-_]/g, ' ').trim();
    return name.replace(/\b\w/g, c => c.toUpperCase());
}


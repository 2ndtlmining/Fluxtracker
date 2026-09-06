// Flux Performance Dashboard Configuration

export const APP_VERSION = 'v1.03';

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
    't1aUmu7HDr7BtwmdR1Y9i2K6KFRZs4Bumbt' // Your main donation address

];

// ============================================
// FLUX TEAM ADDRESSES (for UI highlighting)
// ============================================
export const FLUX_TEAM_ADDRESSES = [
    't1gjUUxBpBeVC1sWwAFrtSsVCbSaFdZx8UY', // Flux team primary
    // Add more Flux team addresses here as needed
];

// ============================================
// FLUX FIAT GATEWAY ADDRESSES
// ============================================
// Payments made through Flux's fiat on-ramp arrive from these addresses. Splitting them out
// separates "someone paid with a card" from "someone paid with FLUX they already held",
// which are very different signals about how the network is being bought into.
//
// A list, like FLUX_TEAM_ADDRESSES, because gateways get rotated and added. Everything
// downstream takes the whole array — the badge, the CSV Source column and the KPI query all
// handle any number of entries, so adding one here is the only change needed.
//
// NOTE: if Flux adds a gateway and it isn't listed here, the Fiat metric silently
// under-reports rather than erroring. Worth re-checking against a known fiat purchase
// whenever the figure looks off.
export const FLUX_FIAT_ADDRESSES = [
    't1XktDZ9Z1QiefMYE5nMFohe8VG2c2BD5A5', // Flux fiat gateway
    // Add further gateway addresses here as they appear
];

export function isFluxFiatAddress(address) {
    return FLUX_FIAT_ADDRESSES.includes(address);
}

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
    FLUXINFO: 'https://stats.runonflux.io/fluxinfo?projection=flux',
    RUNNING_APPS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
    
    // WordPress API - UPDATED to use running apps endpoint
    WORDPRESS: 'https://stats.runonflux.io/fluxinfo?projection=apps.runningapps.Image',
    
    // Price APIs (tried in order)
    PRICE_COINGECKO: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    PRICE_PRIMARY: 'https://api.coingecko.com/api/v3/simple/price?ids=zelcash&vs_currencies=usd',
    PRICE_EXPLORER: 'https://explorer.runonflux.io/api/currency',
    PRICE_CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data/price?fsym=FLUX&tsyms=USD',
    PRICE_FALLBACK: 'https://explorer.runonflux.io/api/currency',

    // Historical daily price sources (tried in order by priceHistoryService).
    // NOTE: CryptoCompare/CoinDesk started returning HTTP 401 "API key required" for both the
    // simple-price and histoday endpoints, which silently froze flux_price_history. Binance and
    // CoinGecko need no key and are now the primary sources.
    // Binance: 1000 daily candles per call, append &startTime=<ms> to page further back.
    // Candles are arrays: [0] openTime(ms, UTC midnight) ... [4] close. FLUXUSDT is quoted in
    // USDT, which we treat as ~USD (same assumption the rest of the dashboard already makes).
    PRICE_HISTORY_BINANCE: 'https://api.binance.com/api/v3/klines?symbol=FLUXUSDT&interval=1d&limit=1000',
    // CoinGecko: ~366 daily points, shape { prices: [[msTimestamp, price], ...] }
    PRICE_HISTORY_COINGECKO: 'https://api.coingecko.com/api/v3/coins/zelcash/market_chart?vs_currency=usd&days=365',
    // CryptoCompare: only usable when CRYPTOCOMPARE_API_KEY is set (Authorization: Apikey <key>)
    PRICE_HISTORY_CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=FLUX&tsym=USD&limit=2000',

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
            'thijsvanloef/palworld-server-docker',
            // Flux's own packaging of the same game. Omitting it made the featured
            // Palworld metric read 170 while the category card read 266.
            'runonflux/palworld-server-flux'
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
            'littlestache/valheim-flux',
            'lloesche/valheim-server'
        ]
    },
    {
        name: 'Satisfactory',
        dbKey: 'gaming_satisfactory',
        imageMatch: 'wolveix/satisfactory-server'
    },
    {
        name: 'Rust',
        dbKey: 'gaming_rust',
        imageMatch: [
            'littlestache/rust-server',
            'pfeiffermax/rust-game-server'
        ]
    },
    {
        name: 'Terraria',
        dbKey: 'gaming_terraria',
        imageMatch: 'littlestache/terraria'
    },
    {
        name: 'ARK Survival',
        dbKey: 'gaming_ark',
        imageMatch: 'thmhoag/arkserver'
    },
    {
        name: 'Windrose',
        dbKey: 'gaming_windrose',
        imageMatch: 'indifferentbroccoli/windrose-server-docker'
    },

    // Add new games here:
    // {
    //     name: 'Factorio',
    //     dbKey: 'gaming_factorio',
    //     imageMatch: 'factoriotools/factorio'
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
// CURRENT_METRICS COLUMNS
// ============================================
// The single source of truth for which columns updateCurrentMetrics() persists.
// Derived from the repo config so adding a game/node here is enough — both adapters used
// to hardcode this list, which silently dropped any newly configured repo's counts even
// though schemaMigrator had already created the column.
const FIXED_METRIC_COLUMNS = [
    'current_revenue', 'flux_price_usd',
    'total_cpu_cores', 'used_cpu_cores', 'cpu_utilization_percent',
    'total_ram_gb', 'used_ram_gb', 'ram_utilization_percent',
    'total_storage_gb', 'used_storage_gb', 'storage_utilization_percent',
    'total_apps', 'watchtower_count',
    'gitapps_count', 'dockerapps_count', 'gitapps_percent', 'dockerapps_percent',
    'gaming_apps_total', 'crypto_nodes_total', 'wordpress_count',
    'node_cumulus', 'node_nimbus', 'node_stratus', 'node_total'
];

export const METRIC_COLUMNS = [
    ...FIXED_METRIC_COLUMNS,
    ...GAMING_REPOS.map(r => r.dbKey),
    ...CRYPTO_REPOS.map(r => r.dbKey)
];

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
// CAROUSEL CONFIG
// ============================================
export const CAROUSEL_CONFIG = {
    updateInterval: 10 * 60 * 1000,     // Refresh carousel data every 10 minutes
    // Data older than this is no longer advertised as "LIVE" in the UI.
    // Kept at 2x the update interval so a single missed cycle isn't reported as stale.
    freshnessThreshold: 20 * 60 * 1000,
};

// ============================================
// DASHBOARD REFRESH
// ============================================
// One interval for every card so the header, metric cards, category cards and carousel
// can't drift apart on screen. Matches the shortest backend service interval.
export const DASHBOARD_REFRESH_MS = 5 * 60 * 1000;

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

// Per-endpoint breaker for OUTBOUND API fetches (resilientFetch + fetchBreaker). The DB
// breaker above protects the database; this one stops the services from hammering a dead
// Flux/exchange API for the whole cooldown instead of timing out on every cycle.
export const FETCH_CIRCUIT_BREAKER_CONFIG = {
    FAILURE_THRESHOLD: 5,   // Consecutive failed calls to the same endpoint before OPEN
    COOLDOWN_MS: 60_000,    // Time in OPEN before a single probe is allowed (HALF_OPEN)
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

/**
 * Check if an address belongs to the Flux team
 */
export function isFluxTeamAddress(address) {
    return FLUX_TEAM_ADDRESSES.includes(address);
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
                   'game-server', 'arma-reforger', 'soulmask', 'abioticfactor', 'windrose', 'unturned', 'garrysmod'],
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
            // Beldex masternodes. `beldex` above never matched these: girderworks is a
            // third party packaging Beldex for Flux and its image names carry no chain
            // identifier at all, so 892 containers — the largest single crypto deployment
            // on the network — sat uncategorised (issue #74). Identified from the image
            // labels (org.opencontainers.image.title=beldex-node) and by running
            // beldexd/beldex-storage/belnet inside the container. Matched on the whole
            // namespace, not the two current repo names, because a renamed or added repo
            // from the same packager would otherwise drop out silently — which is exactly
            // how this went unnoticed. Revisit if girderworks ever ships a non-node image.
            'girderworks/',
            'neoxa-node', 'iron-fish/ironfish',
            // PoS / Smart contract chains
            'rusty-kaspad', 'alephium-standalone', 'alephium/explorer',
            'bittensor', 'subtensor', 'client-go:stable', 'polkadot-docker',
            'wanchain/client-go', 'thornode', 'thorchain',
            // Chain indexers, explorers and nodes whose image names miss every keyword
            // above (issue #74, Group A). Kept qualified — bare 'explorer' or 'node'
            // would sweep in unrelated apps, which is the mistake this list warns about.
            // Group A is chain-specific infrastructure only: FluxOS/Titan/fluxcloud
            // (Flux platform, not a chain node), IPFS and Nostr (no chain state) and
            // beam105 (a miner) were considered and deliberately left out, so the card
            // still means what its "Crypto Nodes" label says.
            'blockbook', 'runonflux/explorer', 'zelcash/dibi-fetch', 'brise-node',
            'fusenet/node', 'raven-insight', 'dash-insight', 'runonflux/fusionbalances',
            'authsteem',
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

// Images that look like a tracked category but aren't an instance of it.
//
// `runonflux/minecraft-server-website` and friends are companion web frontends shipped
// alongside the game servers — counting them inflated every game total and produced the
// "MINECRAFT SERVER WEBSITE" label that overflowed the gaming card.
//
// `wirewrex/flux-dns-fdm` is a DNS/monitoring sidecar that runs one instance per app it
// watches, and names the watched app in its *tag* — `:minecraft-ping`, `:wordpress`. Since
// categorizeImage() matches the whole image string including the tag, those tags leaked
// straight into the totals: 47 phantom gaming instances on 2025-11-17, and a WordPress
// instance still being miscounted as of 2026-08-20. Only bare single-word keywords leak
// this way (`:presearch` is safe because crypto matches the qualified `presearch/node`),
// but any future tag naming a game or WordPress would be counted the same way.
//
// Both are the same class of mistake: a helper counted as the thing it helps.
// Checked before the keyword match, so these fall through to uncategorised ("Other").
export const CATEGORY_EXCLUDE = [
    '-server-website',
    'flux-dns-fdm'
];

// Map image name -> category using keyword substring match
export function categorizeImage(imageName) {
    const lower = imageName.toLowerCase();

    if (CATEGORY_EXCLUDE.some(ex => lower.includes(ex))) {
        return null;
    }

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
    'runonflux/palworld-server-flux': 'Palworld (Flux)',
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
    'ghcr.io/girderworks/edge': 'Beldex Edge',
    'ghcr.io/girderworks/feather': 'Beldex Feather',
    // Group A. Every one of these fell back to a label that named neither the chain nor
    // the service — `fusenet/node` rendered as bare "Node", `runonflux/explorer` as
    // "Explorer", `steemfans/authsteem` as "Authsteem".
    'runonflux/blockbook-docker': 'Flux Blockbook',
    'runonflux/explorer': 'Flux Explorer',
    'zelcash/dibi-fetch': 'DiBi Fetch',
    'bitgert/brise-node-flux': 'Bitgert',
    'fusenet/node': 'Fuse',
    'runonflux/raven-insight-explorer': 'Ravencoin Explorer',
    'runonflux/dash-insight-explorer': 'Dash Explorer',
    'runonflux/fusionbalances': 'Fusion Balances',
    'steemfans/authsteem': 'Steem Auth',
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
    'pfeiffermax/rust-game-server': 'Rust',
    'littlestache/terraria': 'Terraria',
    'lloesche/valheim-server': 'Valheim',
    'indifferentbroccoli/windrose-server-docker': 'Windrose',
};

// Canonical product name — collapses the variants of one game/product into a single row.
// Minecraft ships as separate Java and Bedrock images, Valheim/Enshrouded/Rust each have
// several community images; users think of them as one game, so the category cards group
// on this name. `repo_snapshots` stays per-image, so history and charts are unaffected.
export const CANONICAL_NAME_OVERRIDES = {
    'thijsvanloef/palworld-server-docker': 'Palworld',
    'runonflux/palworld-server-flux': 'Palworld',
    'itzg/minecraft-server': 'Minecraft',
    'itzg/minecraft-bedrock-server': 'Minecraft',
    'mbround18/valheim': 'Valheim',
    'littlestache/valheim-flux': 'Valheim',
    'lloesche/valheim-server': 'Valheim',
    'sknnr/enshrouded-dedicated-server': 'Enshrouded',
    'jktuned/enshrouded-server': 'Enshrouded',
    'littlestache/rust-server': 'Rust',
    'pfeiffermax/rust-game-server': 'Rust',
    'streamr/node': 'Streamr',
    'streamr/broker-node': 'Streamr',
    'alephium/explorer': 'Alephium',
    'alephium/explorer-backend': 'Alephium',
    'touilleio/alephium-standalone': 'Alephium',
    'thetrunk/alephium-standalone': 'Alephium',
    'runonflux/fironode': 'Firo',
    'firoorg/firod': 'Firo',
    'ghcr.io/girderworks/edge': 'Beldex',
    'ghcr.io/girderworks/feather': 'Beldex',
    'beldex/beldex-master-node': 'Beldex',
};

/**
 * Canonical name for grouping. Falls back to the per-image display name, so an
 * untracked image still gets a sensible label instead of disappearing.
 */
export function getCanonicalName(imageName) {
    const noTag = imageName.split(':')[0];
    return CANONICAL_NAME_OVERRIDES[noTag] || getDisplayName(imageName);
}

/**
 * Merge per-image repo rows into one row per canonical product, biggest first.
 *
 * repo_snapshots keeps a row per Docker image, but a game usually ships as several
 * (Minecraft Java + Bedrock, three Valheim images). Callers must pass the whole category,
 * not a pre-sliced top-N, or merged groups lose instances.
 *
 * @param {Array<{image_name: string, instance_count: number}>} repos
 * @returns {Array<{displayName, image_name, instance_count, images}>}
 */
export function groupReposByCanonicalName(repos) {
    const groups = new Map();

    for (const repo of repos) {
        const name = getCanonicalName(repo.image_name);
        const existing = groups.get(name);

        if (existing) {
            existing.instance_count += repo.instance_count;
            existing.images.push(repo.image_name);
        } else {
            groups.set(name, {
                displayName: name,
                // First (largest) contributing image represents the group in per-image lookups
                image_name: repo.image_name,
                instance_count: repo.instance_count,
                images: [repo.image_name]
            });
        }
    }

    return [...groups.values()].sort((a, b) => b.instance_count - a.instance_count);
}

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


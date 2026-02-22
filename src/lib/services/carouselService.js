// flux-performance-dashboard/src/lib/services/carouselService.js

import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';

// Cache for carousel data
let cachedCarouselData = null;
let cachedDeployedApps = null;
let cachedExpiringApps = null;
let lastFetchTime = 0;
let lastDeployedFetchTime = 0;
let lastExpiringFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

// Shared cache for expensive Flux API calls (block height + app specs)
let cachedFluxApiData = null;
let lastFluxApiCacheTime = 0;
const FLUX_API_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Images to exclude from top apps (health check/monitoring apps)
const EXCLUDED_IMAGES = [
    'containrrr/watchtower',  // Health check image on all servers
];

/**
 * Fetch all carousel data (top apps + benchmark stats)
 * Returns combined array of all stats for the carousel
 */
export async function fetchCarouselData() {
    try {
        console.log('🎠 Fetching carousel data (apps + benchmarks)...');
        
        // Fetch both in parallel
        const [topApps, benchmarkStats] = await Promise.all([
            fetchTopApps(),
            fetchTopBenchmarks()
        ]);
        
        // Combine all stats into one array
        const allStats = [
            ...topApps,
            ...benchmarkStats
        ];
        
        // Cache the combined results
        cachedCarouselData = allStats;
        lastFetchTime = Date.now();
        
        console.log('✅ Carousel data fetched:', allStats.length, 'total items');
        console.log(`   - ${topApps.length} top apps`);
        console.log(`   - ${benchmarkStats.length} benchmark records`);
        
        return allStats;
        
    } catch (error) {
        console.error('❌ Error fetching carousel data:', error.message);
        
        // Return cached data if available
        if (cachedCarouselData) {
            console.log('⚠️ Using cached carousel data due to fetch error');
            return cachedCarouselData;
        }
        
        // If no cache, return empty array
        return [];
    }
}

/**
 * Shared fetch for block height + app specs with short-lived cache.
 * Prevents duplicate API calls when multiple carousel tabs load in quick succession.
 */
async function getSharedFluxApiData() {
    const age = Date.now() - lastFluxApiCacheTime;
    if (cachedFluxApiData && age < FLUX_API_CACHE_DURATION) {
        return cachedFluxApiData;
    }
    const [blockHeightResponse, appsResponse] = await Promise.all([
        axios.get('https://api.runonflux.io/daemon/getblockcount', { timeout: 15000 }),
        axios.get('https://api.runonflux.io/apps/globalappsspecifications', { timeout: 15000 })
    ]);
    cachedFluxApiData = {
        currentBlockHeight: blockHeightResponse.data?.data || 0,
        appsData: appsResponse.data?.data || []
    };
    lastFluxApiCacheTime = Date.now();
    return cachedFluxApiData;
}

/**
 * Fetch latest deployed apps (deployed today)
 */
export async function fetchLatestDeployedApps() {
    try {
        console.log('📦 Fetching latest deployed apps...');

        const { currentBlockHeight, appsData } = await getSharedFluxApiData();
        
        if (!currentBlockHeight || !Array.isArray(appsData)) {
            throw new Error('Invalid response from API');
        }
        
        console.log(`   Current block height: ${currentBlockHeight.toLocaleString()}`);
        console.log(`   Total apps in network: ${appsData.length}`);
        
        // Filter apps deployed today (within 2880 blocks = 24 hours at 30s per block)
        const BLOCKS_PER_DAY = 2880;
        const deployedToday = appsData.filter(app => {
            const blockAge = currentBlockHeight - (app.height || 0);
            return blockAge >= 0 && blockAge < BLOCKS_PER_DAY;
        });
        
        console.log(`   Apps deployed today: ${deployedToday.length}`);
        
        // Sort alphabetically by name
        deployedToday.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
        
        // Format for carousel display
        const formattedApps = deployedToday.map((app, index) => {
            // Extract specs from compose array if available, otherwise use top-level
            let cpu = app.cpu || 0;
            let ram = app.ram || 0;
            let hdd = app.hdd || 0;
            let instances = app.instances || 0;
            
            // If app has compose array, sum up resources from all containers
            if (app.compose && Array.isArray(app.compose)) {
                cpu = app.compose.reduce((sum, c) => sum + (c.cpu || 0), 0);
                ram = app.compose.reduce((sum, c) => sum + (c.ram || 0), 0);
                hdd = app.compose.reduce((sum, c) => sum + (c.hdd || 0), 0);
            }
            
            // Format the details string
            const details = [
                `${instances} ${instances === 1 ? 'instance' : 'instances'}`,
                `${formatCpu(cpu)}`,
                `${formatRam(ram)}`,
                `${formatStorage(hdd)}`
            ].join(' • ');
            
            return {
                type: 'deployed',
                rank: index + 1,
                name: app.name,
                details: details,
                // Keep individual values for potential future use
                instances: instances,
                cpu: cpu,
                ram: ram,
                hdd: hdd,
                height: app.height,
                blockAge: currentBlockHeight - app.height
            };
        });
        
        // Cache the results
        cachedDeployedApps = formattedApps;
        lastDeployedFetchTime = Date.now();
        
        console.log('✅ Latest deployed apps fetched:', formattedApps.length, 'apps');
        
        return formattedApps;
        
    } catch (error) {
        console.error('❌ Error fetching deployed apps:', error.message);
        
        // Return cached data if available
        if (cachedDeployedApps) {
            console.log('⚠️ Using cached deployed apps data due to fetch error');
            return cachedDeployedApps;
        }
        
        return [];
    }
}

/**
 * Format CPU cores/threads
 */
function formatCpu(cpu) {
    if (cpu >= 1) {
        return `${cpu} ${cpu === 1 ? 'core' : 'cores'}`;
    } else {
        // For fractional CPUs, show as threads
        const threads = Math.round(cpu * 100) / 100;
        return `${threads} threads`;
    }
}

/**
 * Format RAM in appropriate units
 */
function formatRam(ram) {
    if (ram >= 1000) {
        return `${(ram / 1000).toFixed(1)} GB RAM`;
    } else {
        return `${ram} MB RAM`;
    }
}

/**
 * Format storage in appropriate units
 */
function formatStorage(hdd) {
    if (hdd >= 1000) {
        return `${(hdd / 1000).toFixed(1)} TB SSD`;
    } else {
        return `${hdd} GB SSD`;
    }
}

/**
 * Fetch top 10 running apps
 */
async function fetchTopApps() {
    try {
        const response = await axios.get(
            API_ENDPOINTS.RUNNING_APPS,
            { timeout: 15000 }
        );
        
        // Check for API error response
        if (response.data && response.data.status === 'error' && response.data.data) {
            throw new Error(`API Error: ${response.data.data.message}`);
        }
        
        const appsData = response.data.data;
        
        if (!Array.isArray(appsData)) {
            throw new Error('Invalid data structure received from apps API');
        }
        
        // Count all running images across all nodes
        const imageCounts = {};
        
        appsData.forEach(node => {
            if (node.apps && node.apps.runningapps) {
                node.apps.runningapps.forEach(app => {
                    const image = app.Image || '';
                    
                    if (!image) return;
                    
                    // Skip excluded images
                    const isExcluded = EXCLUDED_IMAGES.some(excluded => 
                        image.toLowerCase().includes(excluded.toLowerCase())
                    );
                    if (isExcluded) return;
                    
                    const imageWithoutTag = image.split(':')[0];
                    
                    if (!imageCounts[imageWithoutTag]) {
                        imageCounts[imageWithoutTag] = {
                            name: imageWithoutTag,
                            count: 0
                        };
                    }
                    
                    imageCounts[imageWithoutTag].count++;
                });
            }
        });
        
        // Convert to array, sort, and take top 10
        const topApps = Object.values(imageCounts)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map((app, index) => ({
                type: 'app',
                rank: index + 1,
                label: `#${index + 1} App`,
                name: app.name,
                value: app.count,
                unit: 'instances'
            }));
        
        return topApps;
        
    } catch (error) {
        console.error('❌ Error fetching top apps:', error.message);
        return [];
    }
}

/**
 * Fetch top benchmark stats
 */
async function fetchTopBenchmarks() {
    try {
        const response = await axios.get(
            'https://stats.runonflux.io/fluxinfo?projection=benchmark',
            { timeout: 15000 }
        );
        
        if (response.data.status !== 'success' || !Array.isArray(response.data.data)) {
            throw new Error('Invalid benchmark data received');
        }
        
        const benchmarks = response.data.data;
        
        // Filter out invalid/incomplete benchmarks
        const validBenchmarks = benchmarks.filter(item => 
            item.benchmark?.bench && 
            item.benchmark.bench.cores > 0 &&
            item.benchmark.status?.benchmarking === 'CUMULUS' // Only active nodes
        );
        
        if (validBenchmarks.length === 0) {
            console.log('⚠️ No valid benchmarks found');
            return [];
        }
        
        // Find top performers in each category
        const stats = [];
        
        // Most cores
        const topCores = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.cores > (max?.benchmark.bench.cores || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'cores',
            label: 'Most Cores',
            name: topCores.benchmark.bench.ipaddress,
            value: topCores.benchmark.bench.cores,
            unit: 'cores'
        });
        
        // Most RAM
        const topRam = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.ram > (max?.benchmark.bench.ram || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'ram',
            label: 'Most RAM',
            name: topRam.benchmark.bench.ipaddress,
            value: topRam.benchmark.bench.ram,
            unit: 'GB'
        });
        
        // Most SSD
        const topSsd = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.ssd > (max?.benchmark.bench.ssd || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'ssd',
            label: 'Biggest SSD',
            name: topSsd.benchmark.bench.ipaddress,
            value: topSsd.benchmark.bench.ssd,
            unit: 'GB'
        });
        
        // Fastest write speed
        const topWriteSpeed = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.ddwrite > (max?.benchmark.bench.ddwrite || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'ddwrite',
            label: 'Fastest Write',
            name: topWriteSpeed.benchmark.bench.ipaddress,
            value: Math.round(topWriteSpeed.benchmark.bench.ddwrite),
            unit: 'MB/s'
        });
        
        // Fastest EPS
        const topEps = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.eps > (max?.benchmark.bench.eps || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'eps',
            label: 'Fastest EPS',
            name: topEps.benchmark.bench.ipaddress,
            value: Math.round(topEps.benchmark.bench.eps),
            unit: 'events/s'
        });
        
        // Fastest download
        const topDownload = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.download_speed > (max?.benchmark.bench.download_speed || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'download',
            label: 'Fastest Download',
            name: topDownload.benchmark.bench.ipaddress,
            value: Math.round(topDownload.benchmark.bench.download_speed),
            unit: 'Mbps'
        });
        
        // Fastest upload
        const topUpload = validBenchmarks.reduce((max, item) => 
            item.benchmark.bench.upload_speed > (max?.benchmark.bench.upload_speed || 0) ? item : max
        );
        stats.push({
            type: 'benchmark',
            category: 'upload',
            label: 'Fastest Upload',
            name: topUpload.benchmark.bench.ipaddress,
            value: Math.round(topUpload.benchmark.bench.upload_speed),
            unit: 'Mbps'
        });
        
        console.log('✅ Benchmark stats fetched:', stats.length, 'records');
        
        return stats;
        
    } catch (error) {
        console.error('❌ Error fetching benchmark stats:', error.message);
        return [];
    }
}

/**
 * Get cached carousel data (used by API endpoint)
 */
export function getCachedCarouselData() {
    const cacheAge = Date.now() - lastFetchTime;
    const isFresh = cacheAge < CACHE_DURATION;
    
    return {
        stats: cachedCarouselData || [],
        cached: !!cachedCarouselData,
        cacheAge: Math.floor(cacheAge / 1000), // seconds
        fresh: isFresh
    };
}

/**
 * Fetch apps expiring within 2880 blocks (~24 hours)
 */
export async function fetchExpiringApps() {
    try {
        console.log('⏳ Fetching expiring apps...');

        const { currentBlockHeight, appsData } = await getSharedFluxApiData();

        if (!currentBlockHeight || !Array.isArray(appsData)) {
            throw new Error('Invalid response from API');
        }

        console.log(`   Current block height: ${currentBlockHeight.toLocaleString()}`);
        console.log(`   Total apps in network: ${appsData.length}`);

        const BLOCKS_PER_DAY = 2880;
        const expiringSoon = appsData
            .filter(app => {
                if (!app.expire) return false;
                const expiryBlock = (app.height || 0) + app.expire;
                const expiresInBlocks = expiryBlock - currentBlockHeight;
                return expiresInBlocks >= 0 && expiresInBlocks < BLOCKS_PER_DAY;
            })
            .map(app => ({
                ...app,
                expiresInBlocks: (app.height || 0) + app.expire - currentBlockHeight
            }));

        console.log(`   Apps expiring within 2880 blocks: ${expiringSoon.length}`);

        // Sort ascending by expiry (most urgent first)
        expiringSoon.sort((a, b) => a.expiresInBlocks - b.expiresInBlocks);

        // Format for carousel display
        const formattedApps = expiringSoon.map((app, index) => {
            let cpu = app.cpu || 0;
            let ram = app.ram || 0;
            let hdd = app.hdd || 0;
            let instances = app.instances || 0;

            if (app.compose && Array.isArray(app.compose)) {
                cpu = app.compose.reduce((sum, c) => sum + (c.cpu || 0), 0);
                ram = app.compose.reduce((sum, c) => sum + (c.ram || 0), 0);
                hdd = app.compose.reduce((sum, c) => sum + (c.hdd || 0), 0);
            }

            return {
                type: 'expiring',
                rank: index + 1,
                name: app.name,
                instances: instances,
                cpu: cpu,
                ram: ram,
                hdd: hdd,
                blocksUntilExpiry: app.expiresInBlocks
            };
        });

        cachedExpiringApps = formattedApps;
        lastExpiringFetchTime = Date.now();

        console.log('✅ Expiring apps fetched:', formattedApps.length, 'apps');

        return formattedApps;

    } catch (error) {
        console.error('❌ Error fetching expiring apps:', error.message);

        if (cachedExpiringApps) {
            console.log('⚠️ Using cached expiring apps data due to fetch error');
            return cachedExpiringApps;
        }

        return [];
    }
}

/**
 * Get cached deployed apps data (used by API endpoint)
 * If no cache exists, fetch immediately
 */
export async function getCachedDeployedApps() {
    const cacheAge = Date.now() - lastDeployedFetchTime;
    const isFresh = cacheAge < CACHE_DURATION;
    
    // If no cache or stale cache, fetch now
    if (!cachedDeployedApps || !isFresh) {
        console.log('📦 No fresh deployed apps cache, fetching now...');
        try {
            await fetchLatestDeployedApps();
        } catch (error) {
            console.error('❌ Failed to fetch deployed apps on-demand:', error);
        }
    }
    
    return {
        stats: cachedDeployedApps || [],
        cached: !!cachedDeployedApps,
        cacheAge: Math.floor(cacheAge / 1000), // seconds
        fresh: isFresh
    };
}

/**
 * Get cached expiring apps data (used by API endpoint)
 * If no cache exists, fetch immediately
 */
export async function getCachedExpiringApps() {
    const cacheAge = Date.now() - lastExpiringFetchTime;
    const isFresh = cacheAge < CACHE_DURATION;

    if (!cachedExpiringApps || !isFresh) {
        console.log('⏳ No fresh expiring apps cache, fetching now...');
        try {
            await fetchExpiringApps();
        } catch (error) {
            console.error('❌ Failed to fetch expiring apps on-demand:', error);
        }
    }

    return {
        stats: cachedExpiringApps || [],
        cached: !!cachedExpiringApps,
        cacheAge: Math.floor(cacheAge / 1000), // seconds
        fresh: isFresh
    };
}
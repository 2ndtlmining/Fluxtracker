// flux-performance-dashboard/src/lib/services/carouselService.js

import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';

// Cache for carousel data
let cachedCarouselData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour cache

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
            console.log('⚠️  Using cached carousel data due to fetch error');
            return cachedCarouselData;
        }
        
        // If no cache, return empty array
        return [];
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
            console.log('⚠️  No valid benchmarks found');
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
            label: 'Most SSD',
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
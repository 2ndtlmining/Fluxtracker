import axios from 'axios';
import { API_ENDPOINTS } from '../config.js';
import { updateCurrentMetrics, updateSyncStatus, getCurrentMetrics } from '../db/database.js';

// NOTE: API endpoints are now properly imported from API_ENDPOINTS in config.js
// Previously these were local constants causing undefined variable errors

// Retry configuration
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000; // 1 second

/**
 * Sleep/delay function
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for API calls
 */
async function retryApiCall(apiCall, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            return await apiCall();
        } catch (error) {
            if (i < retries - 1) {
                console.warn(`⚠️  API call failed (attempt ${i + 1}/${retries}), retrying...`);
                await sleep(RETRY_DELAY);
            } else {
                throw error;
            }
        }
    }
}

/**
 * Get cached cloud data from database
 */
function getCachedCloudData() {
    const cachedMetrics = getCurrentMetrics();
    
    if (cachedMetrics && 
        cachedMetrics.total_cpu_cores > 0 && 
        cachedMetrics.total_ram_gb > 0 &&
        cachedMetrics.total_storage_gb > 0) {
        
        return {
            total_cpu_cores: cachedMetrics.total_cpu_cores,
            used_cpu_cores: cachedMetrics.used_cpu_cores,
            cpu_utilization_percent: cachedMetrics.cpu_utilization_percent,
            total_ram_gb: cachedMetrics.total_ram_gb,
            used_ram_gb: cachedMetrics.used_ram_gb,
            ram_utilization_percent: cachedMetrics.ram_utilization_percent,
            total_storage_gb: cachedMetrics.total_storage_gb,
            used_storage_gb: cachedMetrics.used_storage_gb,
            storage_utilization_percent: cachedMetrics.storage_utilization_percent,
            total_apps: cachedMetrics.total_apps,
            watchtower_count: cachedMetrics.watchtower_count,
            // NEW: Git and Docker app metrics
            gitapps_count: cachedMetrics.gitapps_count || 0,
            dockerapps_count: cachedMetrics.dockerapps_count || 0,
            gitapps_percent: cachedMetrics.gitapps_percent || 0,
            dockerapps_percent: cachedMetrics.dockerapps_percent || 0,
            _cached: true
        };
    }
    
    return null;
}

/**
 * Fetch cloud utilization and app statistics
 * Uses the same calculation logic as the Fluxnode website
 */
export async function fetchCloudStats() {
    try {
        console.log('🔍 Fetching cloud statistics...');
        
        // Fetch both network utilization and node benchmarks with retries
        let networkUtilsData, benchmarksData;
        
        try {
            const [resFluxNetworkUtils, resNodeBenchmarks] = await Promise.all([
                retryApiCall(() => axios.get(API_ENDPOINTS.API_FLUX_NETWORK_UTILISATION, { timeout: 15000 })),
                retryApiCall(() => axios.get(API_ENDPOINTS.API_NODE_BENCHMARKS, { timeout: 15000 }))
            ]);
            
            networkUtilsData = resFluxNetworkUtils.data;
            benchmarksData = resNodeBenchmarks.data;
        } catch (apiError) {
            console.warn(`⚠️  API calls failed: ${apiError.message}`);
            
            // Try to use cached data
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (API unavailable)');
                updateSyncStatus('cloud', 'failed', `API error - using cached data: ${apiError.message}`, null);
                return cached;
            }
            
            // No cache available - this is first run
            console.error('❌ No cached data available and API failed on first run');
            updateSyncStatus('cloud', 'failed', `API error on first run: ${apiError.message}`, null);
            throw new Error(`Cloud API failed and no cached data available: ${apiError.message}`);
        }
        
        // Extract network utils data
        let jsonNetworkUtils = null;
        
        if (Array.isArray(networkUtilsData)) {
            jsonNetworkUtils = networkUtilsData;
        } else if (networkUtilsData?.data && Array.isArray(networkUtilsData.data)) {
            jsonNetworkUtils = networkUtilsData.data;
        }
        
        // Extract benchmarks data
        let jsonBenchmarks = null;
        
        if (Array.isArray(benchmarksData)) {
            jsonBenchmarks = benchmarksData;
        } else if (benchmarksData?.data && Array.isArray(benchmarksData.data)) {
            jsonBenchmarks = benchmarksData.data;
        }
        
        // Validate we have data
        if (!jsonNetworkUtils || jsonNetworkUtils.length === 0 || 
            !jsonBenchmarks || jsonBenchmarks.length === 0) {
            
            console.warn('⚠️  API returned empty data');
            
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (API returned empty data)');
                updateSyncStatus('cloud', 'failed', 'API returned empty data - using cached', null);
                return cached;
            }
            
            throw new Error('API returned empty data and no cache available');
        }
        
        console.log(`📊 Processing ${jsonNetworkUtils.length} network util records`);
        console.log(`📊 Processing ${jsonBenchmarks.length} benchmark records`);
        
        // Calculate locked/used resources
        let totalLockedRam = 0;
        let totalLockedSsd = 0;
        let totalLockedCores = 0;
        let validResourceNodes = 0;
        
        for (const data of jsonNetworkUtils) {
            if (data?.apps?.resources) {
                const resources = data.apps.resources;
                
                if (typeof resources.appsRamLocked === 'number' && !isNaN(resources.appsRamLocked)) {
                    totalLockedRam += resources.appsRamLocked;
                    validResourceNodes++;
                }
                if (typeof resources.appsHddLocked === 'number' && !isNaN(resources.appsHddLocked)) {
                    totalLockedSsd += resources.appsHddLocked;
                }
                if (typeof resources.appsCpusLocked === 'number' && !isNaN(resources.appsCpusLocked)) {
                    totalLockedCores += resources.appsCpusLocked;
                }
            }
        }
        
        console.log(`✅ Valid resource nodes: ${validResourceNodes}`);
        
        if (validResourceNodes === 0) {
            console.warn('⚠️  No valid resource data from nodes');
            
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (no valid resource data)');
                updateSyncStatus('cloud', 'failed', 'No valid resource data - using cached', null);
                return cached;
            }
            
            throw new Error('No valid resource data and no cache available');
        }
        
        // Calculate total network capacity from benchmarks
        let totalRam = 0;
        let totalSsd = 0;
        let totalCores = 0;
        let validBenchmarkNodes = 0;
        
        for (const data of jsonBenchmarks) {
            let bench = null;
            
            if (data?.benchmark?.bench) {
                bench = data.benchmark.bench;
            } else if (data?.benchmark) {
                bench = data.benchmark;
            } else if (data?.bench) {
                bench = data.bench;
            }
            
            if (bench) {
                if (typeof bench.ram === 'number' && bench.ram > 0 && !isNaN(bench.ram)) {
                    totalRam += bench.ram;
                    validBenchmarkNodes++;
                }
                if (typeof bench.ssd === 'number' && bench.ssd > 0 && !isNaN(bench.ssd)) {
                    totalSsd += bench.ssd;
                }
                if (typeof bench.cores === 'number' && bench.cores > 0 && !isNaN(bench.cores)) {
                    totalCores += bench.cores;
                }
            }
        }
        
        console.log(`✅ Valid benchmark nodes: ${validBenchmarkNodes}`);
        console.log(`📊 Total Cores: ${totalCores}, RAM: ${totalRam}MB, SSD: ${totalSsd}MB`);
        
        // Validate benchmark data
        if (validBenchmarkNodes === 0 || totalCores === 0 || totalRam === 0 || totalSsd === 0) {
            console.warn(`⚠️  Invalid benchmark totals - Cores: ${totalCores}, RAM: ${totalRam}, SSD: ${totalSsd}`);
            
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (invalid benchmark data)');
                updateSyncStatus('cloud', 'failed', 'Invalid benchmark data - using cached', null);
                return cached;
            }
            
            throw new Error('Invalid benchmark data and no cache available');
        }
        
        // Convert MB to GB
        const totalRamGB = totalRam / 1000;
        const totalSsdGB = totalSsd / 1000;
        const lockedRamGB = totalLockedRam / 1000000;
        const lockedSsdGB = totalLockedSsd / 1000;
        
        // Sanity check on conversions
        if (totalRamGB < 10) {
            console.warn(`⚠️  Total RAM seems too low: ${totalRamGB} GB`);
            
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (suspicious RAM value)');
                updateSyncStatus('cloud', 'failed', `Suspicious RAM value: ${totalRamGB} GB - using cached`, null);
                return cached;
            }
        }
        
        // Calculate utilization percentages
        const ramPercentage = totalRamGB > 0 ? (lockedRamGB / totalRamGB) * 100 : 0;
        const ssdPercentage = totalSsdGB > 0 ? (lockedSsdGB / totalSsdGB) * 100 : 0;
        const coresPercentage = totalCores > 0 ? (totalLockedCores / totalCores) * 100 : 0;
        
        // Fetch app count (includes Git/Docker app breakdown)
        const appCountData = await fetchAppCount();
        
        const cloudData = {
            total_cpu_cores: Math.round(totalCores),
            used_cpu_cores: Math.round(totalLockedCores),
            cpu_utilization_percent: parseFloat(coresPercentage.toFixed(2)),
            
            total_ram_gb: parseFloat(totalRamGB.toFixed(2)),
            used_ram_gb: parseFloat(lockedRamGB.toFixed(2)),
            ram_utilization_percent: parseFloat(ramPercentage.toFixed(2)),
            
            total_storage_gb: Math.round(totalSsdGB),
            used_storage_gb: Math.round(lockedSsdGB),
            storage_utilization_percent: parseFloat(ssdPercentage.toFixed(2)),
            
            total_apps: appCountData.totalApps,
            watchtower_count: appCountData.watchtowerCount,
            
            // NEW: Git and Docker app metrics
            gitapps_count: appCountData.gitappsCount,
            dockerapps_count: appCountData.dockerappsCount,
            gitapps_percent: appCountData.gitappsPercent,
            dockerapps_percent: appCountData.dockerappsPercent,
            
            _cached: false
        };
        
        // Final validation - check for zeros
        if (cloudData.total_cpu_cores === 0 || cloudData.total_ram_gb === 0 || cloudData.total_storage_gb === 0) {
            console.warn('⚠️  Calculated data has zeros');
            
            const cached = getCachedCloudData();
            if (cached) {
                console.log('📦 Using cached cloud stats (calculated zeros)');
                updateSyncStatus('cloud', 'failed', 'Calculated data has zeros - using cached', null);
                return cached;
            }
            
            throw new Error('Calculated data has zeros and no cache available');
        }
        
        // All validations passed - save to database
        updateCurrentMetrics(cloudData);
        updateSyncStatus('cloud', 'completed', null, null);
        console.log('✅ Cloud stats updated successfully:', cloudData);
        
        return cloudData;
        
    } catch (error) {
        console.error('❌ Error in fetchCloudStats:', error.message);
        
        // Final fallback - try cached data one more time
        const cached = getCachedCloudData();
        if (cached) {
            console.log('📦 Using cached cloud stats (final fallback)');
            updateSyncStatus('cloud', 'failed', `Error: ${error.message} - using cached`, null);
            return cached;
        }
        
        // No cache available at all
        updateSyncStatus('cloud', 'failed', error.message, null);
        throw new Error(`Cloud stats completely failed: ${error.message}`);
    }
}

/**
 * Fetch app count and categorize apps (Watchtower, Git apps, Docker apps)
 * 
 * NEW LOGIC:
 * - Gitapps: Apps with image "runonflux/orbit"
 * - Watchtower: Apps with image "containrrr/watchtower" (excluded from total)
 * - Dockerapps: Total apps - Gitapps (Watchtower already excluded from total)
 * - Gitapps%: (Gitapps / Total apps) * 100
 * - Dockerapps%: (Dockerapps / Total apps) * 100
 */
async function fetchAppCount() {
    try {
        const response = await retryApiCall(() => 
            axios.get(API_ENDPOINTS.RUNNING_APPS, { timeout: 15000 })
        );

        if (response.data && response.data.status === 'error' && response.data.data) {
            const errorMessage = `API Error: ${response.data.data.name} - ${response.data.data.message}`;
            console.error(errorMessage);
            updateSyncStatus('cloud', 'failed', errorMessage);
            return; // Exit the function early
        }
        
        const appsData = response.data.data;
        
        let totalAppsRaw = 0;      // Total including Watchtower
        let watchtowerCount = 0;
        let gitappsCount = 0;      // NEW: Count of Git apps (runonflux/orbit)
        
        appsData.forEach(app => {
            if (app.apps && app.apps.runningapps) {
                app.apps.runningapps.forEach(runningApp => {
                    totalAppsRaw++;
                    
                    const image = runningApp.Image || '';
                    
                    // Count Watchtower apps
                    if (image.includes('containrrr/watchtower')) {
                        watchtowerCount++;
                    }
                    
                    // NEW: Count Git apps (runonflux/orbit)
                    if (image.includes('runonflux/orbit')) {
                        gitappsCount++;
                    }
                });
            }
        });
        
        // Total apps excludes Watchtower
        const totalApps = totalAppsRaw - watchtowerCount;
        
        // NEW: Calculate Docker apps (Total apps - Git apps)
        // Note: Watchtower is already excluded from totalApps, so we don't subtract it again
        const dockerappsCount = totalApps - gitappsCount;
        
        // NEW: Calculate percentages
        const gitappsPercent = totalApps > 0 
            ? parseFloat(((gitappsCount / totalApps) * 100).toFixed(2))
            : 0;
            
        const dockerappsPercent = totalApps > 0 
            ? parseFloat(((dockerappsCount / totalApps) * 100).toFixed(2))
            : 0;
        
        console.log('📊 App Breakdown:');
        console.log(`   Total Apps (excl. Watchtower): ${totalApps}`);
        console.log(`   Watchtower: ${watchtowerCount}`);
        console.log(`   Git Apps (runonflux/orbit): ${gitappsCount} (${gitappsPercent}%)`);
        console.log(`   Docker Apps: ${dockerappsCount} (${dockerappsPercent}%)`);
        
        return {
            totalApps,
            watchtowerCount,
            gitappsCount,
            dockerappsCount,
            gitappsPercent,
            dockerappsPercent
        };
        
    } catch (error) {
        console.warn('⚠️  Could not fetch app count, using cached');
        
        // Return cached values
        const cachedMetrics = getCurrentMetrics();
        if (cachedMetrics && cachedMetrics.total_apps !== undefined) {
            return {
                totalApps: cachedMetrics.total_apps,
                watchtowerCount: cachedMetrics.watchtower_count || 0,
                gitappsCount: cachedMetrics.gitapps_count || 0,
                dockerappsCount: cachedMetrics.dockerapps_count || 0,
                gitappsPercent: cachedMetrics.gitapps_percent || 0,
                dockerappsPercent: cachedMetrics.dockerapps_percent || 0
            };
        }
        
        // Return zeros as last resort
        return {
            totalApps: 0,
            watchtowerCount: 0,
            gitappsCount: 0,
            dockerappsCount: 0,
            gitappsPercent: 0,
            dockerappsPercent: 0
        };
    }
}

/**
 * Format cloud stats for display
 */
export function formatCloudStats(cloudData) {
    return {
        cpu: {
            total: cloudData.total_cpu_cores,
            used: cloudData.used_cpu_cores,
            utilization: cloudData.cpu_utilization_percent + '%'
        },
        ram: {
            total: cloudData.total_ram_gb + ' GB',
            used: cloudData.used_ram_gb + ' GB',
            utilization: cloudData.ram_utilization_percent + '%'
        },
        storage: {
            total: cloudData.total_storage_gb + ' GB',
            used: cloudData.used_storage_gb + ' GB',
            utilization: cloudData.storage_utilization_percent + '%'
        },
        apps: {
            total: cloudData.total_apps,
            watchtower: cloudData.watchtower_count,
            // NEW: Git and Docker app breakdown
            gitapps: cloudData.gitapps_count,
            dockerapps: cloudData.dockerapps_count,
            gitappsPercent: cloudData.gitapps_percent + '%',
            dockerappsPercent: cloudData.dockerapps_percent + '%'
        },
        cached: cloudData._cached || false
    };
}
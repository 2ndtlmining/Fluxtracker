<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl, DASHBOARD_REFRESH_MS, BUSIEST_NODE_CONFIG, DECENTRALIZATION_CONFIG } from '$lib/config.js';
  import { refreshSignal } from '$lib/stores/refresh.js';
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import CloudCard from '$lib/components/CloudCard.svelte';
  import NodeCard from '$lib/components/NodeCard.svelte';
  import RevenueCard from '$lib/components/RevenueCard.svelte';
  import Chart from '$lib/components/Chart.svelte';
  import RevenueTransactions from '$lib/components/RevenueTransactions.svelte';
  import { Package } from 'lucide-svelte';
  import CarouselCard from '$lib/components/CarouselCard.svelte';
  import BusiestNodeCard from '$lib/components/BusiestNodeCard.svelte';
  import DecentralizationCard from '$lib/components/DecentralizationCard.svelte';
  
  // IMPORTANT: Don't call getApiUrl() here - it runs during SSR!
  // Initialize empty and set in onMount() when we're in the browser
  let API_URL = '';
  
  // Data from API
  let metrics = null;
  let comparisonCache = {}; // Cache for comparison data by period
  let loading = true;
  let comparisonLoading = false; // Separate loading state for comparison
  let interval;
  // Revenue data for current period
  let revenueData = null;

  // Busiest Node card — its own slower refresh (see BUSIEST_NODE_CONFIG), independent of
  // the shared dashboard refresh interval since its payload is much larger.
  let busiestNode = null;
  let busiestNodeLoading = true;
  let busiestNodeError = false;
  let busiestNodeInterval;

  // Decentralization card — refreshes on its own interval matching the backend's
  // classification batch cadence (see DECENTRALIZATION_CONFIG); the endpoint itself just
  // returns a cached snapshot, so this is cheap regardless of frequency.
  let decentralizationStats = null;
  let decentralizationLoading = true;
  let decentralizationError = false;
  let decentralizationInterval;
  
  // Comparison period toggle
  let comparisonPeriod = 'D'; // D, W, M, Q, Y
  const periods = [
    { key: 'D', label: 'Day', days: 1 },
    { key: 'W', label: 'Week', days: 7 },
    { key: 'M', label: 'Month', days: 30 },
    { key: 'Q', label: 'Quarter', days: 90 },
    { key: 'Y', label: 'Year', days: 365 }
  ];
  
  // Computed comparison - use cached data
  $: comparison = comparisonCache[comparisonPeriod] || null;
  $: currentPeriod = periods.find(p => p.key === comparisonPeriod);
  
  // Cloud resource comparison data
  $: cpuComparison = comparison ? {
    change: comparison.changes.cpu?.change || 0,
    trend: comparison.changes.cpu?.trend || 'neutral'
  } : null;
  
  $: ramComparison = comparison ? {
    change: comparison.changes.ram?.change || 0,
    trend: comparison.changes.ram?.trend || 'neutral'
  } : null;
  
  $: storageComparison = comparison ? {
    change: comparison.changes.storage?.change || 0,
    trend: comparison.changes.storage?.trend || 'neutral'
  } : null;
  
  // Node comparison data
  $: cumulusComparison = comparison ? {
    change: comparison.changes.nodes?.cumulusChange || 0,
    trend: comparison.changes.nodes?.cumulusTrend || 'neutral'
  } : null;
  
  $: nimbusComparison = comparison ? {
    change: comparison.changes.nodes?.nimbusChange || 0,
    trend: comparison.changes.nodes?.nimbusTrend || 'neutral'
  } : null;
  
  $: stratusComparison = comparison ? {
    change: comparison.changes.nodes?.stratusChange || 0,
    trend: comparison.changes.nodes?.stratusTrend || 'neutral'
  } : null;
  
  $: totalNodesComparison = comparison ? {
    change: comparison.changes.nodes?.difference || 0,
    trend: comparison.changes.nodes?.trend || 'neutral'
  } : null;
  
  // Format node data for NodeCard
  $: nodeData = metrics?.nodes ? {
    cumulus: { count: metrics.nodes.cumulus || 0 },
    nimbus: { count: metrics.nodes.nimbus || 0 },
    stratus: { count: metrics.nodes.stratus || 0 },
    total: metrics.nodes.total || 0
  } : {
    cumulus: { count: 0 },
    nimbus: { count: 0 },
    stratus: { count: 0 },
    total: 0
  };
  
// Format revenue data for RevenueCard based on current period
  $: revenueFormatted = {
    payments: {
    count: revenueData?.payments?.count || 0
  },
  usd: {
    amount: revenueData?.usd?.amount || 0
  },
  flux: {
    amount: revenueData?.flux?.amount || 0,
    change: revenueData?.flux?.change || 0,
    trend: revenueData?.flux?.trend || 'neutral'
  }
};
  
  // Total app instance count is unaffected by the FluxOS v8.18 change (see issue #106) —
  // it comes from the running-apps census, not per-app image resolution. The git/docker
  // split and Gaming/Crypto/WordPress category totals were removed: they depend on
  // resolving each app's image, which only covers ~76-78% of instances now, and an
  // undercounted number split by category is misleading, not just incomplete.
  $: totalApps = metrics?.apps?.total || 0;
  
 onMount(async () => {
  API_URL = getApiUrl();

  // Load all data in parallel
  await Promise.all([
    fetchMetrics(),
    fetchRevenue(comparisonPeriod),     // NEW - fetch revenue for current period
    fetchComparison(comparisonPeriod),
    fetchBusiestNode(),
    fetchDecentralization()
  ]);

  prefetchComparisons();

  // Auto-refresh on the shared dashboard interval so every card moves together
  interval = setInterval(refreshAll, DASHBOARD_REFRESH_MS);
  // Busiest Node refreshes on its own, much slower interval (see BUSIEST_NODE_CONFIG)
  busiestNodeInterval = setInterval(fetchBusiestNode, BUSIEST_NODE_CONFIG.updateInterval);
  decentralizationInterval = setInterval(fetchDecentralization, DECENTRALIZATION_CONFIG.updateInterval);
});

async function refreshAll() {
  await fetchMetrics();
  await fetchRevenue(comparisonPeriod);
  comparisonCache = {};                      // period comparisons are cached by period
  await fetchComparison(comparisonPeriod);
}

async function fetchBusiestNode() {
  try {
    const response = await fetch(`${API_URL}/api/busiest-node`);
    const data = await response.json();

    if (data?.node) {
      busiestNode = data.node;
      busiestNodeError = false;
    } else {
      busiestNodeError = true;
    }
  } catch (error) {
    console.error('Error fetching busiest node:', error);
    busiestNodeError = true;
  } finally {
    busiestNodeLoading = false;
  }
}

async function fetchDecentralization() {
  try {
    const response = await fetch(`${API_URL}/api/decentralization`);
    const data = await response.json();

    if (data && !data.error) {
      decentralizationStats = data;
      decentralizationError = false;
    } else {
      decentralizationError = true;
    }
  } catch (error) {
    console.error('Error fetching decentralization stats:', error);
    decentralizationError = true;
  } finally {
    decentralizationLoading = false;
  }
}

// Re-fetch when the footer's Refresh button fires (skip the initial store value)
let lastRefresh = 0;
$: if (API_URL && $refreshSignal > lastRefresh) {
  lastRefresh = $refreshSignal;
  refreshAll();
}

 async function fetchRevenue(period) {
  try {
    const periodMap = {
      'D': 'daily',
      'W': 'weekly',
      'M': 'monthly',
      'Q': 'quarterly',
      'Y': 'yearly'
    };
    
    const periodName = periodMap[period] || 'daily';
    const response = await fetch(`${API_URL}/api/revenue/${periodName}`);
    const data = await response.json();
    
    if (data) {
      revenueData = data;
      console.log(`✓ ${periodName} revenue loaded:`, data);
    }
  } catch (error) {
    console.error(`Error fetching ${period} revenue:`, error);
  }
}
  
  onDestroy(() => {
    if (interval) clearInterval(interval);
    if (busiestNodeInterval) clearInterval(busiestNodeInterval);
    if (decentralizationInterval) clearInterval(decentralizationInterval);
  });
  
  async function fetchMetrics() {
    try {
      const response = await fetch(`${API_URL}/api/metrics/current`);
      const data = await response.json();
      
      if (data) {
        metrics = data;
        loading = false;
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
      loading = false;
    }
  }
  
  async function fetchComparison(period) {
    // If we already have this data cached, don't fetch again
  if (comparisonCache[period]) {
    console.log(`Using cached comparison for ${period}`);
    return;
  }
    
    comparisonLoading = true;
    
    try {
      const periodObj = periods.find(p => p.key === period);
      const days = periodObj.days;
      console.log(`Fetching comparison for ${days} days (${period})`);

      const response = await fetch(`${API_URL}/api/analytics/comparison/${days}`);
      
      if (!response.ok) {
        // Try to get the error message from the response
        try {
          const errorData = await response.json();
          if (errorData.message) {
            console.warn(`⚠️  Comparison for ${period} (${days} days): ${errorData.message}`);
          } else {
            console.error(`❌ Error fetching comparison for ${period}:`, response.statusText);
          }
        } catch {
          console.error(`❌ Error fetching comparison for ${period}:`, response.statusText);
        }
        comparisonCache[period] = null;
        return;
      }
      
      const data = await response.json();

      if (data && data.changes) {
        // Check if this is partial data (revenue only)
        if (data.partialData) {
          console.log(`✓ Partial comparison for ${period} (${days} days): Revenue comparison available`);
          console.log(`  Revenue: ${data.changes.revenue?.change?.toFixed(2) || 0}% ${data.changes.revenue?.trend || 'neutral'}`);
          console.warn(`⚠️  Other metrics not available: ${data.message}`);
        } else {
          console.log(`✓ Full comparison loaded for ${period} (${days} days)`);
        }
        
        // Cache the result (even if partial)
        comparisonCache[period] = data; 
      } else {
        comparisonCache[period] = null;
      }
    } catch (error) {
      console.error('Error fetching comparison:', error);
      comparisonCache[period] = null;
    } finally {
      comparisonLoading = false;
    }
  }
  
  // Prefetch common comparison periods in the background
  async function prefetchComparisons() {
    // Wait a bit after initial load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Prefetch the most common periods (Week and Month) if not already cached
    for (const period of ['W', 'M']) {
      if (!comparisonCache[period] && period !== comparisonPeriod) {
        await fetchComparison(period);
        // Small delay between requests to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  
  // Toggle comparison period
  async function togglePeriod() {
    const currentIndex = periods.findIndex(p => p.key === comparisonPeriod);
    const nextIndex = (currentIndex + 1) % periods.length;
    const nextPeriod = periods[nextIndex].key;
    
    comparisonPeriod = nextPeriod;
    
    // Fetch revenue for the new period
    await fetchRevenue(nextPeriod);
    
    // Fetch comparison if not cached
    if (!comparisonCache[nextPeriod]) {
      await fetchComparison(nextPeriod);
    }
  }
  
  // Helper to get trend from comparison data
  function getTrend(changeData) {
    if (!changeData) return 'neutral';
    if (changeData.trend === 'up' || changeData.change > 0) return 'up';
    if (changeData.change < 0) return 'down';
    return 'neutral';
  }
  
  // Helper to format change text
  function formatChange(changeData, showDifference = false) {
    if (!changeData) return '';
    
    if (showDifference && changeData.difference !== undefined) {
      const sign = changeData.difference >= 0 ? '+' : '';
      const period = currentPeriod.key === 'D' ? 'today' : `this ${currentPeriod.label.toLowerCase()}`;
      return `${sign}${Math.round(changeData.difference)} ${period}`;
    }
    
    const sign = changeData.change >= 0 ? '+' : '';
    return `${sign}${formatCurrency(changeData.change)}%`;
  }
  
  // Helper to format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
  
  // Helper to format currency
  function formatCurrency(num) {
    if (!num) return '0.00';
    return num.toFixed(2);
  }
</script>

<div class="dashboard">
  <Header />
  
  <main class="main-content">
    <!-- Carousel - NEW -->
    <CarouselCard />
    
    <!-- Title with Comparison Toggle -->
    <div class="page-header">
      <h2 class="page-title">Performance Overview</h2>
      <button 
        class="period-toggle" 
        class:loading={comparisonLoading}
        on:click={togglePeriod} 
        title="Toggle comparison period"
        disabled={comparisonLoading}
      >
        <span class="toggle-label">vs</span>
        <span class="toggle-value">{comparisonPeriod}</span>
        {#if comparisonLoading}
          <span class="loading-spinner">⟳</span>
        {/if}
      </button>
    </div>
    
    <!-- Hero Stats Grid (3 cards) -->
    <div class="stats-grid">
      <!-- Revenue Card (Period-responsive) -->
      <RevenueCard
        payments={revenueFormatted.payments}
        usd={revenueFormatted.usd}
        flux={revenueFormatted.flux}
        selfFunded={revenueData?.selfFunded || null}
        period={comparisonPeriod}
        {loading}
    />
      
      <!-- Total Nodes Card (NEW: Using NodeCard component) -->
      <NodeCard
        cumulus={nodeData.cumulus}
        nimbus={nodeData.nimbus}
        stratus={nodeData.stratus}
        total={nodeData.total}
        {cumulusComparison}
        {nimbusComparison}
        {stratusComparison}
        totalComparison={totalNodesComparison}
        {loading}
      />
      
      <!-- Cloud Resources Card (NEW: Using CloudCard component) -->
      <CloudCard
        cpu={loading ? { total: 0, used: 0, utilization: 0 } : metrics?.cloud?.cpu || { total: 0, used: 0, utilization: 0 }}
        ram={loading ? { total: 0, used: 0, utilization: 0 } : metrics?.cloud?.ram || { total: 0, used: 0, utilization: 0 }}
        storage={loading ? { total: 0, used: 0, utilization: 0 } : metrics?.cloud?.storage || { total: 0, used: 0, utilization: 0 }}
        {cpuComparison}
        {ramComparison}
        {storageComparison}
        {loading}
      />
    </div>
    
    <!-- Additional Stats Grid -->
    <h3 class="section-title">Additional Metrics</h3>

    <div class="stats-grid-wide">
      <!-- Total App Instances — the one app-count metric still fully accurate after the
           FluxOS v8.18 API change (see issue #106). Gaming/Crypto/WordPress category
           totals and the Git/Docker split were removed alongside it. -->
      <StatCard
        icon={Package}
        title="Total App Instances"
        value={loading ? '...' : formatNumber(totalApps)}
        subtitle="Across the network"
        change={comparison ? formatChange(comparison.changes.apps, true) : ''}
        trend={comparison ? getTrend(comparison.changes.apps) : 'neutral'}
        valueColor="cyan"
        {loading}
      />

      <!-- Busiest Node (issue #108) — identity, resource utilization and the app list
           together in one card; splitting it into two read as two unrelated things. -->
      <BusiestNodeCard node={busiestNode} loading={busiestNodeLoading} error={busiestNodeError} />

      <!-- Decentralization (issue #108) — % of node IPs in known datacenters vs. not,
           classified gradually in the background; coverage fills in over time. -->
      <DecentralizationCard stats={decentralizationStats} loading={decentralizationLoading} error={decentralizationError} />
    </div>

    <!-- Historical Performance Chart -->
    <Chart 
      title="Historical Performance" 
      height={400}
      defaultCategory="revenue"
      defaultTimeframe="30d"
    />
    
    <!-- Revenue Transactions Table -->
    <RevenueTransactions />
  </main>
  
  <Footer />
</div>

<style>
  .dashboard {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  
  .main-content {
    flex: 1;
    max-width: 1400px;
    margin: 0 auto;
    padding: var(--spacing-xl);
    width: 100%;
  }
  
  .page-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
    margin-top: var(--spacing-lg);
  }
  
  .page-title {
    font-size: 1.5rem;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 2px;
    text-shadow: var(--glow-cyan);
    margin: 0;
  }
  
  .period-toggle {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    transition: all 0.3s ease;
    border-radius: var(--radius-sm);
    font-family: 'JetBrains Mono', monospace;
    position: relative;
  }
  
  .period-toggle:hover:not(:disabled) {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px var(--border-glow);
    transform: translateY(-1px);
  }
  
  .period-toggle:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .period-toggle.loading .toggle-value {
    opacity: 0.5;
  }
  
  .toggle-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: lowercase;
  }
  
  .toggle-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 700;
    text-shadow: var(--glow-cyan);
    min-width: 1.25rem;
    text-align: center;
  }
  
  .loading-spinner {
    font-size: 0.875rem;
    color: var(--accent-cyan);
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .section-title {
    font-size: 1.125rem;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 1.5px;
    margin: var(--spacing-xl) 0 var(--spacing-lg) 0;
  }
  
  /* Stats Grid - 3 columns for hero stats */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--spacing-lg);
    margin-bottom: var(--spacing-xl);
  }
  
  /* Stats Grid Wide - More columns for secondary stats */
  .stats-grid-wide {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-xl);
  }
  
  /* Responsive */
  @media (max-width: 1200px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 768px) {
    .main-content {
      padding: var(--spacing-md);
    }
    
    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .stats-grid,
    .stats-grid-wide {
      grid-template-columns: 1fr;
      gap: var(--spacing-md);
    }
    
    .page-title {
      font-size: 1.25rem;
    }
    
    .period-toggle {
      align-self: flex-start;
    }
  }
</style>
<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { getApiUrl, DASHBOARD_REFRESH_MS, BUSIEST_NODE_CONFIG, DECENTRALIZATION_CONFIG } from '$lib/config.js';
  import { refreshSignal } from '$lib/stores/refresh.js';
  import { fetchJson } from '$lib/utils/fetchJson.js';
  import { pollWhileVisible } from '$lib/utils/pollWhileVisible.js';
  import '../app.css';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import CloudCard from '$lib/components/CloudCard.svelte';
  import NodeCard from '$lib/components/NodeCard.svelte';
  import RevenueCard from '$lib/components/RevenueCard.svelte';
  import Chart from '$lib/components/Chart.svelte';
  import RevenueTransactions from '$lib/components/RevenueTransactions.svelte';
  import CarouselCard from '$lib/components/CarouselCard.svelte';
  import BusiestNodeCard from '$lib/components/BusiestNodeCard.svelte';
  import DecentralizationCard from '$lib/components/DecentralizationCard.svelte';
  import AppInstancesCard from '$lib/components/AppInstancesCard.svelte';
  
  // Hero-card data rendered on the server (issue #299) -- see +page.server.js. Either field is
  // null when the API did not answer inside the SSR budget; the client fetch in onMount then
  // fills it exactly as before.
  export let data = {};

  const SITE_TITLE = 'Fluxtracker — Flux network revenue & usage';
  const SITE_DESCRIPTION = 'Live revenue, node counts, cloud resources and app deployments '
    + 'across the Flux decentralized cloud, with daily history.';

  // IMPORTANT: Don't call getApiUrl() here - it runs during SSR!
  // Initialize empty and set in onMount() when we're in the browser
  let API_URL = '';
  
  // Data from API (seeded from the server-rendered load when it answered in time)
  let metrics = data?.metrics ?? null;
  let comparisonCache = {}; // Cache for comparison data by period
  let loading = !data?.metrics;
  let comparisonLoading = false; // Separate loading state for comparison
  let interval;
  // Revenue data for current period
  let revenueData = data?.revenue ?? null;
  let revenuePeriodLoaded = data?.revenue ? 'D' : null; // which period revenueData belongs to

  // Load health for the hero cards (issue #319). A failed fetch used to leave `metrics`/
  // `revenueData` unchanged or fill them with an error body, and the cards' `|| 0`
  // fallbacks then showed the failure as real zeros. Now: `*Failed` marks the last attempt,
  // `*UpdatedAt` is when the shown data was actually loaded, and `*Stale` is withDbFallback's
  // 503-with-cached-data answer (a real reading, but not a current one).
  let metricsFailed = false;
  let metricsStale = false;
  let metricsUpdatedAt = data?.metrics ? data.renderedAt : null;
  let revenueFailed = false;
  let revenueStale = false;
  let revenueUpdatedAt = data?.revenue ? data.renderedAt : null;

  $: metricsUnavailable = !loading && !metrics && metricsFailed;
  $: metricsStaleSince = metrics && (metricsFailed || metricsStale) ? metricsUpdatedAt : null;
  $: revenueUnavailable = !loading && !revenueData && revenueFailed;
  $: revenueStaleSince = revenueData && (revenueFailed || revenueStale) ? revenueUpdatedAt : null;

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

  // Apps deployed/expiring today (issue #108 follow-up) -- rides on the shared dashboard
  // refresh, same as the rest of the Total App Instances card.
  let appsActivity = null;
  // Gaming breakdown for the App Instances card (issue #163). Null until loaded, so the
  // card omits the section entirely rather than flashing a zero.
  let gamingData = null;
  // Deployment fill (issue #200) — live, not snapshotted, so it is fetched like gaming data.
  let deploymentFill = null;
  let appsActivityLoading = true;
  
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

  $: decentralizationComparison = comparison ? {
    change: comparison.changes.decentralization?.change || 0,
    trend: comparison.changes.decentralization?.trend || 'neutral'
  } : null;

  $: appsDeployedComparison = comparison ? {
    change: comparison.changes.appsDeployed?.change || 0,
    trend: comparison.changes.appsDeployed?.trend || 'neutral'
  } : null;

  $: appsExpiringComparison = comparison ? {
    change: comparison.changes.appsExpiring?.change || 0,
    trend: comparison.changes.appsExpiring?.trend || 'neutral'
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
  
  // Unique wallets running nodes (issue #201). null until the first collection, and the
  // card renders a dash rather than a 0 in that window -- "no wallets run the network"
  // would be a false reading, not an empty one.
  $: uniqueWallets = metrics?.wallets?.unique ?? null;

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
    fetchDecentralization(),
    fetchAppsActivity(),
    fetchGaming(),
    fetchDeploymentFill()
  ]);

  prefetchComparisons();

  // Auto-refresh on the shared dashboard interval so every card moves together
  // All three pause while the tab is hidden and catch up when it returns (issue #298).
  interval = pollWhileVisible(refreshAll, DASHBOARD_REFRESH_MS);
  // Busiest Node refreshes on its own, much slower interval (see BUSIEST_NODE_CONFIG)
  busiestNodeInterval = pollWhileVisible(fetchBusiestNode, BUSIEST_NODE_CONFIG.updateInterval);
  decentralizationInterval = pollWhileVisible(fetchDecentralization, DECENTRALIZATION_CONFIG.updateInterval);
});

async function refreshAll() {
  // Independent requests, in parallel (issue #299) -- these were six sequential awaits,
  // each a remote round trip in Supabase mode.
  comparisonCache = {};                      // period comparisons are cached by period
  await Promise.all([
    fetchMetrics(),
    fetchRevenue(comparisonPeriod),
    fetchComparison(comparisonPeriod),
    fetchAppsActivity(),
    fetchGaming(),
    fetchDeploymentFill()
  ]);
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

// Top games plus the network-wide gaming total. `days` drives the comparison window and
// follows the dashboard's period toggle, so the gaming arrows agree with every other
// comparison on the page rather than silently using a different baseline.
// Deployment fill: ordered vs actually running (issue #200). Live only -- it reads the
// shared running-apps census and the specs cache, neither of which is snapshotted, so there
// is no history to compare against and no arrow to render.
async function fetchDeploymentFill() {
  try {
    const response = await fetch(`${API_URL}/api/apps/deployment-fill`);
    const data = await response.json();
    if (data && !data.error) deploymentFill = data;
  } catch (error) {
    // Leave the previous value standing; the card falls back to the container count.
    console.error('Error fetching deployment fill:', error);
  }
}

async function fetchGaming() {
  const period = comparisonPeriod;
  try {
    const response = await fetch(`${API_URL}/api/games/live?limit=3&days=${comparisonDays(period)}`);
    const data = await response.json();

    if (data && !data.error && period === comparisonPeriod) {
      gamingData = data;
    }
  } catch (error) {
    console.error('Error fetching gaming breakdown:', error);
  }
}

function comparisonDays(period) {
  return { D: 1, W: 7, M: 30, Q: 90, Y: 365 }[period] || 1;
}

async function fetchAppsActivity() {
  try {
    const response = await fetch(`${API_URL}/api/apps/activity`);
    const data = await response.json();

    if (data && !data.error) {
      appsActivity = data;
    }
  } catch (error) {
    console.error('Error fetching apps activity:', error);
  } finally {
    appsActivityLoading = false;
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
    const data = await fetchJson(`${API_URL}/api/revenue/${periodName}`);
    // A slower response for a period the user has already moved away from must not
    // overwrite the selected period's figures (the period buttons no longer lock).
    if (period !== comparisonPeriod) return;

    revenueData = data;
    revenuePeriodLoaded = period;
    revenueFailed = false;
    revenueStale = data._stale === true;
    if (!revenueStale) revenueUpdatedAt = Date.now();
  } catch (error) {
    console.error(`Error fetching ${period} revenue:`, error);
    if (period !== comparisonPeriod) return;
    revenueFailed = true;
    // Never show another period's figures under this period's label: after a failed
    // period switch there is nothing honest to show, so the card says so.
    if (revenuePeriodLoaded !== period) revenueData = null;
  }
}
  
  onDestroy(() => {
    interval?.();
    busiestNodeInterval?.();
    decentralizationInterval?.();
  });
  
  async function fetchMetrics() {
    try {
      const data = await fetchJson(`${API_URL}/api/metrics/current`);
      metrics = data;
      metricsFailed = false;
      metricsStale = data._stale === true;
      if (!metricsStale) metricsUpdatedAt = Date.now();
    } catch (error) {
      console.error('Error fetching metrics:', error);
      metricsFailed = true; // keep the last good `metrics`, if any -- the card marks it stale
    } finally {
      loading = false;
    }
  }

  function retryMetrics() {
    fetchMetrics();
  }

  function retryRevenue() {
    fetchRevenue(comparisonPeriod);
  }
  
  // One retry for a comparison that failed with 503: right after a server restart there is
  // no cached comparison yet and the first request can miss, which left the card's deltas
  // blank until the next 5-minute refresh (seen on a live deploy).
  const COMPARISON_RETRY_MS = 5000;

  async function fetchComparison(period, isRetry = false) {
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
        if (response.status === 503 && !isRetry) {
          setTimeout(() => fetchComparison(period, true), COMPARISON_RETRY_MS);
        }
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
  
  // Select a comparison period (issue #327). Was a single "vs D" button that cycled
  // D -> W -> M -> Q -> Y and was disabled during every fetch, so fast clicks were dropped and
  // the other options were invisible. Every period is now its own button; a click during a
  // fetch still lands, and a late response for a period no longer selected is ignored by the
  // cards because revenuePeriodLoaded/comparisonCache are keyed by period.
  async function selectPeriod(nextPeriod) {
    if (nextPeriod === comparisonPeriod) return;
    comparisonPeriod = nextPeriod;

    await Promise.all([
      fetchRevenue(nextPeriod),
      comparisonCache[nextPeriod] ? null : fetchComparison(nextPeriod),
      // Gaming arrows compare against a different window per period, so they have to be
      // re-fetched too -- otherwise the card would show a daily delta under a "Y" label.
      fetchGaming()
    ]);
  }
  
  // Helper to get trend from comparison data
  function getTrend(changeData) {
    if (!changeData) return 'neutral';
    if (changeData.trend === 'up' || changeData.change > 0) return 'up';
    if (changeData.change < 0) return 'down';
    return 'neutral';
  }
  

</script>

<!-- Title, description and link-unfurl tags (issue #320). og:image must be absolute for most
     scrapers, and the host differs per deployment, so it is built from the request origin. -->
<svelte:head>
  <title>{SITE_TITLE}</title>
  <meta name="description" content={SITE_DESCRIPTION} />
  <meta name="theme-color" content="#0a0e1a" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={SITE_TITLE} />
  <meta property="og:description" content={SITE_DESCRIPTION} />
  <meta property="og:image" content={`${$page.url.origin}/favicon.png`} />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content={SITE_TITLE} />
  <meta name="twitter:description" content={SITE_DESCRIPTION} />
</svelte:head>

<div class="dashboard">
  <Header />
  
  <main class="main-content">
    <!-- Carousel - NEW -->
    <CarouselCard />
    
    <!-- Title with Comparison Toggle -->
    <div class="page-header">
      <h2 class="page-title">Performance Overview</h2>
      <div class="period-control" role="group" aria-label="Compare against the previous period">
        <span class="period-label">Compare vs previous</span>
        {#each periods as p (p.key)}
          <button
            type="button"
            class="period-option"
            class:active={comparisonPeriod === p.key}
            aria-pressed={comparisonPeriod === p.key}
            on:click={() => selectPeriod(p.key)}
          >{p.label.toLowerCase()}</button>
        {/each}
        {#if comparisonLoading}
          <span class="loading-spinner" aria-hidden="true">⟳</span>
        {/if}
      </div>
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
        unavailable={revenueUnavailable}
        staleSince={revenueStaleSince}
        onRetry={retryRevenue}
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
        {uniqueWallets}
        {loading}
        unavailable={metricsUnavailable}
        staleSince={metricsStaleSince}
        onRetry={retryMetrics}
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
        unavailable={metricsUnavailable}
        staleSince={metricsStaleSince}
        onRetry={retryMetrics}
      />
    </div>
    
    <!-- Additional Stats Grid -->
    <h3 class="section-title">Additional Metrics</h3>

    <div class="stats-grid-wide">
      <!-- Total App Instances — the one app-count metric still fully accurate after the
           FluxOS v8.18 API change (see issue #106). Gaming/Crypto/WordPress category
           totals and the Git/Docker split were removed alongside it. Deployed/expiring
           today (issue #108 follow-up) uses the space the plain stat card left unused. -->
      <AppInstancesCard
        totalApps={loading ? 0 : totalApps}
        totalComparison={comparison ? { change: comparison.changes.apps?.change || 0, trend: getTrend(comparison.changes.apps) } : null}
        deployedToday={appsActivity?.deployedToday?.cached ? appsActivity.deployedToday.count : null}
        deployedComparison={appsDeployedComparison}
        expiringToday={appsActivity?.expiring24h?.cached ? appsActivity.expiring24h.count : null}
        expiringComparison={appsExpiringComparison}
        fill={deploymentFill}
        gamingTotal={gamingData?.total ?? null}
        gamingPrevious={gamingData?.previousTotal ?? null}
        topGames={gamingData?.games ?? []}
        loading={loading || appsActivityLoading}
      />

      <!-- Busiest Node (issue #108) — identity, resource utilization and the app list
           together in one card; splitting it into two read as two unrelated things. -->
      <BusiestNodeCard node={busiestNode} loading={busiestNodeLoading} error={busiestNodeError} />

      <!-- Decentralization (issue #108) — % of node IPs in known datacenters vs. not,
           classified gradually in the background; coverage fills in over time. -->
      <DecentralizationCard stats={decentralizationStats} loading={decentralizationLoading} error={decentralizationError} comparison={decentralizationComparison} />

    </div>

    <!-- Historical Performance Chart -->
    <!-- height 525 (issues #149/#153/#163) -- Additional Metrics row above is a
         CSS-grid-stretched row of 3 cards; BusiestNodeCard's compact resource
         columns keep that row from towering, so a static height here reads as
         proportionate without needing a ResizeObserver to track the row live.
         `height` feeds .chart-wrapper, so it is the PLOT area alone -- the
         title, controls and category tabs sit above it and add ~180px more.
         This value did NOTHING until the CSP fix in this branch: the inline
         style attribute carrying it was being refused, so the chart rendered at
         Chart.js's 150px default regardless. 525 is ~3.5x what was actually on
         screen before, and keeps a ~2.4:1 plot -- a time series, not a square.
         Raising this further is fine; it now has an effect. -->
    <Chart
      title="Historical Performance"
      height={525}
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
  
  .period-control {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .period-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: lowercase;
    margin-right: 0.25rem;
  }

  .period-option {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-dim);
    padding: 0.375rem 0.625rem;
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.8125rem;
  }

  /* Overrides app.css's global button:hover (cyan fill + lift), which would put white text
     on a cyan block here */
  .period-option:hover,
  .period-option:focus-visible {
    border-color: var(--accent-cyan);
    color: var(--text-white);
    background: var(--bg-secondary);
    box-shadow: none;
    transform: none;
  }

  .period-option.active {
    border-color: var(--accent-cyan);
    color: var(--text-primary);
    font-weight: 700;
    box-shadow: 0 0 10px var(--border-glow);
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
  
  /* Responsive. Three hero cards stay three-across down to 960px; below that the grid is
     two-wide and the third card spans the row instead of sitting alone on half of it
     (issue #328). */
  @media (max-width: 960px) {
    .stats-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .stats-grid > :global(:nth-child(3):last-child) {
      grid-column: 1 / -1;
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
    
    .period-control {
      align-self: flex-start;
    }
  }
</style>
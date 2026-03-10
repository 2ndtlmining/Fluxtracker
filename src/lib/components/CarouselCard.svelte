<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl } from '$lib/config.js';
  import { TrendingUp, Package, Hourglass } from 'lucide-svelte';

  let API_URL = '';
  let stats = [];
  let loading = true;
  let error = null;
  let interval;

  // Toggle state: 'network', 'deployed', or 'expiring'
  let viewMode = 'network';

  // Speed constants for consistent scroll speed across carousels
  const SECONDS_PER_ITEM = 5;
  const MOBILE_SECONDS_PER_ITEM = 3.5;

  // Duplicate the array for seamless infinite scroll
  $: duplicatedStats = [...stats, ...stats];

  // Dynamic duration based on item count for consistent visual speed
  $: scrollDuration = stats.length > 0 ? stats.length * SECONDS_PER_ITEM : 90;
  $: mobileScrollDuration = stats.length > 0 ? stats.length * MOBILE_SECONDS_PER_ITEM : 60;

  onMount(async () => {
    API_URL = getApiUrl();
    await fetchCarouselStats();

    // Refresh every hour (matching your service interval)
    interval = setInterval(fetchCarouselStats, 60 * 60 * 1000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  async function fetchCarouselStats() {
    try {
      const endpoint = viewMode === 'network'
        ? `${API_URL}/api/carousel/stats`
        : viewMode === 'deployed'
        ? `${API_URL}/api/carousel/deployed`
        : `${API_URL}/api/carousel/expiring`;

      console.log(`🎠 Fetching carousel data from: ${endpoint}`);

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ Carousel data received:`, data);

      if (data && data.stats && data.stats.length > 0) {
        stats = data.stats;
        error = null;
        loading = false;
        console.log(`✅ Loaded ${stats.length} carousel items`);
      } else if (stats.length === 0) {
        error = viewMode === 'deployed'
          ? 'No apps deployed today'
          : viewMode === 'expiring'
          ? 'No apps expiring within 24 hours'
          : 'No stats available';
        loading = false;
        console.warn(`⚠️ No data available: ${error}`);
      } else {
        // Keep existing stats if new fetch returns empty but we had data before
        loading = false;
        console.log(`ℹ️ Keeping existing ${stats.length} items`);
      }

    } catch (err) {
      console.error('❌ Error fetching carousel stats:', err);
      if (stats.length === 0) {
        error = err.message;
      }
      loading = false;
    }
  }

  // Handle view mode toggle
  function toggleViewMode(mode) {
    if (mode !== viewMode) {
      viewMode = mode;
      loading = true;
      error = null;
      fetchCarouselStats();
    }
  }

  function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
  }

  function formatBlocksAsTime(blocks) {
    const totalMinutes = Math.round(blocks * 30 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }
</script>

<div class="carousel-container">
  <div class="carousel-header">
    <div class="header-content">
      {#if viewMode === 'network'}
        <TrendingUp size={20} class="header-icon" />
      {:else if viewMode === 'deployed'}
        <Package size={20} class="header-icon" />
      {:else}
        <Hourglass size={20} class="header-icon" />
      {/if}

      <!-- Toggle buttons -->
      <div class="view-toggle">
        <button
          class="toggle-btn"
          class:active={viewMode === 'network'}
          on:click={() => toggleViewMode('network')}
        >
          Top Network Stats
        </button>
        <button
          class="toggle-btn"
          class:active={viewMode === 'deployed'}
          on:click={() => toggleViewMode('deployed')}
        >
          Latest Deployed Apps
        </button>
        <button
          class="toggle-btn"
          class:active={viewMode === 'expiring'}
          on:click={() => toggleViewMode('expiring')}
        >
          Expiring Soon
        </button>
      </div>
    </div>
    <div class="live-indicator">
      <span class="live-dot"></span>
      <span class="live-text">LIVE</span>
    </div>
  </div>

  <div class="carousel-track-container" style="--scroll-duration: {scrollDuration}s; --mobile-scroll-duration: {mobileScrollDuration}s;">
    {#if loading}
      <div class="carousel-message">
        <div class="loading-spinner">⟳</div>
        <span>Loading stats...</span>
      </div>
    {:else if error && stats.length === 0}
      <div class="carousel-message error">
        <span>⚠️ {error}</span>
      </div>
    {:else if stats.length > 0}
      {#key viewMode}
      <div class="carousel-track">
        {#each duplicatedStats as stat, index (index)}
          <div class="carousel-item">
            {#if stat.rank}
              <span class="item-rank">#{stat.rank}</span>
            {/if}

            {#if stat.label}
              <span class="item-label">
                {stat.label}:
              </span>
            {/if}

            <span class="item-name">{stat.name}</span>

            {#if stat.value !== undefined}
              <span class="item-value">
                {formatNumber(stat.value)}
              </span>
            {/if}

            {#if stat.unit}
              <span class="item-unit">{stat.unit}</span>
            {/if}

            {#if stat.instances !== undefined}
              <span class="item-value">{formatNumber(stat.instances)}</span>
              <span class="item-unit">{stat.instances === 1 ? 'instance' : 'instances'}</span>
              <span class="item-separator">•</span>
            {/if}

            {#if stat.isEnterprise}
              <span class="item-separator">•</span>
              <span class="item-badge item-enterprise">Enterprise</span>
            {:else}
              {#if stat.cpu !== undefined}
                <span class="item-value">{stat.cpu >= 1 ? formatNumber(stat.cpu) : (Math.round(stat.cpu * 100) / 100)}</span>
                <span class="item-unit">{stat.cpu >= 1 ? (stat.cpu === 1 ? 'core' : 'cores') : 'threads'}</span>
                <span class="item-separator">•</span>
              {/if}

              {#if stat.ram !== undefined}
                <span class="item-value">{stat.ram >= 1000 ? (stat.ram / 1000).toFixed(1) : formatNumber(stat.ram)}</span>
                <span class="item-unit">{stat.ram >= 1000 ? 'GB' : 'MB'} RAM</span>
                <span class="item-separator">•</span>
              {/if}

              {#if stat.hdd !== undefined}
                <span class="item-value">{stat.hdd >= 1000 ? (stat.hdd / 1000).toFixed(1) : formatNumber(stat.hdd)}</span>
                <span class="item-unit">{stat.hdd >= 1000 ? 'TB' : 'GB'} SSD</span>
              {/if}
            {/if}

            {#if stat.blocksUntilExpiry !== undefined}
              <span class="item-separator">•</span>
              <span class="item-value item-expiry">{formatBlocksAsTime(stat.blocksUntilExpiry)}</span>
              <span class="item-unit">left</span>
            {/if}

            <span class="item-separator">•</span>
          </div>
        {/each}
      </div>
      {/key}
    {:else}
      <div class="carousel-message">
        <span>No stats available</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .carousel-container {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    box-shadow: var(--shadow-md);
    overflow: hidden;
  }

  .carousel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex: 1;
  }

  :global(.header-icon) {
    color: var(--accent-cyan);
    filter: drop-shadow(0 0 4px var(--accent-cyan));
    flex-shrink: 0;
  }

  .view-toggle {
    display: flex;
    gap: 0.5rem;
    margin-left: 0.5rem;
  }

  .toggle-btn {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    white-space: nowrap;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-cyan);
  }

  .toggle-btn.active {
    color: var(--accent-cyan);
    border-color: var(--accent-cyan);
    background: rgba(6, 182, 212, 0.1);
    font-weight: 600;
  }

  .live-indicator {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    flex-shrink: 0;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    background: var(--accent-green);
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  .live-text {
    font-size: 0.75rem;
    color: var(--accent-green);
    font-weight: 700;
    text-shadow: 0 0 8px var(--accent-green);
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.1);
    }
  }

  .carousel-track-container {
    position: relative;
    overflow: hidden;
    height: 40px;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
  }

  .carousel-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    width: 100%;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .carousel-message.error {
    color: var(--accent-red);
  }

  .loading-spinner {
    font-size: 1rem;
    color: var(--accent-cyan);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .carousel-track {
    display: flex;
    animation: scroll var(--scroll-duration, 90s) linear infinite;
    white-space: nowrap;
  }

  /* Pause animation on hover */
  .carousel-track-container:hover .carousel-track {
    animation-play-state: paused;
  }

  @keyframes scroll {
    0% {
      transform: translateX(0);
    }
    100% {
      transform: translateX(-50%);
    }
  }

  .carousel-item {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 var(--spacing-lg);
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }

  .item-rank {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent-cyan);
    text-shadow: 0 0 6px var(--accent-cyan);
  }

  .item-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent-purple);
  }

  .item-name {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 500;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-value {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--accent-purple);
    text-shadow: 0 0 8px var(--accent-purple);
  }

  .item-unit {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  .item-separator {
    color: var(--text-muted);
    font-size: 0.75rem;
    opacity: 0.5;
  }

  .item-expiry {
    color: var(--accent-orange, #f97316);
    text-shadow: 0 0 8px rgba(249, 115, 22, 0.6);
  }

  .item-badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid;
    flex-shrink: 0;
  }

  .item-enterprise {
    color: var(--accent-purple, #a855f7);
    border-color: var(--accent-purple, #a855f7);
    background: rgba(168, 85, 247, 0.12);
    box-shadow: 0 0 8px rgba(168, 85, 247, 0.2), inset 0 0 8px rgba(168, 85, 247, 0.05);
  }

  /* Responsive */
  @media (max-width: 768px) {
    .view-toggle {
      flex-direction: column;
      gap: 0.25rem;
    }

    .toggle-btn {
      font-size: 0.625rem;
      padding: 0.25rem 0.5rem;
    }

    .item-name {
      max-width: 150px;
    }

    .carousel-track {
      animation-duration: var(--mobile-scroll-duration, 60s);
    }
  }
</style>

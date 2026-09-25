<script>
  import { pollWhileVisible } from '$lib/utils/pollWhileVisible.js';
  import { onMount, onDestroy } from 'svelte';
  import { cssomStyle } from '$lib/actions/cssomStyle.js';
  import { formatBlocksLeft } from '$lib/utils/format.js';
  import { getApiUrl, CAROUSEL_CONFIG } from '$lib/config.js';
  import { refreshSignal } from '$lib/stores/refresh.js';
  import { TrendingUp, Package, Hourglass, TriangleAlert, Pause, Play } from 'lucide-svelte';

  let API_URL = '';
  let stats = [];
  let loading = true;
  let error = null;
  let interval;
  let mounted = false;

  // Age of the backend cache, in seconds, as reported by the API
  let cacheAge = 0;

  const FRESH_SECONDS = CAROUSEL_CONFIG.freshnessThreshold / 1000;

  $: isFresh = cacheAge < FRESH_SECONDS;

  function formatAge(seconds) {
    if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  // Toggle state: 'deployed' | 'expiring' | 'missing' | 'network'.
  // Defaults to the FIRST tab in the strip -- opening on a tab three positions along reads
  // as a stuck selection rather than a default.
  let viewMode = 'deployed';

  // Speed constants for consistent scroll speed across carousels
  const SECONDS_PER_ITEM = 5;
  const MOBILE_SECONDS_PER_ITEM = 3.5;

  // Duplicate the array for seamless infinite scroll. The second half is a visual copy
  // only -- it is aria-hidden so screen readers hear each item once (issue #324).
  $: duplicatedStats = [...stats, ...stats];

  // Explicit pause (issue #324, WCAG 2.2.2). Hover and keyboard focus pause it too, but touch
  // users have neither, and the ticker otherwise moves forever.
  let paused = false;

  const TABS = [
    { mode: 'deployed', label: 'Latest Deployed Apps' },
    { mode: 'expiring', label: 'Expiring Soon' },
    { mode: 'missing', label: 'Missing Deployments' },
    { mode: 'network', label: 'Top Network Stats' }
  ];

  // Dynamic duration based on item count for consistent visual speed
  $: scrollDuration = stats.length > 0 ? stats.length * SECONDS_PER_ITEM : 90;
  $: mobileScrollDuration = stats.length > 0 ? stats.length * MOBILE_SECONDS_PER_ITEM : 60;

  onMount(async () => {
    API_URL = getApiUrl();
    await fetchCarouselStats();

    // Match the backend refresh cadence instead of a fixed hour; idle in a hidden tab (#298)
    interval = pollWhileVisible(fetchCarouselStats, CAROUSEL_CONFIG.updateInterval);
    mounted = true;
  });

  // Re-fetch when the footer's Refresh button fires (skip the initial store value)
  let lastRefresh = 0;
  $: if (mounted && $refreshSignal > lastRefresh) {
    lastRefresh = $refreshSignal;
    fetchCarouselStats();
  }

  onDestroy(() => {
    interval?.();
  });

  async function fetchCarouselStats() {
    try {
      const endpoint = {
        network: `${API_URL}/api/carousel/stats`,
        deployed: `${API_URL}/api/carousel/deployed`,
        expiring: `${API_URL}/api/carousel/expiring`,
        missing: `${API_URL}/api/carousel/missing`
      }[viewMode];

      console.log(`🎠 Fetching carousel data from: ${endpoint}`);

      const response = await fetch(endpoint);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ Carousel data received:`, data);

      // The API already reports how old its cache is — the badge used to ignore it
      // and claim LIVE regardless (issue #54).
      cacheAge = typeof data.cacheAge === 'number' ? data.cacheAge : 0;

      if (data && data.stats && data.stats.length > 0) {
        stats = data.stats;
        error = null;
        loading = false;
        console.log(`✅ Loaded ${stats.length} carousel items`);
      } else if (stats.length === 0) {
        // 'missing' is the one tab whose empty state is GOOD NEWS. Saying "no data" there
        // would read as a broken ticker rather than a fully deployed network.
        error = {
          deployed: 'No apps deployed today',
          expiring: 'No apps expiring within 24 hours',
          missing: 'All apps are running everything they ordered',
          network: 'No stats available'
        }[viewMode] || 'No stats available';
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

  // Days, months or years once past a day -- a fresh deployment's week read as "167h 59m";
  // hours and minutes only where they matter, under a day (the Expiring Soon tab).
  const formatBlocksAsTime = formatBlocksLeft;
</script>

<div class="carousel-container">
  <div class="carousel-header">
    <div class="header-content">
      <!-- The icon carries the mode's own colour, matching the accent each view already
           uses in its rows: green for a new deployment, orange for time running out,
           purple for a gap in coverage. Network stats keep the card's default cyan. -->
      {#if viewMode === 'deployed'}
        <Package size={20} class="header-icon icon-deployed" />
      {:else if viewMode === 'expiring'}
        <Hourglass size={20} class="header-icon icon-expiring" />
      {:else if viewMode === 'missing'}
        <TriangleAlert size={20} class="header-icon icon-missing" />
      {:else}
        <TrendingUp size={20} class="header-icon" />
      {/if}

      <!-- One scrollable row on narrow screens (issue #329) -- the four tabs used to stack
           into a ~200px column above a one-line ticker. -->
      <div class="view-toggle" role="group" aria-label="Ticker view">
        {#each TABS as tab (tab.mode)}
          <button
            type="button"
            class="toggle-btn"
            class:active={viewMode === tab.mode}
            aria-pressed={viewMode === tab.mode}
            on:click={() => toggleViewMode(tab.mode)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
    </div>
    <button
      type="button"
      class="pause-btn"
      aria-pressed={paused}
      aria-label={paused ? 'Resume ticker' : 'Pause ticker'}
      title={paused ? 'Resume ticker' : 'Pause ticker'}
      on:click={() => (paused = !paused)}
    >
      {#if paused}<Play size={14} />{:else}<Pause size={14} />{/if}
    </button>
    <div class="live-indicator" class:stale={!isFresh} title="Data age: {formatAge(cacheAge)}">
      <span class="live-dot"></span>
      {#if isFresh}
        <span class="live-text">LIVE</span>
      {:else}
        <span class="live-text stale-text">{formatAge(cacheAge)} AGO</span>
      {/if}
    </div>
  </div>

  <!-- style: directives, not a style="" attribute -- see Chart.svelte's note: the CSP
       blocks inline style attributes, so these scroll durations never reached the CSS. -->
  <div
    class="carousel-track-container"
    class:paused
    use:cssomStyle={{ '--scroll-duration': `${scrollDuration}s`, '--mobile-scroll-duration': `${mobileScrollDuration}s` }}
  >
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
          <div class="carousel-item" aria-hidden={index >= stats.length ? 'true' : undefined}>
            {#if stat.rank}
              <span class="item-rank">#{stat.rank}</span>
            {/if}

            {#if stat.tier}
              <span class="item-tier tier-{stat.tier.toLowerCase()}">{stat.tier}</span>
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

  /* Per-view colours. The glow is redeclared with each one, not inherited: `filter` takes a
     colour literal, not `currentColor`, so leaving it out would keep the cyan halo around a
     green icon. */
  :global(.header-icon.icon-deployed) {
    color: var(--accent-green);
    filter: drop-shadow(0 0 4px var(--accent-green));
  }

  :global(.header-icon.icon-expiring) {
    color: var(--accent-orange);
    filter: drop-shadow(0 0 4px var(--accent-orange));
  }

  :global(.header-icon.icon-missing) {
    color: var(--accent-purple);
    filter: drop-shadow(0 0 4px var(--accent-purple));
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
    white-space: nowrap;
  }

  /* Stale data drops the green glow and the pulse so it doesn't read as live */
  .live-indicator.stale .live-dot {
    background: var(--text-muted);
    animation: none;
  }

  .live-text.stale-text {
    color: var(--text-muted);
    text-shadow: none;
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

  /* Pause on hover, on keyboard focus inside the track, or on the explicit button (#324) */
  .carousel-track-container:hover .carousel-track,
  .carousel-track-container:focus-within .carousel-track,
  .carousel-track-container.paused .carousel-track {
    animation-play-state: paused;
  }

  .pause-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    margin-right: var(--spacing-sm);
    /* app.css's global button padding (0.5rem 1rem) left a 28px button no room for its icon */
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .pause-btn:hover,
  .pause-btn:focus-visible,
  .pause-btn[aria-pressed='true'] {
    color: var(--accent-cyan);
    border-color: var(--accent-cyan);
    background: transparent;
    box-shadow: none;
    transform: none;
  }

  /* Reduced motion (issue #324): no marquee at all. The track becomes a row the reader
     scrolls themselves, the visual duplicate is dropped and the pause button has nothing to
     pause. */
  @media (prefers-reduced-motion: reduce) {
    .carousel-track {
      animation: none;
    }

    .carousel-track-container {
      overflow-x: auto;
    }

    .carousel-item[aria-hidden='true'],
    .pause-btn {
      display: none;
    }

    .live-dot,
    .loading-spinner {
      animation: none;
    }
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

  /* Tier badge (issue #161). The carousel now walks Cumulus -> Nimbus -> Stratus, and
     without a per-slide tier the three "Most Cores" figures read as one number changing
     rather than as three tiers. Each tier gets its own colour so the transition between
     blocks is visible at a glance while the track scrolls. */
  .item-tier {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border: 1px solid currentColor;
    border-radius: 3px;
    opacity: 0.9;
  }

  .item-tier.tier-cumulus {
    color: var(--accent-cyan);
  }

  .item-tier.tier-nimbus {
    color: var(--accent-purple);
  }

  .item-tier.tier-stratus {
    color: var(--accent-orange, #f97316);
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
    .header-content {
      min-width: 0;
    }

    .view-toggle {
      gap: 0.25rem;
      overflow-x: auto;
      scrollbar-width: none;
      min-width: 0;
      /* Fade the clipped edge so the row reads as scrollable, not cut off */
      mask-image: linear-gradient(to right, #000 80%, transparent);
      -webkit-mask-image: linear-gradient(to right, #000 80%, transparent);
    }

    .view-toggle::-webkit-scrollbar {
      display: none;
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

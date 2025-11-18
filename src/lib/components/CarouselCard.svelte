<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl } from '$lib/config.js';
  import { TrendingUp } from 'lucide-svelte';
  
  let API_URL = '';
  let stats = [];
  let loading = true;
  let error = null;
  let interval;
  
  // Duplicate the array for seamless infinite scroll
  $: duplicatedStats = [...stats, ...stats];
  
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
      const response = await fetch(`${API_URL}/api/carousel/stats`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch carousel stats');
      }
      
      const data = await response.json();
      
      if (data && data.stats && data.stats.length > 0) {
        stats = data.stats;
        error = null;
        loading = false;
      } else if (stats.length === 0) {
        error = 'No stats available';
        loading = false;
      }
      
    } catch (err) {
      console.error('Error fetching carousel stats:', err);
      if (stats.length === 0) {
        error = err.message;
      }
      loading = false;
    }
  }
  
  function formatNumber(num) {
    return new Intl.NumberFormat('en-US').format(num);
  }
</script>

<div class="carousel-container">
  <div class="carousel-header">
    <div class="header-content">
      <TrendingUp size={20} class="header-icon" />
      <h3 class="carousel-title">Top Network Stats</h3>
    </div>
    <div class="live-indicator">
      <span class="live-dot"></span>
      <span class="live-text">LIVE</span>
    </div>
  </div>
  
  <div class="carousel-track-container">
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
      <div class="carousel-track">
        {#each duplicatedStats as stat, index (index)}
          <div class="carousel-item">
            <span class="item-label">
              {stat.label}:
            </span>
            <span class="item-name">{stat.name}</span>
            <span class="item-value">
              {formatNumber(stat.value)}
            </span>
            <span class="item-unit">{stat.unit}</span>
            <span class="item-separator">•</span>
          </div>
        {/each}
      </div>
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
  }
  
  :global(.header-icon) {
    color: var(--accent-cyan);
    filter: drop-shadow(0 0 4px var(--accent-cyan));
  }
  
  .carousel-title {
    font-size: 0.875rem;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-primary);
    margin: 0;
    font-weight: 600;
  }
  
  .live-indicator {
    display: flex;
    align-items: center;
    gap: 0.375rem;
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
    animation: scroll 90s linear infinite;
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
  
  /* Responsive */
  @media (max-width: 768px) {
    .carousel-title {
      font-size: 0.75rem;
    }
    
    .item-name {
      max-width: 150px;
    }
    
    .carousel-track {
      animation-duration: 60s; /* Faster on mobile */
    }
  }
</style>
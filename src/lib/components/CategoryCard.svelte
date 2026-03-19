<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl } from '$lib/config.js';

  export let category = '';
  export let label = '';
  export let icon = null;
  export let loading = false;
  export let period = 'D';

  const periodDaysMap = { D: 1, W: 7, M: 30, Q: 90, Y: 365 };

  let API_URL = '';
  let repos = [];
  let total = 0;
  let previousTotal = 0;
  let previousRepos = [];
  let fetchError = false;
  let interval;
  let mounted = false;

  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }

  function getComparison(current, previous) {
    const change = current - previous;
    let trend = 'neutral';
    if (change > 0) trend = 'up';
    else if (change < 0) trend = 'down';
    return { change, trend };
  }

  async function fetchCategoryData() {
    if (!API_URL || !category) return;
    try {
      const days = periodDaysMap[period] || 7;
      const response = await fetch(`${API_URL}/api/metrics/category/${category}/top?limit=3&days=${days}`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();

      repos = data.repos || [];
      total = data.total || 0;
      previousTotal = data.previousTotal || 0;
      previousRepos = data.previousRepos || [];
      fetchError = false;
    } catch (error) {
      console.error(`Error fetching ${category} data:`, error);
      fetchError = true;
    }
  }

  onMount(() => {
    API_URL = getApiUrl();
    fetchCategoryData();
    interval = setInterval(fetchCategoryData, 30 * 60 * 1000);
    mounted = true;
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  // Re-fetch when period changes (after initial mount)
  $: if (mounted && period) {
    fetchCategoryData();
  }

  $: totalComparison = getComparison(total, previousTotal);
</script>

<div class="category-card terminal-border" class:loading>
  <div class="category-header">
    <div class="category-icon">
      {#if icon}
        <svelte:component this={icon} size={24} strokeWidth={2} />
      {/if}
    </div>
    <div class="category-title">{label}</div>
  </div>

  {#if !loading}
    {#if repos.length > 0}
      <div class="category-metrics">
        {#each repos as repo, i}
          {@const prevRepo = previousRepos[i]}
          {@const prevCount = prevRepo?.instance_count || 0}
          {@const comparison = getComparison(repo.instance_count, prevCount)}
          <div class="category-metric">
            <div class="metric-row">
              <div class="metric-label">{repo.displayName}</div>
              <div class="metric-value cyan">{formatNumber(repo.instance_count)}</div>
            </div>

            {#if prevCount > 0 && comparison.change !== 0}
              <div class="metric-change" class:up={comparison.trend === 'up'} class:down={comparison.trend === 'down'} class:neutral={comparison.trend === 'neutral'}>
                {#if comparison.trend === 'up'}
                  <span class="trend-arrow">&#8593;</span>
                {:else if comparison.trend === 'down'}
                  <span class="trend-arrow">&#8595;</span>
                {/if}
                {comparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(comparison.change))}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="category-total">
        <div class="total-label">Total {label}</div>
        <div class="total-value">{formatNumber(total)}</div>
        {#if previousTotal > 0 && totalComparison.change !== 0}
          <div class="total-change" class:up={totalComparison.trend === 'up'} class:down={totalComparison.trend === 'down'}>
            {#if totalComparison.trend === 'up'}
              <span class="trend-arrow">&#8593;</span>
            {:else if totalComparison.trend === 'down'}
              <span class="trend-arrow">&#8595;</span>
            {/if}
            {totalComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(totalComparison.change))}
          </div>
        {/if}
      </div>
    {:else if fetchError}
      <div class="loading-state">Failed to load data</div>
    {:else}
      <div class="loading-state">No data available</div>
    {/if}
  {:else}
    <div class="loading-state">Loading {label.toLowerCase()} data...</div>
  {/if}
</div>

<style>
  .category-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }

  .category-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .category-card.loading {
    pointer-events: none;
  }

  .category-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .category-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }

  .category-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }

  .category-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }

  .category-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .category-metric {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .metric-row {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .metric-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .metric-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-white);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .metric-value.cyan {
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
  }

  .metric-change {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    width: fit-content;
    margin-top: var(--spacing-xs);
  }

  .metric-change.up {
    color: var(--accent-green);
    background: rgba(0, 255, 65, 0.1);
    border: 1px solid rgba(0, 255, 65, 0.3);
  }

  .metric-change.down {
    color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
  }

  .metric-change.neutral {
    color: var(--text-dim);
    background: rgba(139, 146, 176, 0.1);
    border: 1px solid rgba(139, 146, 176, 0.3);
  }

  .trend-arrow {
    font-size: 0.875rem;
    font-weight: 700;
  }

  .category-total {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .total-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    flex: 1;
  }

  .total-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
    font-variant-numeric: tabular-nums;
  }

  .total-change {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-sm);
  }

  .total-change.up {
    color: var(--accent-green);
    background: rgba(0, 255, 65, 0.1);
    border: 1px solid rgba(0, 255, 65, 0.3);
  }

  .total-change.down {
    color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
  }

  .loading-state {
    padding: var(--spacing-lg);
    text-align: center;
    color: var(--text-muted);
  }

  @media (max-width: 768px) {
    .category-metrics {
      grid-template-columns: 1fr !important;
      gap: var(--spacing-lg);
    }

    .metric-value {
      font-size: 1.5rem;
    }

    .category-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }

    .total-value {
      font-size: 1.25rem;
    }
  }

  .category-card:hover .category-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }

  .category-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }

  .category-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>

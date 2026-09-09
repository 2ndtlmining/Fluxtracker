<script>
  import { Package } from 'lucide-svelte';

  // Total app instance count is unaffected by the FluxOS v8.18 change (see issue #106) --
  // it comes from the running-apps census, not per-app image resolution.
  export let totalApps = 0;
  export let totalComparison = null; // { change: number, trend: 'up'|'down'|'neutral' } | null

  // Deployed/expiring today (issue #108 follow-up) -- deduped counts from
  // carouselService.getFluxCloudActivity(), the same function the KPI report and the
  // daily snapshot collector use. null means "not available" (an uncached on-demand
  // fetch failure), never a fabricated 0.
  export let deployedToday = null;
  export let deployedComparison = null;
  export let expiringToday = null;
  export let expiringComparison = null;

  export let loading = false;

  function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    return num.toLocaleString();
  }

  function formatChange(comparison) {
    return `${comparison.change >= 0 ? '+' : ''}${comparison.change.toFixed(1)}%`;
  }
</script>

<div class="app-instances-card terminal-border" class:loading>
  <div class="card-header">
    <div class="card-icon"><Package size={24} strokeWidth={2} /></div>
    <div class="card-title">Total App Instances</div>
  </div>

  {#if loading}
    <div class="card-empty-state">Loading...</div>
  {:else}
    <div class="total-row">
      <div class="total-value">{formatNumber(totalApps)}</div>
      <div class="total-subtitle">Across the network</div>
      {#if totalComparison && totalComparison.change !== undefined}
        <div class="metric-change" class:up={totalComparison.trend === 'up'} class:down={totalComparison.trend === 'down'} class:neutral={totalComparison.trend === 'neutral'}>
          {#if totalComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if totalComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
          {formatChange(totalComparison)}
        </div>
      {/if}
    </div>

    <div class="activity-grid">
      <div class="activity-metric">
        <div class="activity-label">Deployed Today</div>
        <div class="activity-value">{formatNumber(deployedToday)}</div>
        {#if deployedComparison && deployedComparison.change !== undefined}
          <div class="metric-change" class:up={deployedComparison.trend === 'up'} class:down={deployedComparison.trend === 'down'} class:neutral={deployedComparison.trend === 'neutral'}>
            {#if deployedComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if deployedComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
            {formatChange(deployedComparison)}
          </div>
        {/if}
      </div>

      <div class="activity-metric">
        <div class="activity-label">Expiring Today</div>
        <div class="activity-value">{formatNumber(expiringToday)}</div>
        {#if expiringComparison && expiringComparison.change !== undefined}
          <div class="metric-change" class:up={expiringComparison.trend === 'up'} class:down={expiringComparison.trend === 'down'} class:neutral={expiringComparison.trend === 'neutral'}>
            {#if expiringComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if expiringComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
            {formatChange(expiringComparison)}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .app-instances-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
  }

  .app-instances-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .app-instances-card.loading {
    pointer-events: none;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }

  .card-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }

  .card-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }

  .card-empty-state {
    padding: var(--spacing-lg) 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .total-row {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    padding-bottom: var(--spacing-md);
    margin-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }

  .total-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .total-subtitle {
    font-size: 0.875rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .activity-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-md);
  }

  .activity-metric {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .activity-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .activity-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-white);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  /* Comparison indicator (mirrors CloudCard.svelte's .metric-change) */
  .metric-change {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    width: fit-content;
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

  @media (max-width: 768px) {
    .activity-grid {
      grid-template-columns: 1fr;
      gap: var(--spacing-sm);
    }

    .total-value {
      font-size: 1.5rem;
    }
  }

  .app-instances-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>

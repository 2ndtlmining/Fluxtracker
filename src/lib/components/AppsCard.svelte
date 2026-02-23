<script>
  import { Package } from 'lucide-svelte';
  
  export let git = { count: 0 };
  export let docker = { count: 0 };
  export let total = 0;
  export let loading = false;
  
  // Comparison data (optional)
  export let gitAppsComparison = null;        // { change: number, trend: 'up'|'down'|'neutral' }
  export let dockerAppsComparison = null;
  export let totalComparison = null;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
</script>

<div class="apps-card terminal-border" class:loading>
  <div class="apps-header">
    <div class="apps-icon">
      <Package size={24} strokeWidth={2} />
    </div>
    <div class="apps-title">Total App Instances</div>
  </div>
  
  {#if !loading}
    <div class="apps-metrics">
      <!-- Git Apps -->
      <div class="apps-metric">
        <div class="metric-row">
          <div class="metric-label" title="Git">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="Git">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
          </div>
          <div class="metric-value cyan">{formatNumber(git.count)}</div>
        </div>
        
        <!-- Git Comparison -->
        {#if gitAppsComparison && gitAppsComparison.change !== undefined}
          <div class="metric-change" class:up={gitAppsComparison.trend === 'up'} class:down={gitAppsComparison.trend === 'down'} class:neutral={gitAppsComparison.trend === 'neutral'}>
            {#if gitAppsComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if gitAppsComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {gitAppsComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(gitAppsComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Docker Apps -->
      <div class="apps-metric">
        <div class="metric-row">
          <div class="metric-label" title="Docker">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="currentColor" aria-label="Docker">
              <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
            </svg>
          </div>
          <div class="metric-value cyan">{formatNumber(docker.count)}</div>
        </div>
        
        <!-- Docker Comparison -->
        {#if dockerAppsComparison && dockerAppsComparison.change !== undefined}
          <div class="metric-change" class:up={dockerAppsComparison.trend === 'up'} class:down={dockerAppsComparison.trend === 'down'} class:neutral={dockerAppsComparison.trend === 'neutral'}>
            {#if dockerAppsComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if dockerAppsComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {dockerAppsComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(dockerAppsComparison.change))}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Total with comparison -->
    <div class="apps-total">
      <div class="total-label">Total App Instances</div>
      <div class="total-value">{formatNumber(total)}</div>
      {#if totalComparison && totalComparison.change !== undefined}
        <div class="total-change" class:up={totalComparison.trend === 'up'} class:down={totalComparison.trend === 'down'}>
          {#if totalComparison.trend === 'up'}
            <span class="trend-arrow">↑</span>
          {:else if totalComparison.trend === 'down'}
            <span class="trend-arrow">↓</span>
          {/if}
          {totalComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(totalComparison.change))}
        </div>
      {/if}
    </div>
  {:else}
    <div class="loading-state">Loading apps data...</div>
  {/if}
</div>

<style>
  .apps-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .apps-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .apps-card.loading {
    pointer-events: none;
  }
  
  .apps-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .apps-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }
  
  .apps-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }
  
  .apps-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  .apps-metrics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  
  .apps-metric {
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
    display: flex;
    align-items: center;
  }

  .brand-icon {
    width: 18px;
    height: 18px;
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
    display: block;
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
  
  /* Comparison indicator */
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
  
  /* Total Section */
  .apps-total {
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
  
  /* Responsive */
  @media (max-width: 768px) {
    .apps-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
    
    .apps-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .total-value {
      font-size: 1.25rem;
    }
  }
  
  /* Hover Effects */
  .apps-card:hover .apps-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
  
  .apps-card:hover .brand-icon {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }

  .apps-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .apps-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
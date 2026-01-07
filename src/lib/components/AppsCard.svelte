<script>
  import { Package } from 'lucide-svelte';
  
  export let git = { count: 0 };
  export let docker = { count: 0 };
  export let total = 0;
  export let loading = false;
  
  // Comparison data (optional)
  export let gitComparison = null;        // { change: number, trend: 'up'|'down'|'neutral' }
  export let dockerComparison = null;
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
    <div class="apps-title">Total Apps</div>
  </div>
  
  {#if !loading}
    <div class="apps-metrics">
      <!-- Git Apps -->
      <div class="apps-metric">
        <div class="metric-row">
          <div class="metric-label">Git</div>
          <div class="metric-value cyan">{formatNumber(git.count)}</div>
        </div>
        
        <!-- Git Comparison -->
        {#if gitComparison && gitComparison.change !== undefined}
          <div class="metric-change" class:up={gitComparison.trend === 'up'} class:down={gitComparison.trend === 'down'}>
            {#if gitComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if gitComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {gitComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(gitComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Docker Apps -->
      <div class="apps-metric">
        <div class="metric-row">
          <div class="metric-label">Docker</div>
          <div class="metric-value cyan">{formatNumber(docker.count)}</div>
        </div>
        
        <!-- Docker Comparison -->
        {#if dockerComparison && dockerComparison.change !== undefined}
          <div class="metric-change" class:up={dockerComparison.trend === 'up'} class:down={dockerComparison.trend === 'down'}>
            {#if dockerComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if dockerComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {dockerComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(dockerComparison.change))}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Total with comparison -->
    <div class="apps-total">
      <div class="total-label">Total Apps</div>
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
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
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
  
  .apps-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .apps-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
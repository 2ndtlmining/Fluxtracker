<script>
  export let cumulus = { count: 0 };
  export let nimbus = { count: 0 };
  export let stratus = { count: 0 };
  export let total = 0;
  export let loading = false;
  
  // Comparison data (optional)
  export let cumulusComparison = null;    // { change: number, trend: 'up'|'down'|'neutral' }
  export let nimbusComparison = null;
  export let stratusComparison = null;
  export let totalComparison = null;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
</script>

<div class="node-card terminal-border" class:loading>
  <div class="node-header">
    <div class="node-icon">📊</div>
    <div class="node-title">Total Nodes</div>
  </div>
  
  {#if !loading}
    <div class="node-metrics">
      <!-- Cumulus -->
      <div class="node-metric">
        <div class="metric-row">
          <div class="metric-label">Cumulus</div>
          <div class="metric-value cyan">{formatNumber(cumulus.count)}</div>
        </div>
        
        <!-- Cumulus Comparison -->
        {#if cumulusComparison && cumulusComparison.change !== undefined}
          <div class="metric-change" class:up={cumulusComparison.trend === 'up'} class:down={cumulusComparison.trend === 'down'}>
            {#if cumulusComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if cumulusComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {cumulusComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(cumulusComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Nimbus -->
      <div class="node-metric">
        <div class="metric-row">
          <div class="metric-label">Nimbus</div>
          <div class="metric-value cyan">{formatNumber(nimbus.count)}</div>
        </div>
        
        <!-- Nimbus Comparison -->
        {#if nimbusComparison && nimbusComparison.change !== undefined}
          <div class="metric-change" class:up={nimbusComparison.trend === 'up'} class:down={nimbusComparison.trend === 'down'}>
            {#if nimbusComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if nimbusComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {nimbusComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(nimbusComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Stratus -->
      <div class="node-metric">
        <div class="metric-row">
          <div class="metric-label">Stratus</div>
          <div class="metric-value cyan">{formatNumber(stratus.count)}</div>
        </div>
        
        <!-- Stratus Comparison -->
        {#if stratusComparison && stratusComparison.change !== undefined}
          <div class="metric-change" class:up={stratusComparison.trend === 'up'} class:down={stratusComparison.trend === 'down'}>
            {#if stratusComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if stratusComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {stratusComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(stratusComparison.change))}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Total with comparison -->
    <div class="node-total">
      <div class="total-label">Network Total</div>
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
    <div class="loading-state">Loading node data...</div>
  {/if}
</div>

<style>
  .node-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .node-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .node-card.loading {
    pointer-events: none;
  }
  
  .node-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .node-icon {
    font-size: 1.5rem;
    opacity: 0.9;
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }
  
  .node-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  .node-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  
  .node-metric {
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
  
  /* Network Total Section */
  .node-total {
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
    .node-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
    
    .node-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .total-value {
      font-size: 1.25rem;
    }
  }
  
  /* Hover Effects */
  .node-card:hover .node-icon {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
    transition: all 0.3s ease;
  }
  
  .node-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .node-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
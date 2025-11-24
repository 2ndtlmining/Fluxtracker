<script>
  import { Coins } from 'lucide-svelte';
  
  export let presearch = { count: 0 };
  export let kaspa = { count: 0 };
  export let alephium = { count: 0 };
  export let timpi_collector = { count: 0 };
  export let total = 0;
  export let loading = false;
  
  // Comparison data (optional)
  export let presearchComparison = null;    // { change: number, trend: 'up'|'down'|'neutral' }
  export let kaspaComparison = null;
  export let alephiumComparison = null;
  export let totalComparison = null;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
</script>

<div class="crypto-card terminal-border" class:loading>
  <div class="crypto-header">
    <div class="crypto-icon">
      <Coins size={24} strokeWidth={2} />
    </div>
    <div class="crypto-title">Crypto Nodes</div>
  </div>
  
  {#if !loading}
    <div class="crypto-metrics">
      <!-- Presearch -->
      <div class="crypto-metric">
        <div class="metric-row">
          <div class="metric-label">Presearch</div>
          <div class="metric-value cyan">{formatNumber(presearch.count)}</div>
        </div>
        
        <!-- Presearch Comparison -->
        {#if presearchComparison && presearchComparison.change !== undefined}
          <div class="metric-change" class:up={presearchComparison.trend === 'up'} class:down={presearchComparison.trend === 'down'}>
            {#if presearchComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if presearchComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {presearchComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(presearchComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Kaspa -->
      <div class="crypto-metric">
        <div class="metric-row">
          <div class="metric-label">Kaspa</div>
          <div class="metric-value cyan">{formatNumber(kaspa.count)}</div>
        </div>
        
        <!-- Kaspa Comparison -->
        {#if kaspaComparison && kaspaComparison.change !== undefined}
          <div class="metric-change" class:up={kaspaComparison.trend === 'up'} class:down={kaspaComparison.trend === 'down'}>
            {#if kaspaComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if kaspaComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {kaspaComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(kaspaComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Alephium -->
      <div class="crypto-metric">
        <div class="metric-row">
          <div class="metric-label">Alephium</div>
          <div class="metric-value cyan">{formatNumber(alephium.count)}</div>
        </div>
        
        <!-- Alephium Comparison -->
        {#if alephiumComparison && alephiumComparison.change !== undefined}
          <div class="metric-change" class:up={alephiumComparison.trend === 'up'} class:down={alephiumComparison.trend === 'down'}>
            {#if alephiumComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if alephiumComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {alephiumComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(alephiumComparison.change))}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Total with comparison -->
    <div class="crypto-total">
      <div class="total-label">Total Nodes</div>
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
    <div class="loading-state">Loading crypto data...</div>
  {/if}
</div>

<style>
  .crypto-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .crypto-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .crypto-card.loading {
    pointer-events: none;
  }
  
  .crypto-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .crypto-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }
  
  .crypto-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }
  
  .crypto-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  .crypto-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  
  .crypto-metric {
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
  .crypto-total {
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
    .crypto-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
    
    .crypto-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .total-value {
      font-size: 1.25rem;
    }
  }
  
  /* Hover Effects */
  .crypto-card:hover .crypto-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
  
  .crypto-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .crypto-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
<script>
  import { DollarSign } from 'lucide-svelte';
  
  export let payments = { count: 0 };
  export let usd = { amount: 0 };
  export let flux = { amount: 0, change: 0, trend: 'neutral' };
  export let loading = false;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return Math.round(num).toLocaleString();
  }
  
  function formatDecimal(num) {
    if (!num) return '0.00';
    return num.toFixed(2);
  }
</script>

<div class="revenue-card terminal-border" class:loading>
  <div class="revenue-header">
    <div class="revenue-icon">
      <DollarSign size={24} strokeWidth={2} />
    </div>
    <div class="revenue-title">Daily Revenue</div>
  </div>
  
  {#if !loading}
    <div class="revenue-metrics">
      <!-- Payments Count -->
      <div class="revenue-metric">
        <div class="metric-row">
          <div class="metric-label">Payments</div>
          <div class="metric-value cyan">{formatNumber(payments.count)}</div>
        </div>
      </div>
      
      <!-- USD -->
      <div class="revenue-metric">
        <div class="metric-row">
          <div class="metric-label">USD Equivalent</div>
          <div class="metric-value cyan">${formatDecimal(usd.amount)}</div>
        </div>
      </div>
    </div>
    
    <!-- Total Section -->
    <div class="revenue-total">
      <div class="total-label">Today's Revenue</div>
      <div class="total-value">{formatDecimal(flux.amount)} FLUX</div>
      {#if flux.change !== undefined && flux.change !== 0}
        <div class="total-change" class:up={flux.trend === 'up'} class:down={flux.trend === 'down'}>
          {#if flux.trend === 'up'}
            <span class="trend-arrow">↑</span>
          {:else if flux.trend === 'down'}
            <span class="trend-arrow">↓</span>
          {/if}
          {flux.change >= 0 ? '+' : ''}{formatDecimal(flux.change)}%
        </div>
      {/if}
    </div>
  {:else}
    <div class="loading-state">Loading revenue data...</div>
  {/if}
</div>

<style>
  .revenue-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .revenue-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .revenue-card.loading {
    pointer-events: none;
  }
  
  .revenue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .revenue-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }
  
  .revenue-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }
  
  .revenue-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  .revenue-metrics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
    /* Add extra padding to align border with NodeCard which has comparison indicators */
    padding-bottom: calc(var(--spacing-xs) + 1rem + 0.5rem + 0.5rem);
  }
  
  .revenue-metric {
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
  
  /* Revenue Total Section */
  .revenue-total {
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
    .revenue-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
    
    .revenue-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .total-value {
      font-size: 1.25rem;
    }
  }
  
  /* Hover Effects */
  .revenue-card:hover .revenue-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
  
  .revenue-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .revenue-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
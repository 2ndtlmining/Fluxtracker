<script>
  import { DollarSign } from 'lucide-svelte';
  
  export let payments = { count: 0 };
  export let usd = { amount: 0 };
  export let flux = { amount: 0, change: 0, trend: 'neutral' };
  export let loading = false;
  export let period = 'D'; // D, W, M, Q, Y
  
  // Map period to display name
  const periodNames = {
    'D': 'Daily Revenue',
    'W': 'Weekly Revenue',
    'M': 'Monthly Revenue',
    'Q': 'Quarterly Revenue',
    'Y': 'Yearly Revenue'
  };
  
  $: periodName = periodNames[period] || 'Daily Revenue';
  
  /**
   * Format payment counts
   */
  function formatPaymentCount(num) {
    if (!num) return '0';
    
    const absNum = Math.abs(num);
    
    if (absNum >= 1000000) {
      return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
    } else if (absNum >= 10000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    } else if (absNum >= 1000) {
      return Math.round(num).toLocaleString();
    } else {
      return Math.round(num).toString();
    }
  }
  
  /**
   * Format USD amounts
   */
  function formatUsd(num) {
    if (!num) return '$0.00';
    
    const absNum = Math.abs(num);
    
    if (absNum >= 1000000) {
      return '$' + (num / 1000000).toFixed(2) + 'M';
    } else if (absNum >= 10000) {
      return '$' + (num / 1000).toFixed(2) + 'K';
    } else if (absNum >= 1000) {
      return '$' + num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } else {
      return '$' + num.toFixed(2);
    }
  }
  
  /**
   * Format FLUX amounts
   */
  function formatFlux(num) {
    if (!num) return '0.00';
    
    const absNum = Math.abs(num);
    
    if (absNum >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (absNum >= 10000) {
      return (num / 1000).toFixed(2) + 'K';
    } else if (absNum >= 1000) {
      return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } else {
      return num.toFixed(2);
    }
  }
</script>

<div class="revenue-card terminal-border" class:loading>
  <div class="revenue-header">
    <div class="revenue-icon">
      <DollarSign size={24} strokeWidth={2} />
    </div>
    <div class="revenue-title">{periodName}</div>
  </div>
  
  {#if !loading}
    <div class="revenue-metrics">
      <!-- Payments -->
      <div class="revenue-metric">
        <div class="metric-row">
          <div class="metric-label">Payments</div>
          <div class="metric-value cyan">{formatPaymentCount(payments.count)}</div>
        </div>
      </div>
      
      <!-- USD -->
      <div class="revenue-metric">
        <div class="metric-row">
          <div class="metric-label">USD</div>
          <div class="metric-value cyan">{formatUsd(usd.amount)}</div>
        </div>
      </div>
      
      <!-- FLUX -->
      <div class="revenue-metric">
        <div class="metric-row">
          <div class="metric-label">FLUX</div>
          <div class="metric-value cyan">{formatFlux(flux.amount)}</div>
        </div>
        
        <!-- Trend badge under FLUX -->
        {#if flux.change !== undefined && flux.change !== 0}
          <div class="metric-change" class:up={flux.trend === 'up'} class:down={flux.trend === 'down'}>
            {#if flux.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if flux.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {flux.change >= 0 ? '+' : ''}{flux.change.toFixed(2)}%
          </div>
        {/if}
      </div>
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
  
  /* Revenue Metrics Grid */
  .revenue-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    /* Add extra padding to align with NodeCard which has comparison indicators */
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
  
  /* Metric Change */
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
  
  .trend-arrow {
    font-size: 0.875rem;
    font-weight: 700;
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
  }
  
  /* Hover Effects */
  .revenue-card:hover .revenue-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
</style>
<script>
  import { DollarSign } from 'lucide-svelte';
  
  // Daily props
  export let dailyPayments = { count: 0 };
  export let dailyUsd = { amount: 0 };
  export let dailyFlux = { amount: 0, change: 0, trend: 'neutral' };
  
  // Monthly props
  export let monthlyPayments = { count: 0 };
  export let monthlyUsd = { amount: 0 };
  export let monthlyFlux = { amount: 0, change: 0, trend: 'neutral' };
  
  export let loading = false;
  
  /**
   * Format numbers with K, M, B suffixes for large values
   */
  function formatLargeNumber(num) {
    if (!num) return '0';
    
    const absNum = Math.abs(num);
    
    if (absNum >= 1000000000) {
      return (num / 1000000000).toFixed(2).replace(/\.00$/, '') + 'B';
    } else if (absNum >= 1000000) {
      return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
    } else if (absNum >= 10000) {
      return (num / 1000).toFixed(2).replace(/\.00$/, '') + 'K';
    } else if (absNum >= 1000) {
      return Math.round(num).toLocaleString();
    } else {
      return num.toFixed(2).replace(/\.00$/, '');
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
</script>

<div class="revenue-card terminal-border" class:loading>
  <div class="revenue-header">
    <div class="revenue-icon">
      <DollarSign size={24} strokeWidth={2} />
    </div>
    <div class="revenue-title">Revenue Metrics</div>
  </div>
  
  {#if !loading}
    <!-- TODAY Section -->
    <div class="revenue-section">
      <div class="section-label">Today</div>
      
      <!-- Metrics Grid -->
      <div class="revenue-metrics">
        <!-- Payments -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">Payments</div>
            <div class="metric-value cyan">{formatPaymentCount(dailyPayments.count)}</div>
          </div>
        </div>
        
        <!-- USD -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">USD</div>
            <div class="metric-value cyan">{formatUsd(dailyUsd.amount)}</div>
          </div>
        </div>
        
        <!-- FLUX -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">FLUX</div>
            <div class="metric-value cyan">{formatFlux(dailyFlux.amount)}</div>
          </div>
          
          <!-- Daily Trend - Positioned under FLUX -->
          {#if dailyFlux.change !== undefined && dailyFlux.change !== 0}
            <div class="metric-change" class:up={dailyFlux.trend === 'up'} class:down={dailyFlux.trend === 'down'}>
              {#if dailyFlux.trend === 'up'}
                <span class="trend-arrow">↑</span>
              {:else if dailyFlux.trend === 'down'}
                <span class="trend-arrow">↓</span>
              {/if}
              {dailyFlux.change >= 0 ? '+' : ''}{dailyFlux.change.toFixed(2)}%
            </div>
          {/if}
        </div>
      </div>
    </div>
    
    <!-- Divider -->
    <div class="section-divider"></div>
    
    <!-- THIS MONTH Section -->
    <div class="revenue-section">
      <div class="section-label">This Month</div>
      
      <!-- Metrics Grid -->
      <div class="revenue-metrics">
        <!-- Payments -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">Payments</div>
            <div class="metric-value cyan">{formatPaymentCount(monthlyPayments.count)}</div>
          </div>
        </div>
        
        <!-- USD -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">USD</div>
            <div class="metric-value cyan">{formatUsd(monthlyUsd.amount)}</div>
          </div>
        </div>
        
        <!-- FLUX -->
        <div class="revenue-metric">
          <div class="metric-row">
            <div class="metric-label">FLUX</div>
            <div class="metric-value cyan">{formatFlux(monthlyFlux.amount)}</div>
          </div>
          
          <!-- Monthly Trend - Positioned under FLUX -->
          {#if monthlyFlux.change !== undefined && monthlyFlux.change !== 0}
            <div class="metric-change" class:up={monthlyFlux.trend === 'up'} class:down={monthlyFlux.trend === 'down'}>
              {#if monthlyFlux.trend === 'up'}
                <span class="trend-arrow">↑</span>
              {:else if monthlyFlux.trend === 'down'}
                <span class="trend-arrow">↓</span>
              {/if}
              {monthlyFlux.change >= 0 ? '+' : ''}{monthlyFlux.change.toFixed(2)}%
            </div>
          {/if}
        </div>
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
  
  /* Revenue Sections */
  .revenue-section {
    margin-bottom: var(--spacing-sm);
  }
  
  .section-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
  }
  
  /* Revenue Metrics Grid - Matching NodeCard structure */
  .revenue-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-xs);
  }
  
  .revenue-metric {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  
  /* Metric Row - Matching NodeCard exactly */
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
  
  /* Divider */
  .section-divider {
    height: 1px;
    background: var(--border-color);
    margin: var(--spacing-md) 0;
  }
  
  /* Metric Change - Matching NodeCard */
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
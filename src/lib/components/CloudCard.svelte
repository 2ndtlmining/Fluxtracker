<script>
  import { Cloud } from 'lucide-svelte';
  
  export let cpu = { total: 0, used: 0, utilization: 0 };
  export let ram = { total: 0, used: 0, utilization: 0 };
  export let storage = { total: 0, used: 0, utilization: 0 };
  export let loading = false;
  
  // Comparison data (optional)
  export let cpuComparison = null;      // { change: number, trend: 'up'|'down'|'neutral' }
  export let ramComparison = null;
  export let storageComparison = null;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
  
  function formatDecimal(num) {
    if (!num) return '0.00';
    return num.toFixed(2);
  }
  
  // Determine demand level based on CPU utilization
  $: demandLevel = getDemandLevel(cpu.utilization);
  
  function getDemandLevel(utilization) {
    if (utilization < 25) return 'poor';
    if (utilization < 50) return 'mediocre';
    if (utilization < 75) return 'high';
    return 'extreme';
  }
  
  function getDemandLabel(level) {
    switch(level) {
      case 'poor': return '⚪ Poor Demand';
      case 'mediocre': return '🟡 Mediocre Demand';
      case 'high': return '🟠 High Demand';
      case 'extreme': return '🔴 Extreme Demand';
      default: return '';
    }
  }
</script>

<div class="cloud-card terminal-border" class:loading>
  <div class="cloud-header">
    <div class="cloud-icon">
      <Cloud size={24} strokeWidth={2} />
    </div>
    <div class="cloud-title">Cloud Resources</div>
    
    <!-- Overall demand indicator (based on CPU) -->
    {#if !loading}
      <div class="overall-demand" class:poor={demandLevel === 'poor'} 
           class:mediocre={demandLevel === 'mediocre'} 
           class:high={demandLevel === 'high'} 
           class:extreme={demandLevel === 'extreme'}>
        {getDemandLabel(demandLevel)}
      </div>
    {/if}
  </div>
  
  {#if !loading}
    <div class="cloud-metrics">
      <!-- CPU -->
      <div class="cloud-metric">
        <div class="metric-row">
          <div class="metric-label">CPU <span class="unit">(cores)</span></div>
          <div class="metric-value cyan">{formatDecimal(cpu.utilization)}%</div>
        </div>
        <div class="metric-detail">{formatNumber(cpu.used)} / {formatNumber(cpu.total)}</div>
        
        <!-- CPU Comparison -->
        {#if cpuComparison && cpuComparison.change !== undefined}
          <div class="metric-change" class:up={cpuComparison.trend === 'up'} class:down={cpuComparison.trend === 'down'}>
            {#if cpuComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if cpuComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {cpuComparison.change >= 0 ? '+' : ''}{formatDecimal(cpuComparison.change)}%
          </div>
        {/if}
      </div>
      
      <!-- RAM -->
      <div class="cloud-metric">
        <div class="metric-row">
          <div class="metric-label">RAM <span class="unit">(TB)</span></div>
          <div class="metric-value cyan">{formatDecimal(ram.utilization)}%</div>
        </div>
        <div class="metric-detail">{formatDecimal(ram.used)} / {formatDecimal(ram.total)}</div>
        
        <!-- RAM Comparison -->
        {#if ramComparison && ramComparison.change !== undefined}
          <div class="metric-change" class:up={ramComparison.trend === 'up'} class:down={ramComparison.trend === 'down'}>
            {#if ramComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if ramComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {ramComparison.change >= 0 ? '+' : ''}{formatDecimal(ramComparison.change)}%
          </div>
        {/if}
      </div>
      
      <!-- Storage -->
      <div class="cloud-metric">
        <div class="metric-row">
          <div class="metric-label">Storage <span class="unit">(TB)</span></div>
          <div class="metric-value cyan">{formatDecimal(storage.utilization)}%</div>
        </div>
        <div class="metric-detail">{formatNumber(storage.used)} / {formatNumber(storage.total)}</div>
        
        <!-- Storage Comparison -->
        {#if storageComparison && storageComparison.change !== undefined}
          <div class="metric-change" class:up={storageComparison.trend === 'up'} class:down={storageComparison.trend === 'down'}>
            {#if storageComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if storageComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {storageComparison.change >= 0 ? '+' : ''}{formatDecimal(storageComparison.change)}%
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="loading-state">Loading cloud data...</div>
  {/if}
</div>

<style>
  .cloud-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .cloud-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .cloud-card.loading {
    pointer-events: none;
  }
  
  .cloud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .cloud-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }
  
  .cloud-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }
  
  .cloud-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  /* Overall demand indicator */
  .overall-demand {
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.375rem 0.625rem;
    border-radius: var(--radius-sm);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    white-space: nowrap;
  }
  
  .overall-demand.poor {
    color: var(--text-dim);
    background: rgba(139, 146, 176, 0.1);
    border: 1px solid rgba(139, 146, 176, 0.3);
  }
  
  .overall-demand.mediocre {
    color: var(--accent-yellow);
    background: rgba(255, 235, 59, 0.1);
    border: 1px solid rgba(255, 235, 59, 0.3);
  }
  
  .overall-demand.high {
    color: #ff9800;
    background: rgba(255, 152, 0, 0.1);
    border: 1px solid rgba(255, 152, 0, 0.3);
  }
  
  .overall-demand.extreme {
    color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
    animation: pulse-glow 2s ease-in-out infinite;
  }
  
  @keyframes pulse-glow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  .cloud-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
  }
  
  .cloud-metric {
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
  
  .metric-label .unit {
    font-size: 0.6rem;
    opacity: 0.7;
    text-transform: lowercase;
    font-weight: 500;
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
  
  .metric-detail {
    font-size: 0.7rem;
    color: var(--text-dim);
    margin-top: var(--spacing-xs);
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
  
  .loading-state {
    padding: var(--spacing-lg);
    text-align: center;
    color: var(--text-muted);
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .cloud-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
  }
  
  /* Hover Effects */
  .cloud-card:hover .cloud-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
  
  .cloud-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
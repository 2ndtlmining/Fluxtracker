<script>
  import { Gamepad2 } from 'lucide-svelte';
  
  export let minecraft = { count: 0 };
  export let palworld = { count: 0 };
  export let enshrouded = { count: 0 };
  export let total = 0;
  export let loading = false;
  
  // Comparison data (optional)
  export let minecraftComparison = null;    // { change: number, trend: 'up'|'down'|'neutral' }
  export let palworldComparison = null;
  export let enshroudedComparison = null;
  export let totalComparison = null;
  
  // Format numbers
  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }
</script>

<div class="gaming-card terminal-border" class:loading>
  <div class="gaming-header">
    <div class="gaming-icon">
      <Gamepad2 size={24} strokeWidth={2} />
    </div>
    <div class="gaming-title">Gaming Apps</div>
  </div>
  
  {#if !loading}
    <div class="gaming-metrics">
      <!-- Minecraft -->
      <div class="gaming-metric">
        <div class="metric-row">
          <div class="metric-label">Minecraft</div>
          <div class="metric-value cyan">{formatNumber(minecraft.count)}</div>
        </div>
        
        <!-- Minecraft Comparison -->
        {#if minecraftComparison && minecraftComparison.change !== undefined}
          <div class="metric-change" class:up={minecraftComparison.trend === 'up'} class:down={minecraftComparison.trend === 'down'}>
            {#if minecraftComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if minecraftComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {minecraftComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(minecraftComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Palworld -->
      <div class="gaming-metric">
        <div class="metric-row">
          <div class="metric-label">Palworld</div>
          <div class="metric-value cyan">{formatNumber(palworld.count)}</div>
        </div>
        
        <!-- Palworld Comparison -->
        {#if palworldComparison && palworldComparison.change !== undefined}
          <div class="metric-change" class:up={palworldComparison.trend === 'up'} class:down={palworldComparison.trend === 'down'}>
            {#if palworldComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if palworldComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {palworldComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(palworldComparison.change))}
          </div>
        {/if}
      </div>
      
      <!-- Enshrouded -->
      <div class="gaming-metric">
        <div class="metric-row">
          <div class="metric-label">Enshrouded</div>
          <div class="metric-value cyan">{formatNumber(enshrouded.count)}</div>
        </div>
        
        <!-- Enshrouded Comparison -->
        {#if enshroudedComparison && enshroudedComparison.change !== undefined}
          <div class="metric-change" class:up={enshroudedComparison.trend === 'up'} class:down={enshroudedComparison.trend === 'down'}>
            {#if enshroudedComparison.trend === 'up'}
              <span class="trend-arrow">↑</span>
            {:else if enshroudedComparison.trend === 'down'}
              <span class="trend-arrow">↓</span>
            {/if}
            {enshroudedComparison.change >= 0 ? '+' : ''}{formatNumber(Math.abs(enshroudedComparison.change))}
          </div>
        {/if}
      </div>
    </div>
    
    <!-- Total with comparison -->
    <div class="gaming-total">
      <div class="total-label">Total Games</div>
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
    <div class="loading-state">Loading gaming data...</div>
  {/if}
</div>

<style>
  .gaming-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    position: relative;
  }
  
  .gaming-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .gaming-card.loading {
    pointer-events: none;
  }
  
  .gaming-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }
  
  .gaming-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }
  
  .gaming-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }
  
  .gaming-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }
  
  .gaming-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }
  
  .gaming-metric {
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
  .gaming-total {
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
    .gaming-metrics {
      grid-template-columns: 1fr;
      gap: var(--spacing-lg);
    }
    
    .metric-value {
      font-size: 1.5rem;
    }
    
    .gaming-total {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
    }
    
    .total-value {
      font-size: 1.25rem;
    }
  }
  
  /* Hover Effects */
  .gaming-card:hover .gaming-icon :global(svg) {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }
  
  .gaming-card:hover .metric-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .gaming-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>
<script>
  export let icon = '💰';           // Emoji or icon
  export let title = '';            // Card title (e.g., "Daily Revenue")
  export let value = '';            // Main value to display
  export let subtitle = '';         // Optional subtitle
  export let change = '';           // Change percentage (e.g., "+12.5%")
  export let trend = 'neutral';     // 'up', 'down', 'neutral'
  export let valueColor = 'cyan';   // 'cyan', 'green', 'white'
  export let loading = false;       // Loading state
</script>

<div class="stat-card terminal-border" class:loading>
  <!-- Icon -->
  <div class="stat-icon">{icon}</div>
  
  <div class="stat-content">
    <!-- Title -->
    <div class="stat-title">{title}</div>
    
    <!-- Main Value -->
    {#if loading}
      <div class="stat-value loading-shimmer">Loading...</div>
    {:else}
      <div class="stat-value" class:cyan={valueColor === 'cyan'} class:green={valueColor === 'green'}>
        {value}
      </div>
    {/if}
    
    <!-- Subtitle -->
    {#if subtitle}
      <div class="stat-subtitle">{subtitle}</div>
    {/if}
    
    <!-- Change Indicator -->
    {#if change && !loading}
      <div class="stat-change" class:up={trend === 'up'} class:down={trend === 'down'}>
        {#if trend === 'up'}
          <span class="trend-arrow">↑</span>
        {:else if trend === 'down'}
          <span class="trend-arrow">↓</span>
        {/if}
        {change}
      </div>
    {/if}
  </div>
</div>

<style>
  .stat-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    display: flex;
    gap: var(--spacing-md);
    align-items: flex-start;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .stat-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  
  .stat-card.loading {
    pointer-events: none;
  }
  
  /* Icon */
  .stat-icon {
    font-size: 2rem;
    line-height: 1;
    opacity: 0.9;
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }
  
  /* Content */
  .stat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }
  
  .stat-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
  }
  
  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-white);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    transition: all 0.3s ease;
  }
  
  .stat-value.cyan {
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
  }
  
  .stat-value.green {
    color: var(--accent-green);
    text-shadow: var(--glow-green);
  }
  
  .stat-subtitle {
    font-size: 0.875rem;
    color: var(--text-dim);
    font-weight: 500;
  }
  
  /* Change Indicator */
  .stat-change {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    width: fit-content;
  }
  
  .stat-change.up {
    color: var(--accent-green);
    background: rgba(0, 255, 65, 0.1);
    border: 1px solid rgba(0, 255, 65, 0.3);
  }
  
  .stat-change.down {
    color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
  }
  
  .stat-change.neutral {
    color: var(--text-dim);
    background: rgba(139, 146, 176, 0.1);
    border: 1px solid rgba(139, 146, 176, 0.3);
  }
  
  .trend-arrow {
    font-size: 1rem;
    font-weight: 700;
  }
  
  /* Loading State */
  .loading-shimmer {
    background: linear-gradient(
      90deg,
      var(--bg-tertiary) 0%,
      var(--bg-secondary) 50%,
      var(--bg-tertiary) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    color: transparent;
    border-radius: var(--radius-sm);
  }
  
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .stat-card {
      padding: var(--spacing-md);
    }
    
    .stat-icon {
      font-size: 1.5rem;
    }
    
    .stat-value {
      font-size: 1.5rem;
    }
    
    .stat-title {
      font-size: 0.7rem;
    }
  }
  
  /* Hover Effects */
  .stat-card:hover .stat-value.cyan {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
  
  .stat-card:hover .stat-value.green {
    text-shadow: 0 0 15px var(--accent-green), 0 0 25px var(--accent-green);
  }
  
  .stat-card:hover .stat-icon {
    filter: drop-shadow(0 0 15px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
    transition: all 0.3s ease;
  }
</style>
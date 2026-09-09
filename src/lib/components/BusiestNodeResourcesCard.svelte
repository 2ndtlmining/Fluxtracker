<script>
  import { Server } from 'lucide-svelte';
  import { formatUtilizationBar } from '$lib/utils/resourceBar.js';

  export let node = null;           // { ip, tier, country, countryCode, appCount, resources } | null
  export let loading = false;
  export let error = false;

  function formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString();
  }

  function formatDecimal(num, digits = 1) {
    if (!num && num !== 0) return '0';
    return num.toFixed(digits);
  }
</script>

<div class="busiest-node-card terminal-border" class:loading>
  <div class="node-header">
    <div class="node-icon">
      <Server size={24} strokeWidth={2} />
    </div>
    <div class="node-title">Busiest Node</div>
    {#if !loading && node?.tier}
      <span class="tier-badge">{node.tier}</span>
    {/if}
  </div>

  {#if loading}
    <div class="node-empty-state">Loading busiest node...</div>
  {:else if error || !node}
    <div class="node-empty-state">Not available right now</div>
  {:else}
    <div class="node-identity">
      <span class="node-ip">{node.ip}</span>
      {#if node.country}
        <span class="node-location">{node.country}</span>
      {/if}
    </div>

    <div class="node-app-count">
      <span class="count-value">{formatNumber(node.appCount)}</span>
      <span class="count-label">apps running</span>
    </div>

    <div class="node-resources">
      {#each [
        { label: 'CPU', used: node.resources.cpu.used, total: node.resources.cpu.total, unit: 'cores' },
        { label: 'RAM', used: node.resources.ram.used, total: node.resources.ram.total, unit: 'GB' },
        { label: 'SSD', used: node.resources.ssd.used, total: node.resources.ssd.total, unit: 'GB' }
      ] as resource}
        {@const util = formatUtilizationBar(resource.used, resource.total)}
        <div class="resource-row">
          <div class="resource-heading">
            <span class="resource-label">{resource.label}</span>
            <span class="resource-percent">{util.percent}%</span>
          </div>
          <div class="resource-bar" aria-hidden="true">{util.bar}</div>
          <div class="resource-detail">{formatDecimal(resource.used)} / {formatDecimal(resource.total)} {resource.unit}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .busiest-node-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
  }

  .busiest-node-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .busiest-node-card.loading {
    pointer-events: none;
  }

  .node-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .node-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }

  .node-icon :global(svg) {
    color: var(--text-primary);
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

  .tier-badge {
    font-size: 0.65rem;
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0.15rem 0.5rem;
    letter-spacing: 0.5px;
  }

  .node-empty-state {
    padding: var(--spacing-lg) 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .node-identity {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .node-ip {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-white);
    font-variant-numeric: tabular-nums;
  }

  .node-location {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .node-app-count {
    display: flex;
    align-items: baseline;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
  }

  .count-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .count-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .node-resources {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
  }

  .resource-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .resource-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .resource-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .resource-percent {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .resource-bar {
    font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
    font-size: 0.75rem;
    letter-spacing: -1px;
    color: var(--text-primary);
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.35);
    line-height: 1;
  }

  .resource-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>

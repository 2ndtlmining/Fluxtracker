<script>
  import { Server } from 'lucide-svelte';

  export let node = null;           // { ip, tier, country, countryCode, appCount, appNames, resources } | null
  export let loading = false;
  export let error = false;

  const MAX_VISIBLE_NAMES = 6;

  $: visibleNames = node?.appNames?.slice(0, MAX_VISIBLE_NAMES) || [];
  $: hiddenNameCount = Math.max(0, (node?.appNames?.length || 0) - MAX_VISIBLE_NAMES);
  $: unresolvedCount = node ? node.appCount - (node.appNames?.length || 0) : 0;

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
      <div class="resource-row">
        <span class="resource-label">CPU</span>
        <span class="resource-detail">{formatDecimal(node.resources.cpu.used)} / {formatDecimal(node.resources.cpu.total)} cores</span>
      </div>
      <div class="resource-row">
        <span class="resource-label">RAM</span>
        <span class="resource-detail">{formatDecimal(node.resources.ram.used)} / {formatDecimal(node.resources.ram.total)} GB</span>
      </div>
      <div class="resource-row">
        <span class="resource-label">SSD</span>
        <span class="resource-detail">{formatDecimal(node.resources.ssd.used, 0)} / {formatDecimal(node.resources.ssd.total, 0)} GB</span>
      </div>
    </div>

    {#if visibleNames.length > 0}
      <div class="node-app-names">
        {#each visibleNames as name}
          <span class="app-name-pill">{name}</span>
        {/each}
        {#if hiddenNameCount > 0}
          <span class="app-name-more">+{hiddenNameCount} more</span>
        {/if}
      </div>
    {/if}
    {#if unresolvedCount > 0}
      <div class="node-unresolved-note">
        {unresolvedCount} {unresolvedCount === 1 ? 'app' : 'apps'} not yet identifiable
      </div>
    {/if}
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
    gap: 0.375rem;
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
    margin-bottom: var(--spacing-md);
  }

  .resource-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.8rem;
  }

  .resource-label {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.7rem;
  }

  .resource-detail {
    color: var(--text-white);
    font-variant-numeric: tabular-nums;
  }

  .node-app-names {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
  }

  .app-name-pill {
    font-size: 0.7rem;
    color: var(--text-primary);
    background: rgba(0, 255, 255, 0.08);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: var(--radius-sm);
    padding: 0.15rem 0.5rem;
  }

  .app-name-more {
    font-size: 0.7rem;
    color: var(--text-muted);
    padding: 0.15rem 0.25rem;
  }

  .node-unresolved-note {
    margin-top: var(--spacing-xs);
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>

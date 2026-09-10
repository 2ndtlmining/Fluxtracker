<script>
  import { Server } from 'lucide-svelte';
  import { computeUtilizationPercent, formatAsciiBar } from '$lib/utils/resourceBar.js';

  export let node = null;           // { ip, tier, country, countryCode, appCount, appNames, resources } | null
  export let loading = false;
  export let error = false;

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
      <span class="node-app-count">{formatNumber(node.appCount)} apps running</span>
    </div>

    <div class="node-resources">
      {#each [
        { label: 'CPU', used: node.resources.cpu.used, total: node.resources.cpu.total, unit: 'cores' },
        { label: 'RAM', used: node.resources.ram.used, total: node.resources.ram.total, unit: 'GB' },
        { label: 'SSD', used: node.resources.ssd.used, total: node.resources.ssd.total, unit: 'GB' }
      ] as resource}
        {@const percent = computeUtilizationPercent(resource.used, resource.total)}
        <div class="resource-row">
          <div class="resource-heading">
            <span class="resource-label">{resource.label}</span>
            <span class="resource-percent">{Math.round(percent)}%</span>
          </div>
          <div class="resource-bar">{formatAsciiBar(percent, 10)}</div>
          <div class="resource-detail">{formatDecimal(resource.used)} / {formatDecimal(resource.total)} {resource.unit}</div>
        </div>
      {/each}
    </div>

    <div class="node-apps">
      {#if node.appNames && node.appNames.length > 0}
        <div class="node-apps-list">
          {#each node.appNames as name}
            <span class="app-name-pill">{name}</span>
          {/each}
        </div>
        {#if unresolvedCount > 0}
          <div class="node-unresolved-note">
            {unresolvedCount} {unresolvedCount === 1 ? 'app' : 'apps'} not yet identifiable
          </div>
        {/if}
      {:else}
        <div class="node-apps-empty">No identifiable apps on this node</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .busiest-node-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
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
    margin-bottom: var(--spacing-md);
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
    font-size: 0.75rem;
    color: var(--text-primary);
    margin-left: auto;
    font-weight: 600;
  }

  /* Side-by-side CPU/RAM/SSD columns (issue #149) -- stacking them as three full-width
     rows cost 9 lines of vertical space the card's width was mostly idle for. Falls back
     to a stacked single column via the container query below if the card ever gets
     squeezed down near the stats-grid-wide minmax(200px, 1fr) floor. */
  .node-resources {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-sm) var(--spacing-md);
    padding-top: var(--spacing-sm);
    padding-bottom: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  @container (max-width: 260px) {
    .node-resources {
      grid-template-columns: 1fr;
    }
  }

  .resource-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
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
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 1px;
    color: var(--text-primary);
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.4);
    white-space: pre;
  }

  .resource-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .node-apps {
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
  }

  .node-apps-empty {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding: var(--spacing-sm) 0;
  }

  .node-apps-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    max-height: 6.5rem;
    overflow-y: auto;
  }

  .app-name-pill {
    font-size: 0.75rem;
    color: var(--text-primary);
    background: rgba(0, 255, 255, 0.08);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.6rem;
  }

  .node-unresolved-note {
    margin-top: var(--spacing-sm);
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>

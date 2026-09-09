<script>
  import { Globe } from 'lucide-svelte';
  import { formatAsciiBar } from '$lib/utils/resourceBar.js';

  // { totalNodes, classifiedCount, datacenterCount, datacenterPercent, coveragePercent,
  //   topDatacenters: [{org, count, percent}], otherProviderCount, updatedAt } | null
  export let stats = null;
  export let loading = false;
  export let error = false;

  $: hasData = stats && stats.classifiedCount > 0;
  $: hasDatacenters = hasData && stats.topDatacenters && stats.topDatacenters.length > 0;

  function formatNumber(num) {
    if (!num && num !== 0) return '0';
    return num.toLocaleString();
  }

  function formatPercent(num) {
    if (num === null || num === undefined) return '--';
    return `${num.toFixed(1)}%`;
  }
</script>

<div class="decentralization-card terminal-border" class:loading>
  <div class="card-header">
    <div class="card-icon"><Globe size={24} strokeWidth={2} /></div>
    <div class="card-title">Decentralization</div>
  </div>

  {#if loading}
    <div class="card-empty-state">Loading decentralization data...</div>
  {:else if error || !stats}
    <div class="card-empty-state">Not available right now</div>
  {:else if !hasData}
    <!-- Classification runs gradually in the background (issue #108) -- there's
         genuinely nothing to show yet on a fresh deploy, not a fetch failure. -->
    <div class="card-empty-state">
      Classifying node IPs...<br />
      <span class="empty-sub">Coverage builds up over the next few hours</span>
    </div>
  {:else}
    <div class="metric-row">
      <div class="metric-heading">
        <span class="metric-label">In known datacenters</span>
        <span class="metric-value">{formatPercent(stats.datacenterPercent)}</span>
      </div>
      <div class="ascii-bar">{formatAsciiBar(stats.datacenterPercent)}</div>
      <div class="metric-detail">{formatNumber(stats.datacenterCount)} of {formatNumber(stats.classifiedCount)} classified nodes</div>
    </div>

    <div class="coverage-row">
      <div class="metric-heading">
        <span class="metric-label">Coverage</span>
        <span class="metric-value">{formatPercent(stats.coveragePercent)}</span>
      </div>
      <div class="ascii-bar">{formatAsciiBar(stats.coveragePercent)}</div>
      <div class="metric-detail">{formatNumber(stats.classifiedCount)} of {formatNumber(stats.totalNodes)} nodes classified so far</div>
    </div>

    <div class="datacenters-section">
      <div class="section-label">Top datacenters</div>
      {#if hasDatacenters}
        <div class="datacenters-list">
          {#each stats.topDatacenters as dc}
            <div class="datacenter-row">
              <span class="datacenter-org" title={dc.org}>{dc.org}</span>
              <span class="datacenter-count">{formatNumber(dc.count)}</span>
              <span class="datacenter-percent">{formatPercent(dc.percent)}</span>
            </div>
          {/each}
        </div>
        {#if stats.otherProviderCount > 0}
          <div class="other-providers-note">+{stats.otherProviderCount} more {stats.otherProviderCount === 1 ? 'provider' : 'providers'}</div>
        {/if}
      {:else}
        <div class="datacenters-empty">None classified yet</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .decentralization-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
  }

  .decentralization-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .decentralization-card.loading {
    pointer-events: none;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }

  .card-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }

  .card-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }

  .card-empty-state {
    padding: var(--spacing-lg) 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
    line-height: 1.6;
  }

  .empty-sub {
    font-size: 0.7rem;
    font-style: italic;
  }

  .metric-row {
    margin-bottom: var(--spacing-md);
  }

  .coverage-row {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .metric-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 0.25rem;
  }

  .metric-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .metric-value {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* ASCII bar -- a real text character (not a CSS div fill), so it inherits the
     terminal theme's glow like every other row in the header/cards. */
  .ascii-bar {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    letter-spacing: 1px;
    color: var(--text-primary);
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.4);
    white-space: pre;
    margin-bottom: 0.25rem;
  }

  .metric-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .datacenters-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .section-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .datacenters-empty {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .datacenters-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .datacenter-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .datacenter-org {
    flex: 1;
    min-width: 0;
    color: var(--text-white);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .datacenter-count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .datacenter-percent {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 3.2em;
    text-align: right;
  }

  .other-providers-note {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>

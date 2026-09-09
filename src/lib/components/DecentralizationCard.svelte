<script>
  import { Globe } from 'lucide-svelte';

  // { totalNodes, classifiedCount, datacenterCount, datacenterPercent, coveragePercent, updatedAt } | null
  export let stats = null;
  export let loading = false;
  export let error = false;

  $: hasData = stats && stats.classifiedCount > 0;

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
      <div class="metric-value cyan">{formatPercent(stats.datacenterPercent)}</div>
      <div class="metric-label">in known datacenters</div>
    </div>

    <div class="metric-detail">
      {formatNumber(stats.datacenterCount)} of {formatNumber(stats.classifiedCount)} classified nodes
    </div>

    <div class="coverage-row">
      <div class="coverage-heading">
        <span class="coverage-label">Coverage</span>
        <span class="coverage-percent">{formatPercent(stats.coveragePercent)}</span>
      </div>
      <div class="coverage-track">
        <div class="coverage-fill" style="width: {stats.coveragePercent}%"></div>
      </div>
      <div class="coverage-detail">
        {formatNumber(stats.classifiedCount)} of {formatNumber(stats.totalNodes)} nodes classified so far
      </div>
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
    margin-bottom: var(--spacing-xs);
  }

  .metric-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-white);
    line-height: 1.1;
  }

  .metric-value.cyan {
    color: var(--text-primary);
    text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
  }

  .metric-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .metric-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--border-color);
  }

  .coverage-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .coverage-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .coverage-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .coverage-percent {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .coverage-track {
    height: 6px;
    border-radius: 3px;
    background: rgba(139, 146, 176, 0.15);
    overflow: hidden;
  }

  .coverage-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--text-primary);
    box-shadow: 0 0 6px rgba(0, 255, 255, 0.5);
    transition: width 0.4s ease;
  }

  .coverage-detail {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
</style>

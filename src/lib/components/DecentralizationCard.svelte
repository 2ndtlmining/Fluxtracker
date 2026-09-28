<script>
  import { Globe, Info } from '@lucide/svelte';
  import { formatAsciiBar } from '$lib/utils/resourceBar.js';
  import { onMount } from 'svelte';
  import { getApiUrl } from '$lib/config.js';
  import { demandLevel, DEMAND_LEVELS } from '$lib/utils/demandLevel.js';

  // { totalNodes, classifiedCount, datacenterCount, datacenterPercent, coveragePercent,
  //   topDatacenters: [{org, count, percent}], otherProviderCount, updatedAt } | null
  export let stats = null;
  export let loading = false;
  export let error = false;
  export let comparison = null; // { change: number, trend: 'up'|'down'|'neutral' } | null

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

  // Demand vs supply (issue #268): the card's DEFAULT view (owner request, 2026-09-26),
  // fetched on mount and again when reopened after 10 minutes (both inputs refresh hourly).
  let view = 'demand';
  let demand = null;          // /api/decentralization/demand response
  let demandError = false;
  let demandLoading = false;
  let demandFetchedAt = 0;

  async function showView(next) {
    view = next;
    if (next !== 'demand' || demandLoading || Date.now() - demandFetchedAt < 10 * 60_000) return;
    demandLoading = true;
    try {
      const response = await fetch(`${getApiUrl()}/api/decentralization/demand`);
      const data = response.ok ? await response.json() : null;
      demand = data?.available ? data : null;
      demandError = !demand;
      demandFetchedAt = demand ? Date.now() : 0;
    } catch (err) {
      console.error('Error fetching demand vs supply:', err);
      demandError = true;
    } finally {
      demandLoading = false;
    }
  }

  onMount(() => { showView('demand'); });

  // Coverage moved off the card and into the header's "geo" counter (issue #120) --
  // this tooltip is what's left to explain the number where a reader might expect it.
  $: coverageTooltip = hasData
    ? `Share of Flux nodes hosted in a datacenter, per node (several nodes on one IP each count). ` +
      `Datacenter = the node's own hosting flag in Flux's node list, plus a short list of known hosting providers. ` +
      `${formatNumber(stats.classifiedCount)} of ${formatNumber(stats.totalNodes)} nodes carry hosting data (${formatPercent(stats.coveragePercent)}); the rest are left out.`
    : '';
</script>

<div class="decentralization-card terminal-border" class:loading>
  <div class="card-header">
    <div class="card-icon"><Globe size={24} strokeWidth={2} /></div>
    <!-- #456: the title names the view -- demand by location is the default, and the
         datacenter share is what "Decentralization" means. -->
    <div class="card-title">{view === 'datacenters' ? 'Decentralization' : 'Geolocation Demand'}</div>
    {#if !loading}
      <div class="view-switch" role="group" aria-label="Decentralization view">
        <button type="button" class:active={view === 'demand'} aria-pressed={view === 'demand'} on:click={() => showView('demand')}>Demand</button>
        <button type="button" class:active={view === 'datacenters'} aria-pressed={view === 'datacenters'} on:click={() => showView('datacenters')}>Datacenters</button>
      </div>
    {/if}
  </div>

  {#if !loading && view === 'demand'}
    {#if demandLoading && !demand}
      <div class="card-empty-state">Loading CPU by continent...</div>
    {:else if demandError || !demand}
      <div class="card-empty-state">Not available right now</div>
    {:else}
      <!-- Issue #463: demand vs supply in CPU cores, not app and node counts. -->
      <div class="datacenters-section">
        <div class="section-label">CPU by continent</div>
        <div class="demand-row demand-head">
          <span class="datacenter-org">Continent</span>
          <!-- Owner's headings: Resource | Demand | Used. The hovers say what each is a share of. -->
          <span class="demand-col" title="Resource: this continent's share of all CPU cores on the network, used or not">Resource</span>
          <span class="demand-col" title="Demand: this continent's share of all the CPU apps are using on the network">Demand</span>
          <span class="demand-col" title="Used: how much of this continent's own CPU apps are using">Used</span>
        </div>
        <div class="datacenters-list">
          {#each demand.continents as c (c.code)}
            {@const level = demandLevel(c.inUsePercent)}
            <div class="demand-row" title="{c.name}: {formatPercent(c.capacityPercent)} of the network's CPU and {formatPercent(c.demandPercent)} of its load. {formatNumber(c.lockedCores)} of {formatNumber(c.cores)} cores in use there ({formatPercent(c.inUsePercent)}){level ? ` -- ${level.label.toLowerCase()}` : ''}">
              <span class="datacenter-org">{c.name}</span>
              <span class="demand-col">{formatPercent(c.capacityPercent)}</span>
              <span class="demand-col">{formatPercent(c.demandPercent)}</span>
              <span class="demand-col demand-value level-{level?.key ?? 'none'}">{formatPercent(c.inUsePercent)}</span>
            </div>
          {/each}
        </div>
        <!-- #463: coloured by how full each continent is, on the Cloud Resources levels (#445). -->
        <div class="other-providers-note">
          Network: {formatPercent(demand.networkInUsePercent)} of CPU used.
          Used: {#each DEMAND_LEVELS as l, i}<span class="level-{l.key}">{l.short}</span>{i < DEMAND_LEVELS.length - 1 ? ' · ' : ''}{/each}
        </div>
      </div>
    {/if}
  {:else if loading}
    <div class="card-empty-state">Loading decentralization data...</div>
  {:else if error || !stats}
    <div class="card-empty-state">Not available right now</div>
  {:else if !hasData}
    <!-- The node list has not been fetched yet (a fresh start) -- not a fetch failure. -->
    <div class="card-empty-state">
      Loading the node list...<br />
      <span class="empty-sub">Ready within a few minutes of a restart</span>
    </div>
  {:else}
    <div class="metric-row">
      <div class="metric-heading">
        <span class="metric-label-group">
          <span class="metric-label">Nodes in datacenters</span>
          <span class="info-icon" title={coverageTooltip} tabindex="0" role="img" aria-label={coverageTooltip}>
            <Info size={12} strokeWidth={2} />
          </span>
        </span>
        <span class="metric-value-group">
          <span class="metric-value">{formatPercent(stats.datacenterPercent)}</span>
          {#if comparison}
            <span class="metric-trend" class:up={comparison.trend === 'up'} class:down={comparison.trend === 'down'} class:neutral={comparison.trend === 'neutral'}>
              {#if comparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if comparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
              {comparison.change >= 0 ? '+' : ''}{comparison.change.toFixed(1)}%
            </span>
          {/if}
        </span>
      </div>
      <div class="ascii-bar">{formatAsciiBar(stats.datacenterPercent)}</div>
      <div class="metric-detail">{formatNumber(stats.datacenterCount)} of {formatNumber(stats.classifiedCount)} classified nodes</div>
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
    flex-wrap: wrap; /* the view switch drops to its own line on a narrow card (#268) */
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

  .metric-label-group {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  /* Coverage info icon (issue #120): the coverage number itself moved to the header's
     "geo" counter -- this is what's left on the card to explain the percentage. */
  .info-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
    cursor: help;
  }

  .info-icon:hover,
  .info-icon:focus-visible {
    color: var(--text-primary);
  }

  .metric-value {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .metric-value-group {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  /* Comparison indicator (mirrors CloudCard.svelte's .metric-change) */
  .metric-trend {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    width: fit-content;
  }

  .metric-trend.up {
    color: var(--accent-green);
    background: rgba(0, 255, 65, 0.1);
    border: 1px solid rgba(0, 255, 65, 0.3);
  }

  .metric-trend.down {
    color: var(--accent-red);
    background: rgba(255, 68, 68, 0.1);
    border: 1px solid rgba(255, 68, 68, 0.3);
  }

  .metric-trend.neutral {
    color: var(--text-dim);
    background: rgba(139, 146, 176, 0.1);
    border: 1px solid rgba(139, 146, 176, 0.3);
  }

  .metric-trend .trend-arrow {
    font-size: 0.875rem;
    font-weight: 700;
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
    /* Issue #120: fill the vertical space CSS Grid's default align-items: stretch already
       gives this card in .stats-grid-wide (stretched to match Busiest Node's height) now
       that the coverage-row above it is gone. CSS-only -- no ResizeObserver/JS measurement,
       see TOP_DATACENTERS_LIMIT in decentralizationService.js for the paired row-count bump. */
    flex: 1;
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

  /* Issue #268: the Datacenters / Demand switch. Small text buttons so the header keeps its
     height; overrides app.css's global button fill and lift. */
  .view-switch {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  .view-switch button {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    box-shadow: none;
    transform: none;
  }

  .view-switch button:hover,
  .view-switch button:focus-visible {
    background: transparent;
    color: var(--text-white);
    border-color: var(--accent-cyan);
    box-shadow: none;
    transform: none;
  }

  .view-switch button.active {
    color: var(--text-primary);
    border-color: var(--accent-cyan);
  }

  .demand-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .demand-head {
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .demand-head .datacenter-org {
    color: var(--text-muted);
  }

  .demand-col {
    min-width: 3.6em;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }

  .demand-value {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* Demand levels (#445, #463): the Cloud Resources badge colours. */
  .level-low { color: var(--text-dim); }
  .level-moderate { color: var(--accent-yellow); }
  .level-high { color: #ff9800; }
  .level-very-high { color: var(--accent-red); }
  .other-providers-note [class^='level-'] { font-style: normal; }

  .other-providers-note {
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>

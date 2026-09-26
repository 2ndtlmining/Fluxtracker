<script>
  import { Package, Gamepad2 } from 'lucide-svelte';
  import { formatCount } from '$lib/utils/format.js';

  // Total app instance count is unaffected by the FluxOS v8.18 change (see issue #106) --
  // it comes from the running-apps census, not per-app image resolution.
  export let totalApps = 0;
  export let totalComparison = null; // { change: number, trend: 'up'|'down'|'neutral' } | null

  // Deployment fill (issue #200): how many of the deployments app owners ORDERED are running.
  // { available, ordered, running, missing, fillPct, containers, appsShort } | null.
  //
  // This leads the card because it is the one figure that moves when the app layer is
  // unhealthy -- when there is no capacity, when nodes go down, when a deploy is failing.
  // The container count stays, relabelled: it is the honest measure of actual workload, and
  // the gap between it and deployments IS the compose factor, so the two are not redundant.
  //
  // null, or available:false, falls back to leading with the container count -- an empty
  // specs cache is a failed fetch, not a network running nothing, and 0% would read as a
  // total outage.
  export let fill = null;
  $: hasFill = fill && fill.available && typeof fill.fillPct === 'number';

  // New/updated + expiring today (issue #108 follow-up) -- deduped counts from
  // carouselService.getFluxCloudActivity(), the same function the KPI report and the
  // daily snapshot collector use. null means "not available" (an uncached on-demand
  // fetch failure), never a fabricated 0.
  //
  // Labeled "New/Updated" rather than "Deployed" (issue #130): the underlying data is
  // globalappsspecifications filtered by spec height within the last 24h, which bumps
  // on ANY spec change -- a resource resize or redeploy of an existing app gets the same
  // fresh height as a genuinely new deployment, so this count is never purely "new".
  export let deployedToday = null;
  // Issue #400: of today's deployments, brand-new apps vs renewals/updates of running ones.
  // Both null when the split is unknown -- then only the total is shown.
  export let deployedNew = null;
  export let deployedUpdated = null;
  export let deployedComparison = null;
  export let expiringToday = null;
  export let expiringComparison = null;

  // Gaming breakdown (issue #163). Games are a SUBSET of the instances counted above, not a
  // separate category -- which is why they live in this card rather than a fourth one.
  //
  // Counts come from /api/games/live, which identifies games by app name as well as image;
  // the image alone misses most FiveM and Valheim instances (encrypted specs carry no
  // repotag). `previousInstances` is undefined until game_snapshots has history, and an
  // undefined previous renders no arrow rather than a fabricated 0%.
  export let gamingTotal = null;
  export let gamingPrevious = null;
  export let topGames = [];
  // Issue #265: $ paid for game servers over the last 30 days ({ usd } from
  // /api/games/revenue). Null before migration 024 or on a failed read: no line shown.
  export let gameRevenue = null;

  export let loading = false;

  $: gamingComparison = toComparison(gamingTotal, gamingPrevious);

  /**
   * Percentage change between two readings, or null when there is nothing to compare.
   * Returns null for a missing previous reading AND for a previous of 0 -- "up from zero"
   * has no meaningful percentage, and rendering +Infinity% or +100% would both mislead.
   */
  function toComparison(current, previous) {
    if (current === null || current === undefined) return null;
    if (previous === null || previous === undefined || previous === 0) return null;
    const change = ((current - previous) / previous) * 100;
    return {
      change,
      trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
    };
  }

  function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    return num.toLocaleString();
  }

  function formatChange(comparison) {
    return `${comparison.change >= 0 ? '+' : ''}${comparison.change.toFixed(1)}%`;
  }
</script>

<div class="app-instances-card terminal-border" class:loading>
  <div class="card-header">
    <div class="card-icon"><Package size={24} strokeWidth={2} /></div>
    <div class="card-title">Apps</div>
  </div>

  {#if loading}
    <div class="card-empty-state">Loading...</div>
  {:else}
    <div class="headline-row">
      <div class="total-block">
        {#if hasFill}
          <!-- The percentage and the pair it comes from are ONE statement, so they sit
               tight together; the container count is a separate fact and gets air above it.
               Four evenly spaced lines read as an undifferentiated wall of numbers. -->
          <div class="fill-group">
            <div class="total-value">{fill.fillPct.toFixed(1)}%</div>
            <div class="total-subtitle">{formatNumber(fill.running)} of {formatNumber(fill.ordered)} ordered</div>
          </div>
          <!-- The trend arrow tracks the container count, so it sits ON that line. Floating
               below the block it looked like it applied to the fill percentage, which it
               does not -- nothing snapshots fill yet. -->
          <div class="container-row">
            <span
              class="container-line"
              title="A compose app runs one container per component, so the network runs more containers than deployments."
            >{formatNumber(fill.containers ?? totalApps)} containers</span>
            {#if totalComparison && totalComparison.change !== undefined}
              <span class="metric-change" class:up={totalComparison.trend === 'up'} class:down={totalComparison.trend === 'down'} class:neutral={totalComparison.trend === 'neutral'}>
                {#if totalComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if totalComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
                {formatChange(totalComparison)}
              </span>
            {/if}
          </div>
        {:else}
          <div class="fill-group">
            <div class="total-value">{formatNumber(totalApps)}</div>
            <div class="total-subtitle">containers across the network</div>
          </div>
          {#if totalComparison && totalComparison.change !== undefined}
            <div class="metric-change" class:up={totalComparison.trend === 'up'} class:down={totalComparison.trend === 'down'} class:neutral={totalComparison.trend === 'neutral'}>
              {#if totalComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if totalComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
              {formatChange(totalComparison)}
            </div>
          {/if}
        {/if}
      </div>

      <div class="activity-stack">
        <div class="activity-metric">
          <div class="activity-label">New/Updated Today</div>
          <div class="activity-value">{formatNumber(deployedToday)}</div>
          {#if deployedNew != null && deployedUpdated != null}
            <div class="activity-split" title="New: apps registered for the first time. Renewed: apps already running that were extended or changed.">
              {formatNumber(deployedNew)} new · {formatNumber(deployedUpdated)} renewed
            </div>
          {/if}
          {#if deployedComparison && deployedComparison.change !== undefined}
            <div class="metric-change" class:up={deployedComparison.trend === 'up'} class:down={deployedComparison.trend === 'down'} class:neutral={deployedComparison.trend === 'neutral'}>
              {#if deployedComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if deployedComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
              {formatChange(deployedComparison)}
            </div>
          {/if}
        </div>

        <div class="activity-metric">
          <div class="activity-label">Expiring Today</div>
          <div class="activity-value">{formatNumber(expiringToday)}</div>
          {#if expiringComparison && expiringComparison.change !== undefined}
            <div class="metric-change" class:up={expiringComparison.trend === 'up'} class:down={expiringComparison.trend === 'down'} class:neutral={expiringComparison.trend === 'neutral'}>
              {#if expiringComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if expiringComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
              {formatChange(expiringComparison)}
            </div>
          {/if}
        </div>
      </div>
    </div>

    {#if gamingTotal !== null}
      <div class="gaming-section">
        <div class="gaming-header">
          <div class="gaming-icon"><Gamepad2 size={16} strokeWidth={2} /></div>
          <div class="gaming-label">Gaming</div>
          {#if gamingComparison}
            <div class="metric-change compact" class:up={gamingComparison.trend === 'up'} class:down={gamingComparison.trend === 'down'} class:neutral={gamingComparison.trend === 'neutral'}>
              {#if gamingComparison.trend === 'up'}<span class="trend-arrow">↑</span>{:else if gamingComparison.trend === 'down'}<span class="trend-arrow">↓</span>{/if}
              {formatChange(gamingComparison)}
            </div>
          {/if}
          <div class="gaming-total">{formatNumber(gamingTotal)}</div>
        </div>

        {#if topGames.length > 0}
          <ul class="game-list">
            {#each topGames as game}
              {@const cmp = toComparison(game.instances, game.previousInstances)}
              <li class="game-row">
                <span class="game-name" title={game.name}>{game.name}</span>
                <span class="game-count">{formatNumber(game.instances)}</span>
                <span class="game-trend" class:up={cmp?.trend === 'up'} class:down={cmp?.trend === 'down'}>
                  {#if cmp?.trend === 'up'}↑{:else if cmp?.trend === 'down'}↓{/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if gameRevenue}
          <div class="game-revenue" title="Payments for game servers over the last 30 days, recognised by the game sites' app names or, for servers deployed by hand, the game image. Private (encrypted) apps count only with a game-site name. USD at the price on the day of each payment.">
            <span class="game-revenue-label">Game revenue</span>
            <span class="game-revenue-value">${formatCount(gameRevenue.usd)}</span>
            <span class="game-revenue-note">last 30 days</span>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .app-instances-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
  }

  .app-instances-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .app-instances-card.loading {
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
  }

  /* Two sections, not three: the headline total and today's activity read as one block
     about app instances, with gaming below the rule as the only real subdivision. The
     activity figures sit beside the total rather than under it, using the width the big
     number leaves free instead of costing another row of height. */
  .headline-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--spacing-lg);
    /* No border-bottom: .gaming-section already draws a border-top, and carrying one here
       too rendered two rules 32px apart with dead space between them. One divider, because
       there is now exactly one division in this card. */
  }

  .total-block {
    display: flex;
    flex-direction: column;
    /* Spacing is set per group below rather than evenly here: the two groups need
       different amounts of air, which one uniform gap cannot express. */
    gap: var(--spacing-sm);
    min-width: 0;
  }

  /* Percentage + the pair it comes from: one statement, so almost no gap. */
  .fill-group {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .container-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
    min-width: 0;
  }

  /* Stacked, so both labels get a full line and neither has to wrap or truncate --
     "New/Updated Today" does not fit beside "Expiring Today" at this card width. */
  .activity-split {
    font-size: 0.7rem;
    color: var(--text-dim);
    white-space: nowrap;
  }

  .activity-stack {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    flex-shrink: 0;
  }

  .total-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .total-subtitle {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-weight: 500;
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    /* Deliberately allowed to wrap. nowrap here clipped "6,948 of 8,271 ordered" at narrow
       card widths -- losing the figures the headline percentage is derived from. Two lines
       beat a truncated one. */
  }

  /* The container count keeps its place but stops competing with the fill headline:
     smaller, dimmer, and a step down from the "of ordered" line above it. */
  .container-line {
    font-size: 0.75rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    cursor: help;
    white-space: nowrap;
  }

  .activity-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .activity-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .activity-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-white);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  /* Gaming breakdown (issue #163). A subsection of this card, not a card of its own: games
     are a subset of the instances above. Set apart by a rule and a smaller type scale so it
     reads as detail under the headline rather than as a competing metric. */
  .gaming-section {
    margin-top: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
  }

  .gaming-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    /* Reserves the same trailing width the game rows give their trend column, so the total
       and the per-game counts right-align on one axis instead of two. */
    padding-right: calc(0.75rem + var(--spacing-sm));
  }

  .gaming-icon {
    display: flex;
    align-items: center;
    color: var(--accent-purple);
  }

  .gaming-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    /* Takes the slack so the total sits hard right, aligned with the counts below it. */
    flex: 1;
    min-width: 0;
  }

  .gaming-total {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-white);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .game-list {
    list-style: none;
    margin: var(--spacing-sm) 0 0;
    padding: 0;
  }

  .game-row {
    display: grid;
    /* Fixed trailing columns keep every count right-aligned on the same axis regardless of
       name length; min-width:0 on the name is what lets the ellipsis actually engage. */
    grid-template-columns: 1fr auto 0.75rem;
    align-items: baseline;
    gap: var(--spacing-sm);
    padding: 2px 0;
  }

  .game-name {
    font-size: 0.8rem;
    color: var(--text-dim);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .game-count {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* Arrow only -- the per-game percentage would be four more numbers competing with the
     counts. An empty cell holds the column when there is no reading to compare against. */
  .game-trend {
    font-size: 0.7rem;
    text-align: right;
    color: transparent;
  }

  /* Issue #265. One row under the top games: label, value, window -- wraps on a narrow
     card rather than squeezing the value. */
  .game-revenue {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: var(--spacing-xs);
    padding-top: 0.2rem;
    border-top: 1px dashed var(--border-color);
    font-size: 0.8rem;
    line-height: 1.3;
  }

  .game-revenue-label {
    color: var(--text-dim);
    margin-right: auto;
  }

  .game-revenue-value {
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .game-revenue-note {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .game-trend.up { color: var(--accent-green); }
  .game-trend.down { color: var(--accent-red); }

  .metric-change.compact {
    padding: 0.1rem 0.35rem;
    font-size: 0.7rem;
  }

  /* Comparison indicator (mirrors CloudCard.svelte's .metric-change) */
  .metric-change {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    width: fit-content;
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

  @media (max-width: 768px) {
    /* The card goes full-width in a single column here, but the two blocks still fit side
       by side at phone width -- wrap rather than stack unconditionally, so the layout only
       breaks apart when it actually has to. */
    .headline-row {
      flex-wrap: wrap;
      gap: var(--spacing-md);
    }

    .total-value {
      font-size: 1.5rem;
    }
  }

  .app-instances-card:hover .total-value {
    text-shadow: 0 0 15px var(--text-primary), 0 0 25px var(--text-primary);
  }
</style>

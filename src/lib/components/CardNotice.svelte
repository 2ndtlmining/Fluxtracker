<script>
  // Shared failure state for the dashboard cards (issue #319). Two shapes:
  //  - 'unavailable': the card has nothing real to show -- rendered INSTEAD of the metrics,
  //    so a failed load never reads as a genuine zero.
  //  - 'stale': the card is showing an older reading because a refresh failed -- rendered
  //    under the metrics as a one-line note.
  import { formatClockTime } from '$lib/utils/fetchJson.js';

  export let kind = 'unavailable'; // 'unavailable' | 'stale'
  export let updatedAt = null;     // ms of the last good load, for the stale note
  export let onRetry = null;       // optional: shows a Retry button

  $: since = formatClockTime(updatedAt);
</script>

{#if kind === 'unavailable'}
  <div class="card-notice unavailable" role="status">
    <span class="notice-text">Couldn't load right now</span>
    {#if onRetry}
      <button type="button" class="retry" on:click={onRetry}>Retry</button>
    {/if}
  </div>
{:else}
  <div class="card-notice stale" role="status">
    <span class="notice-text">
      Couldn't refresh{#if since} — showing data from {since}{:else} — showing older data{/if}
    </span>
    {#if onRetry}
      <button type="button" class="retry" on:click={onRetry}>Retry</button>
    {/if}
  </div>
{/if}

<style>
  .card-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--spacing-sm);
    color: var(--text-dim);
    font-size: 0.75rem;
  }

  .card-notice.unavailable {
    padding: var(--spacing-lg);
    font-size: 0.85rem;
  }

  .card-notice.stale {
    margin-top: var(--spacing-sm);
    color: var(--accent-yellow);
  }

  .retry {
    background: transparent;
    border: 1px solid var(--border-color, #2a3447);
    color: var(--accent-cyan, #00ffff);
    font: inherit;
    font-size: 0.75rem;
    padding: 2px 10px;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
  }

  .retry:hover,
  .retry:focus-visible {
    border-color: var(--accent-cyan, #00ffff);
  }
</style>

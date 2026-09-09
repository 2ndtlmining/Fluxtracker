<script>
  import { List } from 'lucide-svelte';

  export let node = null;           // { appCount, appNames } | null
  export let loading = false;
  export let error = false;

  $: unresolvedCount = node ? node.appCount - (node.appNames?.length || 0) : 0;
</script>

<div class="apps-card terminal-border" class:loading>
  <div class="apps-header">
    <div class="apps-icon">
      <List size={24} strokeWidth={2} />
    </div>
    <div class="apps-title">Apps On This Node</div>
  </div>

  {#if loading}
    <div class="apps-empty-state">Loading...</div>
  {:else if error || !node}
    <div class="apps-empty-state">Not available right now</div>
  {:else if !node.appNames || node.appNames.length === 0}
    <div class="apps-empty-state">No identifiable apps on this node</div>
  {:else}
    <div class="apps-list">
      {#each node.appNames as name}
        <span class="app-name-pill">{name}</span>
      {/each}
    </div>
    {#if unresolvedCount > 0}
      <div class="apps-unresolved-note">
        {unresolvedCount} {unresolvedCount === 1 ? 'app' : 'apps'} not yet identifiable
      </div>
    {/if}
  {/if}
</div>

<style>
  .apps-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    transition: all 0.3s ease;
    display: flex;
    flex-direction: column;
  }

  .apps-card:hover {
    border-color: var(--border-glow);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .apps-card.loading {
    pointer-events: none;
  }

  .apps-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .apps-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.9;
  }

  .apps-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }

  .apps-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
    flex: 1;
  }

  .apps-empty-state {
    padding: var(--spacing-lg) 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .apps-list {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 0.4rem;
    flex: 1;
    overflow-y: auto;
    max-height: 9rem;
  }

  .app-name-pill {
    font-size: 0.75rem;
    color: var(--text-primary);
    background: rgba(0, 255, 255, 0.08);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.6rem;
  }

  .apps-unresolved-note {
    margin-top: var(--spacing-sm);
    padding-top: var(--spacing-sm);
    border-top: 1px solid var(--border-color);
    font-size: 0.7rem;
    color: var(--text-muted);
    font-style: italic;
  }
</style>

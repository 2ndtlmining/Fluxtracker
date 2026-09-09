<script>
  import { Download } from 'lucide-svelte';
  import RevenueTransactionsTable from '$lib/components/RevenueTransactionsTable.svelte';
  import RevenueAppAnalytics from '$lib/components/RevenueAppAnalytics.svelte';

  // Props
  export let title = 'Revenue Transaction Log';

  // View mode toggle
  let viewMode = 'transactions'; // 'transactions' | 'apps'
  // App Analytics is lazy-mounted on first switch, then kept mounted (hidden via CSS)
  // so its own state (search, selected app, pagination) survives further toggles.
  // The transactions table is mounted from the start (it's the default view) and is
  // never destroyed either, for the same reason.
  let appsEverActivated = false;

  // Shared state, bound from whichever child owns it, so the header can show it
  // regardless of which view is active.
  let currentPage = 1;
  let totalPages = 1;
  let totalTransactions = 0;
  let totalApps = 0;
  let loading = true;
  let error = null;
  let mode = 'LIVE';

  let tableComponent;

  function switchView(mode_) {
    viewMode = mode_;
    if (mode_ === 'apps') {
      appsEverActivated = true;
    }
  }
</script>

<div class="transaction-log terminal-border">
  <!-- Header -->
  <div class="log-header">
    <div class="header-left">
      <div class="title-row">
        <h2 class="log-title">{viewMode === 'apps' ? 'App Revenue Analytics' : title}</h2>
        <div class="view-toggle">
          <button
            class="toggle-btn"
            class:active={viewMode === 'transactions'}
            on:click={() => switchView('transactions')}
            title="Switch to Transactions view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button
            class="toggle-btn"
            class:active={viewMode === 'apps'}
            on:click={() => switchView('apps')}
            title="Switch to App Analytics view"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="transaction-count">
        {#if viewMode === 'apps'}
          {totalApps.toLocaleString()} apps
        {:else}
          {totalTransactions.toLocaleString()} transactions
        {/if}
      </div>
    </div>
    <div class="header-right">
      <div class="page-info">Page: <span class="highlight">{currentPage}/{totalPages}</span></div>
      <div class="mode-indicator">Mode: <span class="mode-badge">{mode}</span></div>

      <!-- CSV Export Button -->
      {#if !loading && !error && totalTransactions > 0}
        <button
          class="export-btn"
          on:click={() => tableComponent.exportToCSV()}
          title="Export all transactions to CSV"
        >
          <Download size={14} strokeWidth={2} />
          <span class="export-text">CSV</span>
        </button>
      {/if}
    </div>
  </div>

  <div class:hidden-view={viewMode !== 'transactions'}>
    <RevenueTransactionsTable
      bind:this={tableComponent}
      bind:currentPage
      bind:totalPages
      bind:totalTransactions
      bind:loading
      bind:error
      bind:mode
    />
  </div>

  {#if appsEverActivated}
    <div class:hidden-view={viewMode !== 'apps'}>
      <RevenueAppAnalytics bind:totalApps />
    </div>
  {/if}
</div>

<style>
  .transaction-log {
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
    margin: var(--spacing-xl) 0;
  }

  /* Header */
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  /* View Toggle */
  .view-toggle {
    display: flex;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 2px;
    gap: 2px;
  }
  .toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.3rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .toggle-btn.active {
    background: rgba(0,255,255,0.15);
    color: var(--accent-cyan);
    box-shadow: 0 0 8px rgba(0,255,255,0.3);
  }
  .toggle-btn:hover:not(.active) { color: var(--text-white); }

  .log-title {
    font-size: 1.25rem;
    color: var(--text-primary);
    margin: 0;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .transaction-count {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-family: 'Courier New', monospace;
  }

  .header-right {
    display: flex;
    gap: var(--spacing-lg);
    align-items: center;
    flex-wrap: wrap;
  }

  .page-info {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: 'Courier New', monospace;
  }

  .highlight {
    color: var(--text-primary);
    font-weight: 700;
  }

  .mode-indicator {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: 'Courier New', monospace;
  }

  .mode-badge {
    color: var(--accent-green);
    font-weight: 700;
    padding: 0.25rem 0.5rem;
    background: rgba(0, 255, 65, 0.1);
    border: 1px solid rgba(0, 255, 65, 0.3);
    border-radius: var(--radius-sm);
  }

  /* Export Button */
  .export-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-white);
    padding: 0.375rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: 'Courier New', monospace;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .export-btn:hover {
    border-color: var(--accent-cyan);
    background: rgba(0, 255, 255, 0.1);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
    transform: translateY(-1px);
  }

  .export-btn:active {
    transform: translateY(0);
  }

  .export-icon {
    font-size: 0.875rem;
  }

  .export-text {
    font-size: 0.7rem;
  }

  /* Hides an already-mounted view without destroying it, so its internal state
     (search text, selected app, pagination) survives switching away and back. */
  .hidden-view {
    display: none;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .log-header {
      flex-direction: column;
      gap: var(--spacing-md);
    }

    .header-right {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-sm);
      width: 100%;
    }

    .export-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>

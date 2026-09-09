<script>
  import { onMount } from 'svelte';
  import { getApiUrl, isFluxTeamAddress, isFluxFiatAddress } from '$lib/config.js';

  // Bound to the parent so the shared header can show "N apps".
  export let totalApps = 0;

  // IMPORTANT: API_URL must be set in onMount(), not here!
  let API_URL = '';

  // App Analytics state
  let apps = [];
  let appsPage = 1;
  let appsPerPage = 50;
  let appsTotalPages = 1;
  let appsLoading = false;
  let appsError = null;
  let appsSearch = '';
  let appsSearchTimeout;

  // App Detail (drill-down) state
  let selectedApp = null;
  let appTxns = [];
  let appTxnsPage = 1;
  let appTxnsTotalPages = 1;
  let appTxnsLoading = false;
  let appTxnsTotal = 0;

  onMount(() => {
    // Get API URL in browser context
    API_URL = getApiUrl();

    fetchApps();
  });

  async function fetchApps() {
    appsLoading = true;
    appsError = null;
    try {
      const params = new URLSearchParams({
        page: appsPage,
        limit: appsPerPage,
        search: appsSearch
      });
      const response = await fetch(`${API_URL}/api/analytics/apps?${params}`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const result = await response.json();
      apps = result.apps || [];
      totalApps = result.total || 0;
      appsTotalPages = Math.ceil(totalApps / appsPerPage);
      appsLoading = false;
    } catch (err) {
      appsError = err.message;
      appsLoading = false;
    }
  }

  function handleAppsSearch(event) {
    appsSearch = event.target.value;
    clearTimeout(appsSearchTimeout);
    appsSearchTimeout = setTimeout(() => {
      appsPage = 1;
      fetchApps();
    }, 300);
  }

  function openAppDetail(app) {
    selectedApp = app;
    appTxnsPage = 1;
    fetchAppTransactions();
  }

  function closeAppDetail() {
    selectedApp = null;
    appTxns = [];
    appTxnsPage = 1;
  }

  async function fetchAppTransactions() {
    appTxnsLoading = true;
    try {
      const params = new URLSearchParams({
        page: appTxnsPage,
        limit: 50,
        appName: selectedApp.app_name
      });
      const response = await fetch(`${API_URL}/api/transactions/paginated?${params}`);
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const result = await response.json();
      appTxns = result.transactions || [];
      appTxnsTotal = result.total || 0;
      appTxnsTotalPages = Math.ceil(appTxnsTotal / 50);
      appTxnsLoading = false;
    } catch (err) {
      appTxnsLoading = false;
    }
  }

  function appsNextPage() {
    if (appsPage < appsTotalPages) { appsPage++; fetchApps(); }
  }
  function appsPrevPage() {
    if (appsPage > 1) { appsPage--; fetchApps(); }
  }
  function appTxnsNextPage() {
    if (appTxnsPage < appTxnsTotalPages) { appTxnsPage++; fetchAppTransactions(); }
  }
  function appTxnsPrevPage() {
    if (appTxnsPage > 1) { appTxnsPage--; fetchAppTransactions(); }
  }

  function formatTxid(txid) {
    return txid.substring(0, 18) + '...' + txid.substring(txid.length - 8);
  }

  function formatAddress(address) {
    if (!address) return '';
    if (address === 'Multiple' || address === 'Unknown') return address;
    return address.substring(0, 15) + '...';
  }

  function formatAmount(amount) {
    return amount.toFixed(8);
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
  }

  function getExplorerUrl(txid) {
    return `https://explorer.runonflux.io/tx/${txid}`;
  }
</script>

<!-- APP ANALYTICS VIEW -->
<div class="apps-search-section">
  <input type="text" class="search-input" placeholder="Search apps..."
    bind:value={appsSearch} on:input={handleAppsSearch} />
  <span class="apps-count">{totalApps.toLocaleString()} apps</span>
</div>

{#if appsLoading}
  <div class="loading-overlay"><div class="loading-spinner"></div><p>Loading apps...</p></div>
{:else if appsError}
  <div class="error-overlay">
    <span class="error-icon">⚠️</span>
    <p>{appsError}</p>
    <button class="retry-button" on:click={fetchApps}>Retry</button>
  </div>
{:else if apps.length === 0}
  <div class="empty-state"><p>No apps found</p></div>
{:else}
  <div class="apps-grid">
    {#each apps as app}
      <button class="app-card" on:click={() => openAppDetail(app)}>
        <div class="app-card-name">{app.app_name}</div>
        <div class="app-card-stats">
          <div class="app-stat-row">
            <span class="app-stat-label">Total Revenue</span>
            <span class="app-stat-value green">{app.total_revenue.toFixed(2)} FLUX</span>
          </div>
          <div class="app-stat-row">
            <span class="app-stat-label">Transactions</span>
            <span class="app-stat-value">{app.transaction_count}</span>
          </div>
          <div class="app-stat-row">
            <span class="app-stat-label">Avg Payment</span>
            <span class="app-stat-value">{app.avg_payment.toFixed(2)} FLUX</span>
          </div>
          <div class="app-stat-dates">
            <span>First: {app.first_payment}</span>
            <span>Last: {app.last_payment}</span>
          </div>
        </div>
      </button>
    {/each}
  </div>

  <!-- Apps Pagination -->
  <div class="navigation-section">
    <div class="nav-info">Page {appsPage} of {appsTotalPages}</div>
    <div class="pagination">
      <button class="page-btn" on:click={appsPrevPage} disabled={appsPage === 1}>‹</button>
      <button class="page-btn" on:click={appsNextPage} disabled={appsPage === appsTotalPages}>›</button>
    </div>
  </div>
{/if}

<!-- App Detail Modal -->
{#if selectedApp}
  <div class="modal-backdrop" role="button" tabindex="0" on:click={closeAppDetail} on:keydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && closeAppDetail()}>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="App details" tabindex="-1" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="modal-header">
        <h3 class="modal-title">{selectedApp.app_name}</h3>
        <button class="modal-close" on:click={closeAppDetail}>✕</button>
      </div>

      <!-- Summary Stats -->
      <div class="modal-summary">
        <div class="summary-stat">
          <div class="summary-label">Total Revenue</div>
          <div class="summary-value green">{selectedApp.total_revenue.toFixed(2)} FLUX</div>
        </div>
        <div class="summary-stat">
          <div class="summary-label">Transactions</div>
          <div class="summary-value">{selectedApp.transaction_count}</div>
        </div>
        <div class="summary-stat">
          <div class="summary-label">Average</div>
          <div class="summary-value">{selectedApp.avg_payment.toFixed(2)} FLUX</div>
        </div>
      </div>

      <h4 class="modal-section-title">Transaction History</h4>

      {#if appTxnsLoading}
        <div class="loading-overlay" style="min-height:200px">
          <div class="loading-spinner"></div>
        </div>
      {:else}
        <div class="table-wrapper">
          <table class="transaction-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>TIME (UTC)</th>
                <th>TRANSACTION_ID</th>
                <th>FROM_ADDRESS</th>
                <th>AMOUNT</th>
                <th>BLOCK</th>
              </tr>
            </thead>
            <tbody>
              {#each appTxns as tx}
                <tr class:flux-team-row={isFluxTeamAddress(tx.from_address)} class:flux-fiat-row={isFluxFiatAddress(tx.from_address)}>
                  <td class="date-col">{tx.date}</td>
                  <td class="time-col">{formatTime(tx.timestamp)}</td>
                  <td class="txid-col">
                    <a href={getExplorerUrl(tx.txid)} target="_blank"
                      rel="noopener noreferrer" class="txid-link">
                      {formatTxid(tx.txid)}
                    </a>
                  </td>
                  <td class="address-col">
                    {formatAddress(tx.from_address)}
                    {#if isFluxTeamAddress(tx.from_address)}
                      <span class="flux-team-badge" title="Funded by the Flux team — {tx.from_address}">TEAM</span>
                    {:else if isFluxFiatAddress(tx.from_address)}
                      <span class="flux-fiat-badge" title="Bought through the Flux fiat on-ramp">FIAT</span>
                    {/if}
                  </td>
                  <td class="amount-col">{formatAmount(tx.amount)} FLUX</td>
                  <td class="block-col">{tx.block_height.toLocaleString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        {#if appTxnsTotalPages > 1}
          <div class="navigation-section" style="padding-top: var(--spacing-sm)">
            <div class="nav-info">{appTxnsPage}/{appTxnsTotalPages}</div>
            <div class="pagination">
              <button class="page-btn" on:click={appTxnsPrevPage} disabled={appTxnsPage === 1}>‹</button>
              <button class="page-btn" on:click={appTxnsNextPage} disabled={appTxnsPage === appTxnsTotalPages}>›</button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Loading/Error States */
  .loading-overlay,
  .error-overlay,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 400px;
    color: var(--text-muted);
    gap: var(--spacing-md);
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-cyan);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error-icon {
    font-size: 2rem;
  }

  .retry-button {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .retry-button:hover {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
  }

  .search-input {
    width: 100%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-family: 'Courier New', monospace;
    transition: all 0.2s ease;
  }

  .search-input::placeholder {
    color: var(--text-dim);
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.2);
  }

  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .transaction-table {
    width: 100%;
    border-collapse: collapse;
    font-family: 'Courier New', monospace;
    font-size: 0.8rem;
  }

  .transaction-table thead {
    background: var(--bg-tertiary);
  }

  .transaction-table th {
    padding: var(--spacing-sm) var(--spacing-md);
    text-align: left;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 0.7rem;
    border-bottom: 1px solid var(--border-color);
  }

  .transaction-table tbody tr {
    border-bottom: 1px solid var(--border-color);
    transition: background 0.2s ease;
  }

  .transaction-table tbody tr:hover {
    background: rgba(0, 255, 255, 0.05);
  }

  .transaction-table td {
    padding: var(--spacing-sm) var(--spacing-md);
    color: var(--text-white);
  }

  .txid-col {
    font-family: 'Courier New', monospace;
  }

  .txid-link {
    color: var(--accent-cyan);
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .txid-link:hover {
    color: var(--text-primary);
    text-shadow: 0 0 8px var(--accent-cyan);
  }

  .address-col {
    color: var(--text-dim);
    font-size: 0.75rem;
  }

  .amount-col {
    color: var(--accent-green);
    font-weight: 700;
    text-align: right;
  }

  .date-col {
    color: var(--text-white);
  }

  .time-col {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .block-col {
    color: var(--accent-cyan);
    text-align: right;
  }

  /* Flux Team/Fiat Highlighting */
  .flux-team-row {
    background: rgba(189, 147, 249, 0.06) !important;
    border-left: 2px solid rgba(189, 147, 249, 0.4);
  }

  .flux-team-row:hover {
    background: rgba(189, 147, 249, 0.12) !important;
  }

  .flux-team-badge {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--accent-purple);
    background: rgba(189, 147, 249, 0.15);
    border: 1px solid rgba(189, 147, 249, 0.4);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    margin-left: 0.4rem;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    vertical-align: middle;
    white-space: nowrap;
  }

  .flux-fiat-row {
    background: rgba(241, 196, 83, 0.06) !important;
    border-left: 2px solid rgba(241, 196, 83, 0.4);
  }

  .flux-fiat-row:hover {
    background: rgba(241, 196, 83, 0.12) !important;
  }

  .flux-fiat-badge {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    color: #f1c453;
    background: rgba(241, 196, 83, 0.15);
    border: 1px solid rgba(241, 196, 83, 0.4);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    margin-left: 0.4rem;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    vertical-align: middle;
    white-space: nowrap;
  }

  /* Navigation */
  .navigation-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--spacing-md);
    padding-top: var(--spacing-md);
    border-top: 1px solid var(--border-color);
    font-family: 'Courier New', monospace;
    font-size: 0.875rem;
    flex-wrap: wrap;
  }

  .nav-info {
    color: var(--text-muted);
  }

  .pagination {
    display: flex;
    gap: var(--spacing-xs);
    align-items: center;
  }

  .page-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-white);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-family: 'Courier New', monospace;
    cursor: pointer;
    transition: all 0.2s ease;
    min-width: 32px;
    text-align: center;
  }

  .page-btn:hover:not(:disabled) {
    border-color: var(--accent-cyan);
    background: rgba(0, 255, 255, 0.1);
  }

  .page-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* App Analytics */
  .apps-search-section {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  .apps-search-section .search-input { flex: 1; }
  .apps-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: 'Courier New', monospace;
    white-space: nowrap;
  }
  .apps-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
  }
  .app-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--spacing-md);
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    width: 100%;
  }
  .app-card:hover {
    border-color: var(--accent-cyan);
    box-shadow: 0 0 12px rgba(0,255,255,0.2);
    transform: translateY(-2px);
  }
  .app-card-name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--accent-cyan);
    margin-bottom: var(--spacing-sm);
    font-family: 'Courier New', monospace;
    word-break: break-word;
  }
  .app-card-stats { display: flex; flex-direction: column; gap: 0.4rem; }
  .app-stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.8rem;
    font-family: 'Courier New', monospace;
  }
  .app-stat-label { color: var(--text-muted); }
  .app-stat-value { color: var(--text-white); font-weight: 600; }
  .app-stat-value.green { color: var(--accent-green); }
  .app-stat-dates {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--text-dim);
    font-family: 'Courier New', monospace;
    margin-top: 0.25rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
  }

  /* App Detail Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: var(--spacing-lg);
  }
  .modal-panel {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 860px;
    max-height: 85vh;
    overflow-y: auto;
    padding: var(--spacing-lg);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-md);
    border-bottom: 1px solid var(--border-color);
  }
  .modal-title {
    font-size: 1.25rem;
    color: var(--accent-cyan);
    margin: 0;
    font-family: 'Courier New', monospace;
  }
  .modal-close {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    transition: all 0.2s ease;
  }
  .modal-close:hover { color: var(--text-primary); background: rgba(0,255,255,0.1); }
  .modal-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--spacing-md);
    margin-bottom: var(--spacing-lg);
    padding: var(--spacing-md);
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .summary-stat { display: flex; flex-direction: column; gap: 0.25rem; }
  .summary-label { font-size: 0.72rem; color: var(--text-muted); font-family: 'Courier New', monospace; }
  .summary-value {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-white);
    font-family: 'Courier New', monospace;
  }
  .summary-value.green { color: var(--accent-green); }
  .modal-section-title {
    font-size: 1rem;
    color: var(--accent-cyan);
    margin: 0 0 var(--spacing-sm) 0;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  /* Responsive */
  @media (max-width: 1200px) {
    .apps-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 768px) {
    .navigation-section {
      flex-direction: column;
      align-items: stretch;
    }

    .pagination {
      justify-content: center;
    }

    .transaction-table {
      font-size: 0.7rem;
    }

    .transaction-table th,
    .transaction-table td {
      padding: var(--spacing-xs) var(--spacing-sm);
    }

    .apps-grid { grid-template-columns: 1fr; }
    .modal-summary { grid-template-columns: 1fr; }
    .apps-search-section { flex-direction: column; align-items: stretch; }
  }
</style>

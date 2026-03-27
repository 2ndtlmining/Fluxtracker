<script>
  import { onMount } from 'svelte';
  import { getApiUrl, isFluxTeamAddress } from '$lib/config.js';
  import { Download } from 'lucide-svelte';

  // Props
  export let title = 'Revenue Transaction Log';

  // IMPORTANT: API_URL must be set in onMount(), not here!
  let API_URL = '';

  // State
  let transactions = [];
  let totalTransactions = 0;
  let loading = true;
  let error = null;

  // Pagination
  let currentPage = 1;
  let perPage = 50;
  let totalPages = 1;

  // Search
  let searchQuery = '';
  let searchTimeout;

  // Mode (for UI indicator)
  let mode = 'LIVE';

  // View mode toggle
  let viewMode = 'transactions'; // 'transactions' | 'apps'

  // App Analytics state
  let apps = [];
  let totalApps = 0;
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

  // Computed values
  $: offset = (currentPage - 1) * perPage;
  $: pageRange = getPageRange(currentPage, totalPages);

  onMount(() => {
    // Get API URL in browser context
    API_URL = getApiUrl();
    
    fetchTransactions();
  });

  async function fetchTransactions() {
    loading = true;
    error = null;

    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: perPage,
        search: searchQuery
      });

      const response = await fetch(`${API_URL}/api/transactions/paginated?${params}`);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();

      transactions = result.transactions || [];
      totalTransactions = result.total || 0;
      totalPages = Math.ceil(totalTransactions / perPage);

      loading = false;
    } catch (err) {
      console.error('Error fetching transactions:', err);
      error = err.message;
      loading = false;
    }
  }

  function handleSearch(event) {
    searchQuery = event.target.value;
    
    // Debounce search
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1; // Reset to first page on new search
      fetchTransactions();
    }, 300);
  }

  function goToPage(page) {
    if (page < 1 || page > totalPages || page === currentPage) return;
    currentPage = page;
    fetchTransactions();
  }

  function previousPage() {
    if (currentPage > 1) {
      currentPage--;
      fetchTransactions();
    }
  }

  function nextPage() {
    if (currentPage < totalPages) {
      currentPage++;
      fetchTransactions();
    }
  }

  function changePerPage(event) {
    perPage = parseInt(event.target.value);
    currentPage = 1;
    fetchTransactions();
  }

  function getPageRange(current, total) {
    const range = [];
    const delta = 2;

    for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
      range.push(i);
    }

    if (current - delta > 2) {
      range.unshift('...');
    }
    if (current + delta < total - 1) {
      range.push('...');
    }

    range.unshift(1);
    if (total > 1) {
      range.push(total);
    }

    return range;
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

  function appTypeLabel(appType) {
    if (appType === 'git') return 'Git';
    if (appType === 'docker') return 'Docker';
    return 'Unknown';
  }

  function formatUSD(amountUSD) {
    if (amountUSD === null || amountUSD === undefined) {
      return '-';
    }
    return '$' + amountUSD.toFixed(2);
  }

  function formatDate(dateStr) {
    return dateStr; // Already in YYYY-MM-DD format
  }

  function formatTime(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
  }

  function getExplorerUrl(txid) {
    return `https://explorer.runonflux.io/tx/${txid}`;
  }

  // CSV Export Function
  async function exportToCSV() {
    if (totalTransactions === 0) {
      console.warn('⚠️ No transactions to export');
      return;
    }

    try {
      // Show exporting indicator
      const originalText = mode;
      mode = 'EXPORTING...';

      // Fetch ALL transactions (not just current page)
      const response = await fetch(`${API_URL}/api/transactions/paginated?page=1&limit=${totalTransactions}&search=${searchQuery}`);
      
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }

      const result = await response.json();
      const allTransactions = result.transactions || [];

      // Build CSV content
      const headers = ['Type', 'Transaction ID', 'From Address', 'Source', 'App Name', 'Amount (FLUX)', 'Amount (USD)', 'Date', 'Time', 'Block Height'];
      const rows = allTransactions.map(tx => [
        appTypeLabel(tx.app_type),
        tx.txid,
        tx.from_address || 'Unknown',
        isFluxTeamAddress(tx.from_address) ? 'Flux Team' : '',
        tx.app_name || '-',
        tx.amount.toFixed(8),
        tx.amount_usd !== null ? tx.amount_usd.toFixed(2) : '-',
        tx.date,
        formatTime(tx.timestamp),
        tx.block_height
      ]);

      // Convert to CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(field => {
          // Escape fields that contain commas
          if (typeof field === 'string' && field.includes(',')) {
            return `"${field}"`;
          }
          return field;
        }).join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      
      // Generate filename with timestamp and search query
      const timestamp = new Date().toISOString().split('T')[0];
      const searchSuffix = searchQuery ? `_filtered_${searchQuery.substring(0, 10)}` : '';
      const filename = `flux_revenue_transactions${searchSuffix}_${timestamp}.csv`;
      
      // Create download link
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the URL object
      URL.revokeObjectURL(url);
      
      console.log(`📥 Exported ${allTransactions.length} transactions to ${filename}`);
      
      // Restore mode indicator
      mode = originalText;

    } catch (err) {
      console.error('❌ Export failed:', err);
      error = 'Export failed: ' + err.message;
      mode = 'LIVE';
    }
  }

  function switchView(mode_) {
    viewMode = mode_;
    if (mode_ === 'apps' && apps.length === 0) {
      fetchApps();
    }
  }

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
          on:click={exportToCSV}
          title="Export all transactions to CSV"
        >
          <Download size={14} strokeWidth={2} />
          <span class="export-text">CSV</span>
        </button>
      {/if}
    </div>
  </div>

  {#if viewMode === 'transactions'}
    <!-- Status Bar -->
    <div class="status-bar">
      <div class="status-item">
        <span class="status-dot"></span>
        Total TX: <span class="status-value">{totalTransactions.toLocaleString()}</span>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="search-section">
      <div class="search-label">FILTER TRANSACTIONS:</div>
      <input
        type="text"
        class="search-input"
        placeholder="search$ txid, address, amount..."
        bind:value={searchQuery}
        on:input={handleSearch}
      />
    </div>

    <!-- Table Section -->
    <div class="table-section">
      <div class="table-header">
        TRANSACTION <span class="log-count">LOG ({perPage} ENTRIES)</span>:
      </div>

      {#if loading}
        <div class="loading-overlay">
          <div class="loading-spinner"></div>
          <p>Loading transactions...</p>
        </div>
      {:else if error}
        <div class="error-overlay">
          <span class="error-icon">⚠️</span>
          <p>{error}</p>
          <button class="retry-button" on:click={fetchTransactions}>Retry</button>
        </div>
      {:else if transactions.length === 0}
        <div class="empty-state">
          <p>No transactions found</p>
        </div>
      {:else}
        <div class="table-wrapper">
          <table class="transaction-table">
            <thead>
              <tr>
                <th>TYPE</th>
                <th>TRANSACTION_ID</th>
                <th>FROM_ADDRESS</th>
                <th>APP_NAME</th>
                <th>AMOUNT_FLUX</th>
                <th>AMOUNT_USD</th>
                <th>DATE</th>
                <th>TIME (UTC)</th>
                <th>BLOCK</th>
              </tr>
            </thead>
            <tbody>
              {#each transactions as tx}
                <tr class:flux-team-row={isFluxTeamAddress(tx.from_address)}>
                  <td class="type-col">
                    {#if tx.app_type === 'git'}
                      <span title="Git" class="type-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="icon-git">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                      </span>
                    {:else if tx.app_type === 'docker'}
                      <span title="Docker" class="type-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="icon-docker">
                          <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/>
                        </svg>
                      </span>
                    {:else}
                      <span class="type-unknown" title="Unknown">?</span>
                    {/if}
                  </td>
                  <td class="txid-col">
                    <a
                      href={getExplorerUrl(tx.txid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="txid-link"
                    >
                      {formatTxid(tx.txid)}
                    </a>
                  </td>
                  <td class="address-col">
                    {formatAddress(tx.from_address)}
                    {#if isFluxTeamAddress(tx.from_address)}
                      <span class="flux-team-badge" title={tx.from_address}>FLUX</span>
                    {/if}
                  </td>
                  <td class="app-name-col">{tx.app_name || '-'}</td>
                  <td class="amount-col">{formatAmount(tx.amount)}</td>
                  <td class="amount-usd-col">{formatUSD(tx.amount_usd)}</td>
                  <td class="date-col">{formatDate(tx.date)}</td>
                  <td class="time-col">{formatTime(tx.timestamp)}</td>
                  <td class="block-col">{tx.block_height.toLocaleString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- Navigation -->
    <div class="navigation-section">
      <div class="nav-info">
        [{offset + 1}-{Math.min(offset + perPage, totalTransactions)}] of {totalTransactions.toLocaleString()} entries
      </div>

      <div class="pagination">
        <button
          class="page-btn"
          on:click={previousPage}
          disabled={currentPage === 1 || loading}
        >
          ‹
        </button>

        {#each pageRange as page}
          {#if page === '...'}
            <span class="page-dots">...</span>
          {:else}
            <button
              class="page-btn"
              class:active={page === currentPage}
              on:click={() => goToPage(page)}
              disabled={loading}
            >
              {page}
            </button>
          {/if}
        {/each}

        <button
          class="page-btn"
          on:click={nextPage}
          disabled={currentPage === totalPages || loading}
        >
          ›
        </button>
      </div>

      <div class="per-page-selector">
        <label for="per-page">per-page:</label>
        <select id="per-page" bind:value={perPage} on:change={changePerPage} disabled={loading}>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
      </div>
    </div>
  {:else}
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
                  <tr class:flux-team-row={isFluxTeamAddress(tx.from_address)}>
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
                        <span class="flux-team-badge" title={tx.from_address}>FLUX</span>
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

  /* Flux Team Highlighting */
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

  /* Status Bar */
  .status-bar {
    display: flex;
    gap: var(--spacing-lg);
    padding: var(--spacing-sm) 0;
    margin-bottom: var(--spacing-md);
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    color: var(--text-muted);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-green);
    box-shadow: 0 0 8px var(--accent-green);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .status-value {
    color: var(--text-primary);
    font-weight: 700;
  }

  /* Search Section */
  .search-section {
    margin-bottom: var(--spacing-lg);
  }

  .search-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--spacing-xs);
    font-family: 'Courier New', monospace;
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

  /* Table Section */
  .table-section {
    margin-bottom: var(--spacing-lg);
    position: relative;
    min-height: 400px;
  }

  .table-header {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: var(--spacing-sm);
    font-family: 'Courier New', monospace;
  }

  .log-count {
    color: var(--accent-cyan);
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

  .type-col {
    text-align: center;
    vertical-align: middle;
  }

  .type-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-git {
    color: var(--text-primary);
    filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.4));
  }

  .icon-docker {
    color: var(--text-primary);
    filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.4));
  }

  .type-unknown {
    color: var(--text-dim);
    font-size: 0.75rem;
    font-weight: 700;
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

  .app-name-col {
    color: var(--accent-cyan);
    font-size: 0.75rem;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .amount-col {
    color: var(--accent-green);
    font-weight: 700;
    text-align: right;
  }

  .amount-usd-col {
    color: var(--accent-purple);
    font-weight: 700;
    text-align: right;
    font-family: 'Courier New', monospace;
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

  .page-btn.active {
    background: var(--accent-cyan);
    border-color: var(--accent-cyan);
    color: var(--bg-primary);
    font-weight: 700;
  }

  .page-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .page-dots {
    color: var(--text-dim);
    padding: 0 var(--spacing-xs);
  }

  .per-page-selector {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    color: var(--text-muted);
  }

  .per-page-selector select {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-white);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-family: 'Courier New', monospace;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .per-page-selector select:hover {
    border-color: var(--accent-cyan);
  }

  .per-page-selector select:focus {
    outline: none;
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.2);
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

    .navigation-section {
      flex-direction: column;
      align-items: stretch;
    }

    .pagination {
      justify-content: center;
    }

    .per-page-selector {
      justify-content: flex-end;
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
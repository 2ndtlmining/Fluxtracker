<script>
  import { onMount } from 'svelte';
  import { getApiUrl } from '$lib/config.js';

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

  // Computed values
  $: offset = (currentPage - 1) * perPage;
  $: pageRange = getPageRange(currentPage, totalPages);

  onMount(() => {
    // Get API URL in browser context
    API_URL = getApiUrl();
    console.log('✅ RevenueTransactions using API URL:', API_URL);
    
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

  function formatDate(dateStr) {
    return dateStr; // Already in YYYY-MM-DD format
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
      const headers = ['Type', 'Transaction ID', 'From Address', 'To Address', 'Amount (FLUX)', 'Date', 'Block Height'];
      const rows = allTransactions.map(tx => [
        'IN',
        tx.txid,
        tx.from_address || 'Unknown',
        tx.address,
        tx.amount.toFixed(8),
        tx.date,
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
</script>

<div class="transaction-log terminal-border">
  <!-- Header -->
  <div class="log-header">
    <div class="header-left">
      <h2 class="log-title">{title}</h2>
      <div class="transaction-count">{totalTransactions.toLocaleString()} transactions</div>
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
          <span class="export-icon">📥</span>
          <span class="export-text">CSV</span>
        </button>
      {/if}
    </div>
  </div>

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
              <th>TO_ADDRESS</th>
              <th>AMOUNT_FLUX</th>
              <th>DATE</th>
              <th>BLOCK</th>
            </tr>
          </thead>
          <tbody>
            {#each transactions as tx}
              <tr>
                <td class="type-col">IN</td>
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
                <td class="address-col">{formatAddress(tx.from_address)}</td>
                <td class="address-col">{formatAddress(tx.address)}</td>
                <td class="amount-col">{formatAmount(tx.amount)}</td>
                <td class="date-col">{formatDate(tx.date)}</td>
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
    color: var(--accent-green);
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

  .amount-col {
    color: var(--accent-green);
    font-weight: 700;
    text-align: right;
  }

  .date-col {
    color: var(--text-white);
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
  }
</style>
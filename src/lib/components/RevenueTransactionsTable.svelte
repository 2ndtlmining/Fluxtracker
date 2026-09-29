<script>
  import { onMount, onDestroy } from 'svelte';
  import { appFocus, clearAppFocusParam } from '$lib/stores/appFocus.js';
  import { getApiUrl, isFluxTeamAddress, isFluxFiatAddress } from '$lib/config.js';
  import { formatCount, formatNumber } from '$lib/utils/format.js';
  import TxTypeIcon from '$lib/components/TxTypeIcon.svelte';
  import { serialiseSources, toggleSource as nextSources } from '$lib/utils/transactionSources.js';

  // Bound to the parent so the shared header (page info, mode badge, export button
  // enablement) can reflect this view's state.
  export let currentPage = 1;
  export let totalPages = 1;
  export let totalTransactions = 0;
  export let loading = true;
  export let error = null;
  export let mode = 'LIVE'; // for UI indicator

  // IMPORTANT: API_URL must be set in onMount(), not here!
  let API_URL = '';

  // State
  let transactions = [];

  // Pagination
  let perPage = 50;

  // Search
  let searchQuery = '';
  let searchTimeout;

  // Active payer filters (issue #159) -- the set of TEAM/FIAT badges toggled on. A Set
  // rather than a single value because the two are additive: both on means "team OR fiat",
  // which is a different question from either alone. Empty = no filter.
  let activeSources = new Set();

  // Issue #173: this was a `$:` reactive statement that fetchTransactions() read. Svelte 4
  // batches reactive statements until the next update cycle, so a click handler that had
  // just reassigned activeSources still read the PREVIOUS value -- the badges rendered the
  // new selection while the request carried the old one, and the table lagged the buttons by
  // exactly one click. It is now computed at call time from whatever is passed in, so there
  // is no stale read left to make.
  function sourceParam(sources = activeSources) {
    return serialiseSources(sources);
  }

  function toggleSource(source) {
    const next = nextSources(activeSources, source);
    activeSources = next;

    // A narrower filter can leave the current page beyond the end of the result set.
    currentPage = 1;
    // `next` passed explicitly, NOT read back off activeSources: the assignment above has
    // not propagated yet at this point in the tick.
    fetchTransactions(next);
  }

  function clearSources() {
    const empty = new Set();
    activeSources = empty;
    currentPage = 1;
    fetchTransactions(empty);
  }

  // Computed values
  $: offset = (currentPage - 1) * perPage;
  $: pageRange = getPageRange(currentPage, totalPages);

  // Header click-through (issue #284): search for the clicked app, from page 1, with no
  // payer filter narrowing it. `focusedApp` remembers the name so an empty result can say
  // "not synced yet" -- a deployment only has a payment row after the next revenue sync.
  let focusedApp = null;
  let lastFocusAt = 0;
  let unsubscribeFocus;

  onMount(() => {
    // Get API URL in browser context
    API_URL = getApiUrl();

    fetchTransactions();

    unsubscribeFocus = appFocus.subscribe(focus => {
      if (!focus || focus.at === lastFocusAt) return;
      lastFocusAt = focus.at;
      clearTimeout(searchTimeout);
      focusedApp = focus.name;
      searchQuery = focus.name;
      activeSources = new Set();
      currentPage = 1;
      fetchTransactions(activeSources);
    });
  });

  onDestroy(() => unsubscribeFocus?.());

  // A header click-through asks for that exact app (issue #382): `search` is a substring match,
  // so "kagura" would also list "kagura2". Typing in the box switches back to a normal search.
  const exactAppFilter = () => (focusedApp && searchQuery === focusedApp ? { appName: focusedApp } : { search: searchQuery });

  async function fetchTransactions(sources = activeSources) {
    loading = true;
    error = null;

    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: perPage,
        ...exactAppFilter()
      });
      // Stacks with the search box rather than replacing it, so "team-funded payments for
      // app alpha" is expressible. Omitted entirely when no badge is active.
      const source = sourceParam(sources);
      if (source) params.set('source', source);

      const response = await fetch(`${API_URL}/api/transactions/paginated?${params}`);

      if (!response.ok) {
        // Surface the server's own message. The endpoint returns actionable text for the
        // failures that actually happen here -- a missing migration names the file to
        // apply -- and collapsing that to "API error: 500" threw away the one piece of
        // information that tells anyone what to do next (issue #171).
        let detail = '';
        try {
          const body = await response.json();
          detail = body?.error || '';
        } catch { /* non-JSON error body; fall back to the status code */ }
        throw new Error(detail || `API error: ${response.status}`);
      }

      const result = await response.json();

      transactions = result.transactions || [];
      totalTransactions = result.total || 0;
      // Never 0: "Page 1/0" read as broken when a search or filter matched nothing (#321).
      totalPages = Math.max(1, Math.ceil(totalTransactions / perPage));

      loading = false;
    } catch (err) {
      console.error('Error fetching transactions:', err);
      error = err.message;
      loading = false;
    }
  }

  function handleSearch(event) {
    searchQuery = event.target.value;
    if (focusedApp) clearAppFocusParam();
    focusedApp = null;

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
    perPage = Number(event.target.value);
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

  // Two decimals on screen like every other surface (#443); the CSV export keeps all eight.
  function formatAmount(amount) {
    return formatNumber(amount, 2);
  }

  function appTypeLabel(appType) {
    if (appType === 'git') return 'Git';
    if (appType === 'docker') return 'Docker';
    // Issue #188: not an app at all -- a FluxDrive storage payment. "Unknown" was actively
    // wrong for these; we know exactly what they are, they just have no app to name.
    if (appType === 'fluxdrive') return 'FluxDrive';
    // Paid for a spec Flux never accepted -- there is no app, so no Git/Docker either.
    if (appType === 'unregistered') return 'Unregistered spec';
    return 'Unknown';
  }

  function formatUSD(amountUSD) {
    if (amountUSD === null || amountUSD === undefined) {
      return '-';
    }
    return '$' + formatNumber(amountUSD, 2);
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

  // #440: the full address was only ever visible on the TEAM badge. Same explorer as the txid.
  function getAddressUrl(address) {
    return `https://explorer.runonflux.io/address/${address}`;
  }

  const isRealAddress = address => address && address !== 'Multiple' && address !== 'Unknown';

  function formatShortTxid(txid) {
    return txid.substring(0, 8) + '…' + txid.substring(txid.length - 6);
  }

  // CSV Export Function — called by the parent header's export button via bind:this
  export async function exportToCSV() {
    if (totalTransactions === 0) {
      console.warn('⚠️ No transactions to export');
      return;
    }

    try {
      // Show exporting indicator
      const originalText = mode;
      mode = 'EXPORTING...';

      // Snapshot the filter once, up front: the export makes many requests and must not
      // change scope halfway through if someone clicks a badge while it runs.
      const exportSource = sourceParam();

      // Page through every transaction. Asking for all of them in one request looked like
      // it worked but the server caps the page size, so exports were silently truncated.
      // 1000 is the largest page the API will serve (PostgREST's db-max-rows) — asking for
      // more just got clamped, while totalPages was computed from the number we asked for,
      // so the loop stopped 4/5 of the way through (issue #158).
      const PAGE_SIZE = 1000;
      const allTransactions = [];
      let page = 1;
      let totalPages = 1;

      do {
        const response = await fetch(
          `${API_URL}/api/transactions/paginated?page=${page}&limit=${PAGE_SIZE}&${new URLSearchParams(exactAppFilter())}` +
          (exportSource ? `&source=${encodeURIComponent(exportSource)}` : '')
        );

        if (!response.ok) {
          throw new Error(`Export failed on page ${page}: ${response.status}`);
        }

        const result = await response.json();
        allTransactions.push(...(result.transactions || []));
        totalPages = result.totalPages || 1;

        mode = `EXPORTING ${Math.min(page, totalPages)}/${totalPages}...`;
        page++;
      } while (page <= totalPages);

      if (allTransactions.length < totalTransactions) {
        console.warn(`⚠️ Exported ${allTransactions.length} of ${totalTransactions} transactions`);
      }

      // Build CSV content
      const headers = ['Type', 'Transaction ID', 'From Address', 'Source', 'App Name', 'Amount (FLUX)', 'Amount (USD)', 'Date', 'Time', 'Block Height'];
      const rows = allTransactions.map(tx => [
        appTypeLabel(tx.app_type),
        tx.txid,
        tx.from_address || 'Unknown',
        isFluxTeamAddress(tx.from_address) ? 'Team' : isFluxFiatAddress(tx.from_address) ? 'Fiat' : '',
        tx.app_name || (tx.app_type === 'unregistered' ? 'Unregistered spec' : '-'),
        tx.amount.toFixed(8),
        tx.amount_usd !== null ? tx.amount_usd.toFixed(2) : '-',
        tx.date,
        formatTime(tx.timestamp),
        tx.block_height
      ]);

      // Convert to CSV string.
      // App names are free text, so quotes and newlines need escaping too — not just commas.
      const escapeField = (field) => {
        const value = field == null ? '' : String(field);
        if (/[",\n\r]/.test(value)) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(escapeField).join(','))
      ].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');

      // Generate filename with timestamp and search query
      const timestamp = new Date().toISOString().split('T')[0];
      const searchSuffix = searchQuery ? `_filtered_${searchQuery.substring(0, 10)}` : '';
      // The export inherits the active badges, so the filename has to record them --
      // otherwise two exports of very different scope land in Downloads under one name.
      const sourceSuffix = exportSource ? `_${exportSource.replace(/,/g, '-')}` : '';
      const filename = `flux_revenue_transactions${searchSuffix}${sourceSuffix}_${timestamp}.csv`;

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
    TRANSACTION LOG:
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
      <!-- Wrapped, not passed directly: fetchTransactions takes the active sources as its
           first argument, and a bare handler would hand it the click Event instead. -->
      <button class="retry-button" on:click={() => fetchTransactions()}>Retry</button>
    </div>
  {:else if transactions.length === 0}
    <div class="empty-state">
      {#if activeSources.size > 0}
        <!-- Distinguishes "this filter matched nothing" from "there is no data", which
             otherwise look identical and read as a broken table. -->
        <p>No {[...activeSources].sort().join(' or ')} transactions{searchQuery ? ' match that search' : ''}</p>
        <button type="button" class="retry-button" on:click={clearSources}>
          Clear filter
        </button>
      {:else if focusedApp && searchQuery === focusedApp}
        <!-- From a header click (#284): a fresh deployment has no payment row until the next
             revenue sync, which is not the same thing as "no transactions". -->
        <p>No payment for {focusedApp} synced yet</p>
        <p class="empty-hint">A new deployment's payment appears here after the next revenue sync.</p>
      {:else}
        <p>No transactions found</p>
      {/if}
    </div>
  {:else}
    <!-- The badges qualify the payer, not the currency: every row settles in FLUX.
         Spelling that out here rather than leaving it to a hover tooltip, because the
         two badges side by side otherwise read as "paid in FLUX vs paid in fiat". -->
    <div class="badge-legend">
      <button
        type="button"
        class="badge-filter"
        class:active={activeSources.has('team')}
        aria-pressed={activeSources.has('team')}
        on:click={() => toggleSource('team')}
        title={activeSources.has('team') ? 'Showing Flux team payments — click to clear' : 'Show only payments funded by the Flux team'}
      >
        <span class="flux-team-badge">TEAM</span>
        <span class="legend-text">funded by the Flux team</span>
      </button>
      <button
        type="button"
        class="badge-filter"
        class:active={activeSources.has('fiat')}
        aria-pressed={activeSources.has('fiat')}
        on:click={() => toggleSource('fiat')}
        title={activeSources.has('fiat') ? 'Showing fiat on-ramp payments — click to clear' : 'Show only payments bought through the Flux fiat on-ramp'}
      >
        <span class="flux-fiat-badge">FIAT</span>
        <span class="legend-text">bought through the Flux fiat on-ramp</span>
      </button>
      {#if activeSources.size > 0}
        <button type="button" class="badge-clear" on:click={clearSources}>
          clear filter
        </button>
      {/if}
      <span class="legend-note">All payments settle in FLUX.</span>
    </div>
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
            <tr class:flux-team-row={isFluxTeamAddress(tx.from_address)} class:flux-fiat-row={isFluxFiatAddress(tx.from_address)}>
              <td class="type-col">
                <TxTypeIcon type={tx.app_type} />
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
                {#if isRealAddress(tx.from_address)}
                  <a href={getAddressUrl(tx.from_address)} target="_blank" rel="noopener noreferrer" class="address-link" title={tx.from_address}>{formatAddress(tx.from_address)}</a>
                {:else}
                  {formatAddress(tx.from_address)}
                {/if}
                {#if isFluxTeamAddress(tx.from_address)}
                  <span class="flux-team-badge" title="Funded by the Flux team — {tx.from_address}">TEAM</span>
                {:else if isFluxFiatAddress(tx.from_address)}
                  <span class="flux-fiat-badge" title="Bought through the Flux fiat on-ramp">FIAT</span>
                {/if}
              </td>
              <td class="app-name-col" title={tx.app_name || undefined}>
                {#if tx.app_type === 'fluxdrive'}
                  <!-- Deliberately a badge rather than a literal app_name: this is a
                       classification of the payment, not the name of a deployed app, and
                       App Analytics groups by app_name. See issue #188. -->
                  <span class="fluxdrive-badge" title="FluxDrive storage payment — identified from the payment's OP_RETURN, not from an app specification">FLUXDRIVE</span>
                {:else if tx.app_type === 'unregistered' && !tx.app_name}
                  <!-- Paid for an app spec that Flux never accepted: the payment names a spec
                       hash with no message on the network, so there is no app to name. A
                       badge, like FluxDrive's, because it describes the payment, not an app. -->
                  <span class="unregistered-badge" title="Payment for an app specification that Flux never accepted: the network has no message for the spec this payment names, so there is no app name to show. It still counts towards revenue.">UNREGISTERED SPEC</span>
                {:else}
                  {tx.app_name || '-'}
                {/if}
              </td>
              <td class="amount-col">{formatAmount(tx.amount)}</td>
              <td class="amount-usd-col">{formatUSD(tx.amount_usd)}</td>
              <td class="date-col">{formatDate(tx.date)}</td>
              <td class="time-col">{formatTime(tx.timestamp)}</td>
              <td class="block-col">{formatCount(tx.block_height)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- #440: at phone width the table showed only TYPE and TRANSACTION_ID, with the app,
         amounts and time scrolled off to the side. Each payment is a two-line card there:
         what was paid for and how much, then when, its type and the transaction. -->
    <ul class="tx-cards">
      {#each transactions as tx}
        <li class="tx-card">
          <div class="tx-card-line">
            <span class="tx-card-app" title={tx.app_name || undefined}>
              {#if tx.app_type === 'fluxdrive'}
                <span class="fluxdrive-badge">FLUXDRIVE</span>
              {:else if tx.app_type === 'unregistered' && !tx.app_name}
                <span class="unregistered-badge">UNREGISTERED SPEC</span>
              {:else}
                {tx.app_name || '-'}
              {/if}
            </span>
            <span class="tx-card-amount">{formatAmount(tx.amount)} FLUX <span class="tx-card-usd">{formatUSD(tx.amount_usd)}</span></span>
          </div>
          <div class="tx-card-line tx-card-meta">
            <span>{formatDate(tx.date)} {formatTime(tx.timestamp)}</span>
            <TxTypeIcon type={tx.app_type} />
            {#if isFluxTeamAddress(tx.from_address)}
              <span class="flux-team-badge" title="Funded by the Flux team — {tx.from_address}">TEAM</span>
            {:else if isFluxFiatAddress(tx.from_address)}
              <span class="flux-fiat-badge" title="Bought through the Flux fiat on-ramp">FIAT</span>
            {/if}
            <a href={getExplorerUrl(tx.txid)} target="_blank" rel="noopener noreferrer" class="txid-link tx-card-txid">{formatShortTxid(tx.txid)}</a>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<!-- Navigation -->
<div class="navigation-section">
  <div class="nav-info">
    {#if totalTransactions > 0}
      [{offset + 1}-{Math.min(offset + perPage, totalTransactions)}] of {totalTransactions.toLocaleString('en-US')} entries
    {:else}
      0 entries
    {/if}
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
      <option value={25}>25</option>
      <option value={50}>50</option>
      <option value={100}>100</option>
      <option value={200}>200</option>
    </select>
  </div>
</div>

<style>
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
    font-family: var(--font-mono);
  }

  .search-input {
    width: 100%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
  }

  .table-wrapper {
    overflow-x: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
  }

  .transaction-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
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

  .txid-col {
    font-family: var(--font-mono);
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

  /* #440: half the app names were cut to 120px even at 1440px, where the table has room. */
  @media (min-width: 1200px) {
    .app-name-col {
      max-width: 240px;
    }
  }

  .address-link {
    color: inherit;
    text-decoration: none;
  }

  .address-link:hover,
  .address-link:focus-visible {
    color: var(--accent-cyan);
    text-decoration: underline;
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
    font-family: var(--font-mono);
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

  .empty-hint {
    font-size: 0.75rem;
    color: var(--text-dim);
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
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
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

  /* Issue #188. Independent of the TEAM/FIAT pair on purpose: those qualify the PAYER and
     are mutually exclusive, this qualifies the PRODUCT, and a FluxDrive payment can also
     come from the Flux team address -- both badges then show, in their own columns.
     --accent-green rather than cyan: cyan is this component's interactive colour (filter
     buttons, focus rings, export hover) and a static badge in it would read as a control. */
  .fluxdrive-badge {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--accent-green);
    background: rgba(0, 255, 65, 0.12);
    border: 1px solid rgba(0, 255, 65, 0.35);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    vertical-align: middle;
    white-space: nowrap;
  }

  /* Muted on purpose (--text-dim, like the unknown-type '?'): an unregistered spec is a
     fact about the payment, not a warning -- the FLUX was still paid and still counts. And
     not cyan, which is this component's interactive colour. */
  .unregistered-badge {
    display: inline-block;
    font-size: 0.6rem;
    font-weight: 700;
    color: var(--text-dim);
    border: 1px dashed var(--text-dim);
    border-radius: var(--radius-sm);
    padding: 0.1rem 0.35rem;
    letter-spacing: 0.5px;
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

  /* Key for the two payer badges. Understated on purpose — a footnote above the table,
     matching the treatment of .self-funded on the revenue card. */
  .badge-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.5rem;
    margin-bottom: var(--spacing-sm);
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  /* The legend entries are the filter controls (issue #159): clicking TEAM or FIAT narrows
     the table to that payer. Styled as bare text, not buttons -- the legend sits above the
     table as a footnote and a pair of chunky buttons there would outweigh the data. The
     active state is carried by the surrounding tint + underline rather than by restyling
     the badge itself, so the badge still reads as the same token used in the rows. */
  .badge-filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 6px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .badge-filter:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .badge-filter:focus-visible {
    outline: 2px solid var(--accent-cyan);
    outline-offset: 1px;
  }

  .badge-filter.active {
    background: rgba(255, 255, 255, 0.09);
    border-color: var(--border-color);
  }

  .badge-filter.active .legend-text {
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .badge-clear {
    background: none;
    border: none;
    padding: 0 4px;
    font: inherit;
    font-size: 0.7rem;
    color: var(--accent-cyan);
    cursor: pointer;
    text-decoration: underline;
  }

  /* The badges carry a left margin for their in-table use, which reads as a stray gap here. */
  .badge-legend .flux-team-badge,
  .badge-filter .flux-team-badge,
  .badge-filter .flux-fiat-badge,
  .badge-legend .flux-fiat-badge {
    margin-left: 0;
  }

  .legend-text {
    margin-right: 0.4rem;
  }

  .legend-note {
    color: var(--text-dim);
    font-style: italic;
  }

  /* Responsive */
  @media (max-width: 768px) {
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

    .badge-legend {
      font-size: 0.65rem;
    }
  }

  /* Phone-width cards (#440): hidden until the table gives way. */
  .tx-cards {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  @media (max-width: 768px) {
    .table-wrapper {
      display: none;
    }

    .tx-cards {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
    }
  }

  .tx-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border-color);
    font-size: 0.75rem;
  }

  .tx-card:last-child {
    border-bottom: none;
  }

  .tx-card-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .tx-card-app {
    flex: 1;
    min-width: 0;
    color: var(--accent-cyan);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tx-card-amount {
    flex-shrink: 0;
    color: var(--text-primary);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .tx-card-usd {
    color: var(--text-dim);
    font-weight: 500;
    margin-left: 0.25rem;
  }

  .tx-card-meta {
    color: var(--text-dim);
    font-size: 0.7rem;
  }

  .tx-card-txid {
    margin-left: auto;
  }
</style>

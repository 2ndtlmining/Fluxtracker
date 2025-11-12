<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl, DONATION_ADDRESSES } from '$lib/config.js';
  
  const API_URL = getApiUrl();
  
  let lastSync = 'Never';
  let timeSinceSync = '...';
  let totalTransactions = 0;
  let syncStatus = 'idle';
  let isRefreshing = false;
  
 
  let interval;
  
  onMount(async () => {
    await fetchFooterStats();
    
    // Update every 2 seconds
    interval = setInterval(() => {
      updateTimeSinceSync();
    }, 2000);
  });
  
  onDestroy(() => {
    if (interval) clearInterval(interval);
  });
  
  async function fetchFooterStats() {
    try {
      const response = await fetch(`${API_URL}/api/transactions/summary`);
      
      if (!response.ok) {
        throw new Error('API not responding');
      }
      
      const data = await response.json();
      
      if (data && data.totalTransactions !== undefined) {
        totalTransactions = data.totalTransactions;
        lastSync = new Date();
        syncStatus = 'success';
        updateTimeSinceSync();
      } else {
        // API returned but no data
        syncStatus = 'error';
        timeSinceSync = 'No data';
      }
    } catch (error) {
      console.error('Error fetching footer stats:', error);
      syncStatus = 'error';
      timeSinceSync = 'API offline';
      
      // Show a message to the user
      console.log('Make sure the API server is running on port 3000');
    }
  }
  
  async function handleRefresh() {
    if (isRefreshing) {
      console.log('Refresh already in progress...');
      return;
    }
    
    try {
      isRefreshing = true;
      syncStatus = 'syncing';
      
      // Call the test services endpoint
      const response = await fetch(`${API_URL}/api/admin/test-services`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        console.log('Services tested successfully');
        
        // Refresh the footer stats after tests complete
        await fetchFooterStats();
        
        syncStatus = 'success';
      } else if (result.alreadyRunning) {
        console.log('Tests are already running, refreshing data only...');
        await fetchFooterStats();
        syncStatus = 'success';
      } else {
        throw new Error(result.error || 'Test services failed');
      }
    } catch (error) {
      console.error('Error during refresh:', error);
      syncStatus = 'error';
      
      // Still try to refresh footer stats even if tests fail
      await fetchFooterStats();
    } finally {
      isRefreshing = false;
    }
  }
  
  function updateTimeSinceSync() {
    if (!lastSync || lastSync === 'Never') return;
    
    const now = new Date();
    const diff = Math.floor((now - lastSync) / 1000); // seconds
    
    if (diff < 60) {
      timeSinceSync = `${diff} sec ago`;
    } else if (diff < 3600) {
      const minutes = Math.floor(diff / 60);
      timeSinceSync = `${minutes} min ago`;
    } else {
      const hours = Math.floor(diff / 3600);
      timeSinceSync = `${hours} hr ago`;
    }
  }
  
  function getSyncStatusColor() {
    switch (syncStatus) {
      case 'success': return 'green';
      case 'error': return 'red';
      case 'syncing': return 'yellow';
      default: return 'yellow';
    }
  }
  
  function copyDonationAddress() {
  const donationAddress = DONATION_ADDRESSES[0]; // ✅ Gets first address from array
  
  if (!donationAddress) {
    console.error('No donation address configured in config.js');
    return;
  }
  
  navigator.clipboard.writeText(donationAddress).then(() => {
    console.log('Donation address copied to clipboard!');
    console.log('Address:', donationAddress);
  });
}
</script>

<footer class="footer terminal-border">
  <div class="footer-content">
    <!-- Left: Sync Status -->
    <div class="footer-left">
      <span class="status-dot {getSyncStatusColor()}"></span>
      <span class="footer-stat">
        Last sync: <span class="footer-value">{timeSinceSync}</span>
      </span>
    </div>
    
    <!-- Center: Transaction Count & Donation -->
    <div class="footer-center">
      <span class="footer-stat">
        <span class="footer-value cyan">{totalTransactions.toLocaleString()}</span> transactions
      </span>
      <span class="footer-divider">|</span>
      <button class="donation-btn" on:click={copyDonationAddress} title="Click to copy donation address">
        <span class="donation-icon">💰</span>
        <span class="donation-text">Donate</span>
      </button>
    </div>
    
    <!-- Right: Actions -->
    <div class="footer-right">
      <a href="https://github.com/2ndtlmining/Fluxtracker" target="_blank" rel="noopener noreferrer" class="github-link">
        <svg class="github-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
        <span>GitHub</span>
      </a>
      <button class="footer-btn" on:click={handleRefresh} disabled={isRefreshing}>
        {#if isRefreshing}
          <span class="spinner">⟳</span> Running...
        {:else}
          Refresh <span class="text-cyan">[F5]</span>
        {/if}
      </button>
    </div>
  </div>
</footer>

<style>
  .footer {
    background: var(--bg-header);
    padding: var(--spacing-md) var(--spacing-xl);
    margin-top: var(--spacing-xl);
    border-left: none;
    border-right: none;
    border-bottom: none;
    border-radius: 0;
    position: sticky;
    bottom: 0;
    z-index: 100;
  }
  
  .footer-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1600px;
    margin: 0 auto;
    font-size: 0.875rem;
    gap: var(--spacing-lg);
  }
  
  .footer-left,
  .footer-center,
  .footer-right {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }
  
  .footer-center {
    flex: 1;
    justify-content: center;
  }
  
  .footer-stat {
    color: var(--text-dim);
    font-weight: 500;
  }
  
  .footer-value {
    color: var(--text-white);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  
  .footer-value.cyan {
    color: var(--text-primary);
  }
  
  .footer-divider {
    color: var(--border-color);
    margin: 0 0.5rem;
  }
  
  .donation-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-dim);
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    transition: all 0.3s ease;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: 'JetBrains Mono', monospace;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  
  .donation-btn:hover {
    border-color: var(--accent-green);
    color: var(--text-white);
    box-shadow: 0 0 10px rgba(72, 187, 120, 0.3);
  }
  
  .donation-icon {
    font-size: 0.875rem;
  }
  
  .donation-text {
    font-size: 0.75rem;
  }
  
  .footer-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-dim);
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    transition: all 0.3s ease;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  
  .footer-btn:hover:not(:disabled) {
    border-color: var(--accent-cyan);
    color: var(--text-white);
    box-shadow: 0 0 10px var(--border-glow);
  }
  
  .footer-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .spinner {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .github-link {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--text-dim);
    text-decoration: none;
    padding: 0.375rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    transition: all 0.3s ease;
    font-size: 0.75rem;
    font-family: 'JetBrains Mono', monospace;
  }
  
  .github-link:hover {
    border-color: var(--accent-cyan);
    color: var(--text-white);
    box-shadow: 0 0 10px var(--border-glow);
  }
  
  .github-icon {
    width: 14px;
    height: 14px;
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }
  
  .status-dot.green {
    background: var(--accent-green);
    box-shadow: 0 0 10px var(--accent-green);
  }
  
  .status-dot.red {
    background: var(--accent-red);
    box-shadow: 0 0 10px var(--accent-red);
  }
  
  .status-dot.yellow {
    background: var(--accent-yellow);
    box-shadow: 0 0 10px var(--accent-yellow);
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  /* Responsive */
  @media (max-width: 768px) {
    .footer {
      padding: var(--spacing-sm) var(--spacing-md);
    }
    
    .footer-content {
      flex-direction: column;
      gap: var(--spacing-sm);
      font-size: 0.75rem;
    }
    
    .footer-center {
      order: -1;
      flex-wrap: wrap;
    }
    
    .footer-left,
    .footer-right {
      width: 100%;
      justify-content: space-between;
    }
    
    .footer-btn,
    .donation-btn {
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
    }
    
    .github-link {
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
    }
  }
</style>
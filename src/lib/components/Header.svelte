<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl } from '$lib/config.js';

  let API_URL = '';

  // Network stats
  let fluxPrice = null;
  let blockHeight = null;
  let totalNodes = 0;
  let totalApps = 0;

  // Tracker stats
  let uptime = '0d 0:00';
  let snapshotCount = 0;
  let lastSnapshotDate = 'N/A';
  let transactionCount = 0;
  let lastSyncBlock = null;

  // Host stats
  let platform = '...';
  let nodeVersion = '...';
  let cpuCores = 0;
  let totalMemMB = 0;
  let usedMemMB = 0;
  let memPercent = 0;

  // Build info
  let appVersion = '...';
  let arcaneOsCodename = '';

  // Status indicators
  let apiStatus = 'checking';
  let dbStatus = 'checking';

  let interval;

  onMount(async () => {
    API_URL = getApiUrl();
    await fetchHeaderData();
    interval = setInterval(fetchHeaderData, 30000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  async function fetchHeaderData() {
    try {
      const response = await fetch(`${API_URL}/api/header`);
      const data = await response.json();

      if (data.error) {
        apiStatus = 'offline';
        dbStatus = 'offline';
        return;
      }

      apiStatus = 'online';
      dbStatus = 'online';

      // Network
      fluxPrice = data.network.fluxPriceUsd;
      blockHeight = data.network.blockHeight;
      totalNodes = data.network.totalNodes;
      totalApps = data.network.totalApps;

      // Tracker
      const uptimeSeconds = Math.floor(data.tracker.uptime);
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      uptime = `${days}d ${hours}:${minutes.toString().padStart(2, '0')}`;

      snapshotCount = data.tracker.snapshots;
      lastSnapshotDate = data.tracker.lastSnapshotDate || 'N/A';
      transactionCount = data.tracker.transactions;
      lastSyncBlock = data.tracker.lastSyncBlock;

      // Build
      appVersion = data.appVersion || '...';
      arcaneOsCodename = data.network.arcaneOsCodename || '';

      // Host
      platform = data.host.platform;
      nodeVersion = data.host.nodeVersion;
      cpuCores = data.host.cpuCores;
      totalMemMB = data.host.totalMemMB;
      usedMemMB = data.host.usedMemMB;
      memPercent = data.host.memPercent;

    } catch (error) {
      console.error('Error fetching header data:', error);
      apiStatus = 'offline';
      dbStatus = 'offline';
    }
  }

  function formatPrice(price) {
    if (price === null) return '...';
    return price < 1 ? price.toFixed(4) : price.toFixed(2);
  }

  function formatNumber(n) {
    if (n === null || n === undefined) return '...';
    return n.toLocaleString();
  }

  function getStatusColor(status) {
    if (status === 'online') return 'green';
    if (status === 'offline') return 'red';
    return 'yellow';
  }

  function getMemClass(percent) {
    if (percent > 80) return 'error';
    if (percent >= 60) return 'warn';
    return 'good';
  }
</script>

<header class="header terminal-border">
  <div class="header-content">
    <!-- Left side: Title and Build Info -->
    <div class="header-left">
      <h1 class="header-title glow-text">
        FLUX<br/>TRACKER
      </h1>
      <div class="build-info">
        Build: <span class="text-cyan">{appVersion} {arcaneOsCodename}</span>
      </div>
    </div>

    <!-- Right side: Stats (Three rows) -->
    <div class="header-stats">
      <!-- Row 1: Flux Network -->
      <div class="stats-line">
        <span class="system-stat">
          FLUX <span class="system-stat-value">${formatPrice(fluxPrice)}</span>
        </span>
      </div>

      <!-- Row 2: Tracker Health -->
      <div class="stats-line">
        <span class="system-stat">
          up <span class="system-stat-value">{uptime}</span>
        </span>
        <span class="stat-separator">|</span>
        <span class="system-stat">
          <span class="system-stat-value">{snapshotCount}</span> snapshots
        </span>
        <span class="stat-separator">|</span>
        <span class="system-stat">
          last: <span class="system-stat-value">{lastSnapshotDate}</span>
        </span>
        <span class="status-indicators">
          <span class="status-label">API</span>
          <span class="status-dot {getStatusColor(apiStatus)}"></span>
          <span class="status-label">DB</span>
          <span class="status-dot {getStatusColor(dbStatus)}"></span>
        </span>
      </div>

      <!-- Row 3: Host System (hidden on mobile) -->
      <div class="stats-line host-line">
        <span class="system-stat">
          <span class="system-stat-value">{platform}</span>
        </span>
        <span class="stat-separator">|</span>
        <span class="system-stat">
          <span class="system-stat-value">{nodeVersion}</span>
        </span>
        <span class="stat-separator">|</span>
        <span class="system-stat">
          cpus <span class="system-stat-value">{cpuCores}</span>
        </span>
        <span class="stat-separator">|</span>
        <span class="system-stat">
          mem <span class="system-stat-value {getMemClass(memPercent)}">{(usedMemMB / 1024).toFixed(1)}/{(totalMemMB / 1024).toFixed(1)} GB ({memPercent}%)</span>
        </span>
      </div>
    </div>
  </div>
</header>

<style>
  .header {
    background: var(--bg-header);
    padding: var(--spacing-lg) var(--spacing-xl);
    margin-bottom: var(--spacing-xl);
    border-left: none;
    border-right: none;
    border-top: none;
    border-radius: 0;
  }

  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--spacing-xl);
    max-width: 1600px;
    margin: 0 auto;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .header-title {
    font-size: 2.5rem;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: 3px;
    margin: 0;
    text-transform: uppercase;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
  }

  .build-info {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 400;
  }

  .header-stats {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-sm);
    align-items: flex-end;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .stats-line {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .system-stat {
    color: var(--text-dim);
    font-weight: 500;
  }

  .system-stat-label {
    color: var(--text-muted);
  }

  .system-stat-value {
    color: var(--text-white);
    font-weight: 600;
  }

  .system-stat-value.good {
    color: var(--accent-green);
  }

  .system-stat-value.warn {
    color: var(--accent-yellow);
  }

  .system-stat-value.error {
    color: var(--accent-red);
  }

  .stat-separator {
    color: var(--border-color);
    opacity: 0.5;
  }

  .status-indicators {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: var(--spacing-sm);
  }

  .status-label {
    color: var(--text-muted);
    font-size: 0.65rem;
    font-weight: 500;
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
  @media (max-width: 1024px) {
    .header-content {
      flex-direction: column;
      align-items: flex-start;
    }

    .header-stats {
      width: 100%;
      align-items: flex-start;
    }

    .header-title {
      font-size: 2rem;
    }
  }

  @media (max-width: 768px) {
    .header {
      padding: var(--spacing-md);
    }

    .header-title {
      font-size: 1.5rem;
      letter-spacing: 2px;
    }

    .stats-line {
      flex-wrap: wrap;
      font-size: 0.65rem;
    }

    .system-stat {
      font-size: 0.65rem;
    }

    .host-line {
      display: none;
    }
  }
</style>

<script>
  import { onMount, onDestroy } from 'svelte';
  import { getApiUrl } from '$lib/config.js';
  import TerminalHeaderAnimation from '$lib/components/TerminalHeaderAnimation.svelte';
  import { pickLatestDeployed, pickLatestExpiring } from '$lib/utils/terminalAnimation.js';

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
  let lastSyncBlock = null;

  // Decentralization coverage counter (issue #120): unique node-IP classification
  // progress, next to uptime in Row 2. A different denominator than totalNodes above
  // (raw node-instance count) -- see DecentralizationCard.svelte's tooltip.
  let ipsClassified = 0;
  let ipsTotal = 0;

  // Host stats
  let platform = '...';
  let hostLocation = null;
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

  // Terminal boot tracking
  let dataReady = false;

  // Idle-rotation data (issue #104 Phase 2): the header's ASCII box cycles through
  // the current latest-deployed and latest-expiring apps once boot finishes. Both are
  // refreshed on the same 30s poll as everything else, so the rotation never shows
  // stale first-load data -- see fetchHeaderData/pollLatestApps.
  let latestDeployedApp = null;
  let latestExpiringApp = null;

  // Guards against overlapping poll cycles and hung requests. Without both, a slow or
  // stalled fetch stacks up: setInterval fires every 30s regardless of whether the
  // previous cycle finished, and an unbounded fetch can sit pending indefinitely --
  // over a long-lived session this exhausts the browser's connection buffer
  // (observed as "net::ERR_NO_BUFFER_SPACE" on /api/header).
  const FETCH_TIMEOUT_MS = 15000;
  let isPolling = false;

  function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
  }

  let interval;

  onMount(async () => {
    API_URL = getApiUrl();
    await fetchHeaderData();
    interval = setInterval(fetchHeaderData, 30000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  /**
   * Orchestrator: guards against overlapping cycles (a previous fetchHeaderStats/
   * pollLatestApps pair still in flight skips this tick entirely rather than starting
   * a second one on top of it), then runs both fetches concurrently rather than
   * sequentially -- halves the typical cycle duration, which shrinks the window in
   * which a slow cycle could still overlap the next one.
   */
  async function fetchHeaderData() {
    if (isPolling) return;
    isPolling = true;
    try {
      await Promise.all([fetchHeaderStats(), pollLatestApps()]);
    } finally {
      isPolling = false;
    }
  }

  async function fetchHeaderStats() {
    try {
      const response = await fetchWithTimeout(`${API_URL}/api/header`);
      const data = await response.json();

      if (data.error) {
        apiStatus = 'offline';
        dbStatus = 'offline';
        return;
      }

      apiStatus = 'online';
      dbStatus = data.dbStatus === 'online' ? 'online' : 'offline';

      // Network
      fluxPrice = data.network.fluxPriceUsd;
      const newBlockHeight = data.network.blockHeight;
      totalNodes = data.network.totalNodes;
      totalApps = data.network.totalApps;
      ipsClassified = data.network.decentralizationCoverage?.classified ?? 0;
      ipsTotal = data.network.decentralizationCoverage?.total ?? 0;

      // Tracker
      const uptimeSeconds = Math.floor(data.tracker.uptime);
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      uptime = `${days}d ${hours}:${minutes.toString().padStart(2, '0')}`;

      snapshotCount = data.tracker.snapshots;
      lastSnapshotDate = data.tracker.lastSnapshotDate || 'N/A';
      lastSyncBlock = data.tracker.lastSyncBlock;

      // Build
      appVersion = data.appVersion || '...';
      arcaneOsCodename = data.network.arcaneOsCodename || '';

      // Host
      platform = data.host.platform;
      hostLocation = data.host.location || null;
      cpuCores = data.host.cpuCores;
      totalMemMB = data.host.totalMemMB;
      usedMemMB = data.host.usedMemMB;
      memPercent = data.host.memPercent;

      blockHeight = newBlockHeight;
      dataReady = true;

    } catch (error) {
      console.error('Error fetching header data:', error);
      apiStatus = 'offline';
      dbStatus = 'offline';
    }
  }

  /**
   * Reads the already-cached deployed/expiring endpoints (carouselService caches both
   * server-side on CAROUSEL_CONFIG's own 10 min TTL, so this 30s client poll never
   * causes an extra upstream Flux API call) and keeps only the single most-current
   * entry from each for the header's idle rotation. Run every cycle -- never seeded
   * once and left stale -- so the rotation always reflects the latest cached data.
   *
   * The two fetches are independent (allSettled, not all): one endpoint being slow or
   * erroring shouldn't blank out the other, and each failure logs which endpoint and
   * why rather than one opaque combined error.
   */
  async function pollLatestApps() {
    const [deployedResult, expiringResult] = await Promise.allSettled([
      fetchLatestApp(`${API_URL}/api/carousel/deployed`, pickLatestDeployed),
      fetchLatestApp(`${API_URL}/api/carousel/expiring`, pickLatestExpiring)
    ]);

    if (deployedResult.status === 'fulfilled') {
      latestDeployedApp = deployedResult.value;
    } else {
      console.error('Error polling latest deployed apps for header animation:', deployedResult.reason);
    }

    if (expiringResult.status === 'fulfilled') {
      latestExpiringApp = expiringResult.value;
    } else {
      console.error('Error polling latest expiring apps for header animation:', expiringResult.reason);
    }
  }

  async function fetchLatestApp(url, pick) {
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`${url} responded ${response.status}`);
    const data = await response.json();
    return pick(data?.stats || []);
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

  /** "Melbourne, Australia" — falls back to just the country when the city is unknown */
  function formatLocation(location) {
    if (!location) return '';
    return location.city ? `${location.city}, ${location.country}` : location.country;
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
      <TerminalHeaderAnimation
        {blockHeight}
        {totalNodes}
        {totalApps}
        {snapshotCount}
        {appVersion}
        {arcaneOsCodename}
        {apiStatus}
        {dbStatus}
        {dataReady}
        {latestDeployedApp}
        {latestExpiringApp}
      />
      <div class="build-info">
        Build: <span class="build-version">{appVersion}</span>{#if arcaneOsCodename}{' '}<span class="build-codename">{arcaneOsCodename}</span>{/if}
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
          IPs <span class="system-stat-value">{formatNumber(ipsClassified)}/{formatNumber(ipsTotal)}</span>
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
        {#if hostLocation}
          <span class="system-stat" title="Where this instance is currently running">
            Hosted in
            <span class="system-stat-value">{formatLocation(hostLocation)}</span>
          </span>
          <span class="stat-separator">|</span>
        {/if}
        <span class="system-stat">
          Running on <span class="system-stat-value">{platform}</span>
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

  .build-info {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 400;
  }

  /* Version gets the same green the memory stat uses when healthy; the ArcaneOS
     codename gets the carousel's purple. Both values stay API-driven — only the
     colours are styled here. */
  .build-version {
    color: var(--accent-green);
  }

  .build-codename {
    color: var(--accent-purple);
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
  }

  @media (max-width: 768px) {
    .header {
      padding: var(--spacing-md);
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

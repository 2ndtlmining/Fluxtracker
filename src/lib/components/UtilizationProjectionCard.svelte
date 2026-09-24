<script>
  // Utilization Projection (issue #347): what the network would still run on each coming day
  // if no app renewed. Two lines, by the owner's decision: app instances (every app, exact)
  // and CPU cores (only the specs whose resources are readable -- encrypted game-site specs
  // hide theirs), with that coverage stated beside the chart rather than implied away.
  import { onMount, onDestroy } from 'svelte';
  import { TrendingDown } from 'lucide-svelte';
  import CardNotice from '$lib/components/CardNotice.svelte';
  import { getApiUrl } from '$lib/config.js';
  import { fetchJson } from '$lib/utils/fetchJson.js';
  import { pollWhileVisible } from '$lib/utils/pollWhileVisible.js';
  import { loadChartJs } from '$lib/utils/loadChartJs.js';
  import { refreshSignal } from '$lib/stores/refresh.js';
  import { formatCount, formatNumber } from '$lib/utils/format.js';

  // Cores the network actually reports in use (node benchmarks), for the coverage line.
  export let cpuInUse = null;

  const REFRESH_MS = 10 * 60 * 1000; // expiries move by the day; the server caches 10 min
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let projection = null;
  let loading = true;
  let failed = false;
  let canvas;
  let chart = null;
  let ChartJS = null;
  let stopPolling;

  const shortDate = iso => {
    const [, m, d] = String(iso).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  };

  async function load() {
    try {
      const data = await fetchJson(`${getApiUrl()}/api/cloud/utilization-projection`);
      if (!data?.available) throw new Error('projection unavailable');
      projection = data;
      failed = false;
    } catch (error) {
      console.error('Error fetching utilization projection:', error);
      failed = true; // keep the last good projection, if any
    } finally {
      loading = false;
    }
  }

  $: todayCpu = projection ? Math.round(projection.today.cpu) : null;
  $: cpuShare = projection && Number.isFinite(cpuInUse) && cpuInUse > 0
    ? Math.round((100 * projection.today.cpu) / cpuInUse)
    : null;
  $: summary = projection
    ? `If no app renews: ${formatCount(projection.drops.d7.instances)} instances gone in 7 days, `
      + `${formatCount(projection.drops.d30.instances)} of ${formatCount(projection.today.instances)} within 30 days.`
    : '';

  function draw() {
    if (!ChartJS || !canvas || !projection) return;
    const points = projection.points;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const data = {
      labels: points.map(p => shortDate(p.date)),
      datasets: [
        {
          label: 'App instances',
          data: points.map(p => p.instances),
          borderColor: 'rgb(0, 255, 255)',
          backgroundColor: 'rgba(0, 255, 255, 0.08)',
          fill: true,
          yAxisID: 'instances',
          pointRadius: 0,
          borderWidth: 2,
          stepped: true
        },
        {
          label: 'CPU cores (readable specs)',
          data: points.map(p => Math.round(p.cpu)),
          borderColor: 'rgb(189, 147, 249)',
          backgroundColor: 'transparent',
          yAxisID: 'cpu',
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [4, 3],
          stepped: true
        }
      ]
    };
    if (chart) {
      chart.data = data;
      chart.update(reduced ? 'none' : undefined);
      return;
    }
    const axis = (color, position) => ({
      position,
      beginAtZero: true,
      grid: { color: position === 'left' ? 'rgba(139, 146, 176, 0.1)' : 'transparent' },
      ticks: { color, font: { family: "'JetBrains Mono', monospace", size: 10 }, callback: v => formatCount(v, { compact: true }) }
    });
    chart = new ChartJS(canvas, {
      type: 'line',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced ? false : undefined,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { labels: { color: '#8b92b0', font: { family: "'JetBrains Mono', monospace", size: 11 } } },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 23, 0.95)',
            callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCount(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b92b0', maxTicksLimit: 8, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
          instances: axis('rgb(0, 255, 255)', 'left'),
          cpu: axis('rgb(189, 147, 249)', 'right')
        }
      }
    });
  }

  $: if (ChartJS && canvas && projection) draw();

  let lastRefresh = 0;
  let mounted = false;
  $: if (mounted && $refreshSignal > lastRefresh) {
    lastRefresh = $refreshSignal;
    load();
  }

  onMount(async () => {
    mounted = true;
    loadChartJs().then(lib => { ChartJS = lib; }).catch(error => console.error('Chart.js failed to load:', error));
    await load();
    stopPolling = pollWhileVisible(load, REFRESH_MS);
  });

  onDestroy(() => {
    stopPolling?.();
    chart?.destroy();
  });
</script>

<div class="projection-card terminal-border">
  <div class="projection-header">
    <div class="projection-icon"><TrendingDown size={24} strokeWidth={2} /></div>
    <div class="projection-title">Utilization Projection</div>
    <div class="projection-subtitle">if no app renews</div>
  </div>

  {#if loading}
    <div class="projection-loading">Loading projection...</div>
  {:else if !projection}
    <CardNotice kind="unavailable" onRetry={load} />
  {:else}
    <p class="projection-summary">{summary}</p>

    <div class="projection-chart" role="img" aria-label={`Utilization projection. ${summary}`}>
      <canvas bind:this={canvas} aria-hidden="true"></canvas>
    </div>

    <div class="projection-facts">
      {#if projection.biggestDrop && projection.biggestDrop.instances > 0}
        <div class="fact">
          <span class="fact-label">Biggest week</span>
          <span class="fact-value">
            {shortDate(projection.biggestDrop.from)} – {shortDate(projection.biggestDrop.to)}:
            −{formatCount(projection.biggestDrop.instances)} instances, −{formatCount(Math.round(projection.biggestDrop.cpu))} cores
          </span>
        </div>
      {/if}
      <div class="fact">
        <span class="fact-label">CPU line covers</span>
        <span class="fact-value">
          {formatCount(todayCpu)} cores ordered by readable specs{#if cpuShare !== null}{' '}— {cpuShare}% of
            the {formatCount(cpuInUse)} cores in use{/if}.
          {formatCount(projection.coverage.cpuUnreadableApps)} encrypted apps (mostly game sites) hide their CPU; their instances are in the instance line.
        </span>
      </div>
    </div>

    {#if failed}
      <CardNotice kind="stale" updatedAt={projection.generatedAt} onRetry={load} />
    {/if}
  {/if}
</div>

<style>
  .projection-card {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    margin-bottom: var(--spacing-xl);
  }

  .projection-header {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .projection-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.3));
  }

  .projection-title {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
  }

  .projection-subtitle {
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  .projection-summary {
    font-size: 0.85rem;
    color: var(--text-white);
    margin-bottom: var(--spacing-md);
  }

  .projection-chart {
    position: relative;
    height: 260px;
  }

  .projection-loading {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: var(--spacing-lg) 0;
  }

  .projection-facts {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    margin-top: var(--spacing-md);
    font-size: 0.75rem;
  }

  .fact {
    display: flex;
    gap: var(--spacing-sm);
    min-width: 0;
  }

  .fact-label {
    flex-shrink: 0;
    width: 8.5rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .fact-value {
    color: var(--text-dim);
    min-width: 0;
  }

  @media (max-width: 768px) {
    .fact {
      flex-direction: column;
      gap: 0;
    }

    .projection-chart {
      height: 200px;
    }
  }
</style>

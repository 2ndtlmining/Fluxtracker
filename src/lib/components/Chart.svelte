<script>
  import { onMount, onDestroy } from 'svelte';
  import Chart from 'chart.js/auto';
  import { getApiUrl } from '$lib/config.js';
  import { DollarSign, Gamepad2, Coins, Server, Cloud, Package } from 'lucide-svelte';

  // Props
  export let title = 'Historical Data';
  export let height = 400;
  export let defaultCategory = 'revenue';
  export let defaultTimeframe = '30d';

  // IMPORTANT: API_URL must be set in onMount(), not here!
  let API_URL = '';

  // State
  let chartCanvas;
  let chartInstance = null;
  let loading = true;
  let error = null;

  // Selected filters
  let selectedCategory = defaultCategory;
  let selectedMetric = null;
  let selectedTimeframe = defaultTimeframe;

  // Cached data - fetch once, reuse many times
  let allSnapshots = [];
  let chartData = { labels: [], data: [], rawDates: [] };
  let availableMetrics = [];

  // Category definitions
  const categories = {
    revenue: {
      label: 'Revenue',
      color: 'rgb(0, 255, 255)',
      metrics: [
        { id: 'daily_revenue', label: 'Daily Revenue (FLUX)', field: 'daily_revenue', format: 'flux' }
      ]
    },
    gaming: {
      label: 'Gaming Apps',
      color: 'rgb(138, 43, 226)',
      metrics: [
        { id: 'gaming_total', label: 'Total Gaming Apps', field: 'gaming_apps_total', format: 'number' },
        { id: 'gaming_minecraft', label: 'Minecraft', field: 'gaming_minecraft', format: 'number' },
        { id: 'gaming_palworld', label: 'Palworld', field: 'gaming_palworld', format: 'number' },
        { id: 'gaming_enshrouded', label: 'Enshrouded', field: 'gaming_enshrouded', format: 'number' }
      ]
    },
    crypto: {
      label: 'Crypto Nodes',
      color: 'rgb(255, 165, 0)',
      metrics: [
        { id: 'crypto_total', label: 'Total Crypto Nodes', field: 'crypto_nodes_total', format: 'number' },
        { id: 'crypto_presearch', label: 'Presearch', field: 'crypto_presearch', format: 'number' },
        { id: 'crypto_kadena', label: 'Kadena', field: 'crypto_kadena', format: 'number' },
        { id: 'crypto_kaspa', label: 'Kaspa', field: 'crypto_kaspa', format: 'number' }
      ]
    },
    nodes: {
      label: 'Node Distribution',
      color: 'rgb(0, 255, 65)',
      metrics: [
        { id: 'node_total', label: 'Total Nodes', field: 'node_total', format: 'number' },
        { id: 'node_cumulus', label: 'Cumulus Nodes', field: 'node_cumulus', format: 'number' },
        { id: 'node_nimbus', label: 'Nimbus Nodes', field: 'node_nimbus', format: 'number' },
        { id: 'node_stratus', label: 'Stratus Nodes', field: 'node_stratus', format: 'number' }
      ]
    },
    resources: {
      label: 'Cloud Resources',
      color: 'rgb(100, 200, 255)',
      metrics: [
        { id: 'cpu_util', label: 'CPU Utilization %', field: 'cpu_utilization_percent', format: 'percent' },
        { id: 'ram_util', label: 'RAM Utilization %', field: 'ram_utilization_percent', format: 'percent' },
        { id: 'storage_util', label: 'Storage Utilization %', field: 'storage_utilization_percent', format: 'percent' },
        { id: 'cpu_total', label: 'Total CPU cores', field: 'total_cpu_cores', format: 'number' },
        { id: 'ram_total', label: 'Total Ram GB', field: 'total_ram_gb', format: 'number' },
        { id: 'storage_total', label: 'Total Storage GB', field: 'total_storage_gb', format: 'number' },
        { id: 'cpu_used', label: 'Used CPU cores', field: 'used_cpu_cores', format: 'number' },
        { id: 'ram_used', label: 'Used Ram GB', field: 'used_ram_gb', format: 'number' },
        { id: 'storage_used', label: 'Used Storage GB', field: 'used_storage_gb', format: 'number' },
      ]
    },
    apps: {
      label: 'Applications',
      color: 'rgb(255, 100, 255)',
      metrics: [
        { id: 'total_apps', label: 'Total Applications', field: 'total_apps', format: 'number' },
        { id: 'wordpress_count', label: 'WordPress Sites', field: 'wordpress_count', format: 'number' },
      ]
    }
  };

  // Timeframe options
  const timeframes = [
    { id: '7d', label: '7 Days', days: 7 },
    { id: '14d', label: '14 Days', days: 14 },
    { id: '30d', label: '30 Days', days: 30 },
    { id: '60d', label: '60 Days', days: 60 },
    { id: '90d', label: '90 Days', days: 90 },
    { id: '1Y', label: '1 Year', days: 365 },
  ];

  // Update available metrics when category changes
  $: {
    if (selectedCategory && categories[selectedCategory]) {
      availableMetrics = categories[selectedCategory].metrics;
      if (!selectedMetric || !availableMetrics.find(m => m.id === selectedMetric)) {
        selectedMetric = availableMetrics[0]?.id;
      }
    }
  }

  // When category or metric changes, process existing data (no fetch needed!)
  $: if (selectedCategory && selectedMetric && allSnapshots.length > 0) {
    console.log(`🔄 Category/Metric changed to ${selectedCategory}/${selectedMetric} - processing cached data`);
    processChartData();
  }

  // When canvas becomes available and we have data, render the chart
  $: if (chartCanvas && chartData.labels.length > 0 && !loading) {
    console.log('🎨 Canvas ready and data available - rendering initial chart');
    renderChart();
  }

  // When timeframe changes, fetch new data
  let lastTimeframe = selectedTimeframe;
  $: if (selectedTimeframe !== lastTimeframe) {
    console.log(`⏱️ Timeframe changed from ${lastTimeframe} to ${selectedTimeframe} - fetching new data`);
    lastTimeframe = selectedTimeframe;
    fetchAllData();
  }

  onMount(async () => {
    // Get API URL in browser context
    API_URL = getApiUrl();
    console.log('✅ Chart component using API URL:', API_URL);
    
    console.log('📊 Chart component mounted');
    await fetchAllData();
  });

  onDestroy(() => {
    if (chartInstance) {
      chartInstance.destroy();
    }
  });

  async function fetchAllData() {
    loading = true;
    error = null;

    try {
      const days = timeframes.find(t => t.id === selectedTimeframe)?.days || 30;
      
      console.log(`📡 Fetching data for ${days} days`);
      
      // For REVENUE category, use transaction-based endpoint for real-time data
      if (selectedCategory === 'revenue') {
        console.log('💰 Fetching revenue from transactions (real-time)');
        const response = await fetch(`${API_URL}/api/history/revenue/daily?limit=${days}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        
        // Handle response format
        if (Array.isArray(result)) {
          allSnapshots = result;
        } else if (result.data && Array.isArray(result.data)) {
          allSnapshots = result.data;
        } else {
          allSnapshots = [];
        }
      } else {
        // For other categories, use snapshot data
        console.log('📊 Fetching from snapshots');
        const response = await fetch(`${API_URL}/api/history/snapshots/full?limit=${days}`);
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        
        // Handle response format
        if (Array.isArray(result)) {
          allSnapshots = result;
        } else if (result.data && Array.isArray(result.data)) {
          allSnapshots = result.data;
        } else {
          allSnapshots = [];
        }
      }

      if (allSnapshots.length === 0) {
        throw new Error('No historical data available');
      }

      console.log(`✅ Fetched ${allSnapshots.length} data points - cached for instant filtering`);
      
      // Process the data for current category/metric
      processChartData();
      loading = false;

    } catch (err) {
      console.error('❌ Error fetching data:', err);
      error = err.message;
      loading = false;
    }
  }

  function processChartData() {
    if (!allSnapshots || allSnapshots.length === 0) {
      console.warn('⚠️ No snapshots available to process');
      return;
    }

    const metric = availableMetrics.find(m => m.id === selectedMetric);
    if (!metric) {
      console.error('❌ Invalid metric');
      return;
    }

    console.log(`📊 Processing data for ${metric.label} (${metric.field})`);

    const labels = [];
    const data = [];
    const rawDates = [];

    // Sort data by date (oldest first) to ensure consistent ordering
    const sortedSnapshots = [...allSnapshots].sort((a, b) => {
      const dateA = new Date(a.date || a.snapshot_date);
      const dateB = new Date(b.date || b.snapshot_date);
      return dateA - dateB; // Ascending order (oldest to newest)
    });

    // Process snapshots (now guaranteed oldest to newest)
    for (let i = 0; i < sortedSnapshots.length; i++) {
      const snapshot = sortedSnapshots[i];
      
      // Handle different date field names
      const dateStr = snapshot.date || snapshot.snapshot_date;
      if (!dateStr) continue;
      
      const date = new Date(dateStr);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      rawDates.push(dateStr);
      
      // Extract value - handle revenue from transaction endpoint vs snapshot endpoint
      let value = 0;
      if (selectedCategory === 'revenue') {
        // Revenue from transactions endpoint uses 'revenue' field
        value = snapshot.revenue || snapshot[metric.field] || 0;
      } else {
        // Other categories use their specific fields
        value = snapshot[metric.field] || 0;
      }
      
      data.push(value);
    }

    console.log(`✅ Processed ${data.length} data points`);
    console.log(`   First date: ${rawDates[0]}, Last date: ${rawDates[rawDates.length - 1]}`);
    console.log(`   First value: ${data[0]}, Last value: ${data[data.length - 1]}`);

    chartData = { labels, data, rawDates };
    
    // Chart will be rendered by reactive statement when canvas is ready
  }

  function renderChart() {
    if (!chartCanvas) {
      console.warn('⚠️ Canvas not ready yet');
      return;
    }

    // Destroy existing chart
    if (chartInstance) {
      chartInstance.destroy();
    }

    const category = categories[selectedCategory];
    const metric = availableMetrics.find(m => m.id === selectedMetric);

    if (!category || !metric) {
      console.error('❌ Invalid category or metric');
      return;
    }

    console.log(`🎨 Rendering chart for ${category.label} - ${metric.label}`);

    // Create gradient
    const ctx = chartCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, category.color.replace('rgb', 'rgba').replace(')', ', 0.3)'));
    gradient.addColorStop(1, category.color.replace('rgb', 'rgba').replace(')', ', 0.05)'));

    // Create chart
    chartInstance = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: metric.label,
          data: chartData.data,
          borderColor: category.color,
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: category.color,
          pointBorderColor: '#0a0e17',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: category.color,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 23, 0.95)',
            titleColor: '#00ffff',
            bodyColor: '#ffffff',
            borderColor: category.color,
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: (items) => {
                return items[0].label;
              },
              label: (context) => {
                const value = context.parsed.y;
                if (metric.format === 'flux') {
                  return value.toFixed(0) + ' FLUX';
                } else if (metric.format === 'percent') {
                  return value.toFixed(0) + '%';
                }
                return Math.round(value);
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(139, 146, 176, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#8b92b0',
              font: {
                family: "'Courier New', monospace",
                size: 10
              },
              maxRotation: 45,
              minRotation: 45
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(139, 146, 176, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#8b92b0',
              font: {
                family: "'Courier New', monospace",
                size: 11
              },
              callback: function(value) {
                if (metric.format === 'flux') {
                  return value.toFixed(0) + ' FLUX';
                } else if (metric.format === 'percent') {
                  return value.toFixed(0) + '%';
                }
                return Math.round(value);
              }
            }
          }
        }
      }
    });

    console.log('✅ Chart rendered successfully');
  }

  function handleCategoryChange(categoryId) {
    console.log(`👆 User clicked category: ${categoryId}`);
    selectedCategory = categoryId;
    // Fetch new data when category changes (revenue vs snapshots)
    fetchAllData();
  }

  function handleMetricChange(event) {
    selectedMetric = event.target.value;
  }

  function handleTimeframeChange(event) {
    selectedTimeframe = event.target.value;
  }

  // CSV Export Function
  function exportToCSV() {
    if (!chartData || chartData.labels.length === 0) {
      console.warn('⚠️ No data to export');
      return;
    }

    const metric = availableMetrics.find(m => m.id === selectedMetric);
    const category = categories[selectedCategory];
    
    if (!metric || !category) return;

    // Build CSV content
    const headers = ['Date', metric.label, 'Category', 'Timeframe'];
    const rows = chartData.rawDates.map((date, index) => {
      const value = chartData.data[index];
      return [
        date,
        value,
        category.label,
        selectedTimeframe
      ];
    });

    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `flux_${selectedCategory}_${selectedMetric}_${selectedTimeframe}_${timestamp}.csv`;
    
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
    
    console.log(`📥 Exported ${chartData.labels.length} records to ${filename}`);
  }
</script>

<div class="chart-container terminal-border">
  <!-- Header with Controls -->
  <div class="chart-header">
    <div class="chart-title-section">
      <h3 class="chart-title">{title}</h3>
      {#if !loading && !error}
        <span class="chart-subtitle">
          {categories[selectedCategory]?.icon} 
          {availableMetrics.find(m => m.id === selectedMetric)?.label || ''}
        </span>
        {/if}
    </div>

    <div class="chart-controls">
      <!-- Timeframe Selector -->
      <div class="control-group">
        <label for="timeframe-{title}">Period:</label>
        <select 
          id="timeframe-{title}"
          bind:value={selectedTimeframe}
          on:change={handleTimeframeChange}
          class="chart-select"
        >
          {#each timeframes as timeframe}
            <option value={timeframe.id}>{timeframe.label}</option>
          {/each}
        </select>
      </div>

      <!-- Metric Selector -->
      <div class="control-group">
        <label for="metric-{title}">Metric:</label>
        <select 
          id="metric-{title}"
          bind:value={selectedMetric}
          on:change={handleMetricChange}
          class="chart-select"
        >
          {#each availableMetrics as metric}
            <option value={metric.id}>{metric.label}</option>
          {/each}
        </select>
      </div>

      <!-- CSV Export Button -->
      {#if !loading && !error && chartData.labels.length > 0}
        <button 
          class="export-btn" 
          on:click={exportToCSV}
          title="Export chart data to CSV"
        >
        <span class="export-icon">📥</span>
          <span class="export-text">CSV</span>
      </button>
      {/if}
    </div>
  </div>

  <!-- Category Pills -->
  <div class="category-pills">
    {#each Object.entries(categories) as [id, category]}
      <button
        class="category-pill"
        class:active={selectedCategory === id}
        on:click={() => handleCategoryChange(id)}
        style="--category-color: {category.color}"
      >
        <span class="category-icon">
          {#if id === 'revenue'}
            <DollarSign size={16} strokeWidth={2} />
          {:else if id === 'gaming'}
            <Gamepad2 size={16} strokeWidth={2} />
          {:else if id === 'crypto'}
            <Coins size={16} strokeWidth={2} />
          {:else if id === 'nodes'}
            <Server size={16} strokeWidth={2} />
          {:else if id === 'resources'}
            <Cloud size={16} strokeWidth={2} />
          {:else if id === 'apps'}
            <Package size={16} strokeWidth={2} />
          {/if}
        </span>
        <span class="category-label">{category.label}</span>
      </button>
    {/each}
  </div>

  <!-- Chart Area -->
  <div class="chart-wrapper" style="height: {height}px">
    {#if loading}
      <div class="chart-loading">
        <div class="loading-spinner"></div>
        <p>Loading chart data...</p>
      </div>
    {:else if error}
      <div class="chart-error">
        <span class="error-icon">⚠️</span>
        <p>{error}</p>
      </div>
    {:else}
      <canvas bind:this={chartCanvas}></canvas>
    {/if}
  </div>
</div>

<style>
  .chart-container {
    background: var(--bg-secondary);
    padding: var(--spacing-lg);
    border-radius: var(--radius-md);
    margin: var(--spacing-xl) 0;
  }

  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-lg);
    gap: var(--spacing-md);
    flex-wrap: wrap;
  }

  .chart-title-section {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .chart-title {
    font-size: 1.25rem;
    color: var(--text-primary);
    margin: 0;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .chart-subtitle {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-family: 'Courier New', monospace;
  }

  .chart-controls {
    display: flex;
    gap: var(--spacing-md);
    align-items: center;
    flex-wrap: wrap;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
  }

  .control-group label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .chart-select {
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

  .chart-select:hover {
    border-color: var(--accent-cyan);
  }

  .chart-select:focus {
    outline: none;
    border-color: var(--accent-cyan);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.2);
  }

  /* Export Button */
  .export-btn {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-white);
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
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
    font-size: 1rem;
  }

  .export-text {
    font-size: 0.75rem;
  }

  /* Category Pills */
  .category-pills {
    display: flex;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-lg);
    flex-wrap: wrap;
  }

  .category-pill {
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-white);
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-family: 'Courier New', monospace;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .category-pill:hover {
    border-color: var(--category-color);
    background: var(--category-color);
    background: color-mix(in srgb, var(--category-color) 10%, transparent);
  }

  .category-pill.active {
    border-color: var(--category-color);
    background: var(--category-color);
    background: color-mix(in srgb, var(--category-color) 20%, transparent);
    box-shadow: 0 0 10px var(--category-color);
  }

  .category-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .category-icon :global(svg) {
    color: var(--text-primary);
    filter: drop-shadow(0 0 5px rgba(0, 255, 255, 0.3));
    transition: all 0.3s ease;
  }

  .category-pill:hover .category-icon :global(svg) {
    filter: drop-shadow(0 0 10px rgba(0, 255, 255, 0.5));
    transform: scale(1.05);
  }

  .category-pill.active .category-icon :global(svg) {
    filter: drop-shadow(0 0 10px var(--category-color));
  }

  .category-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Chart Wrapper */
  .chart-wrapper {
    position: relative;
    width: 100%;
  }

  .chart-loading,
  .chart-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
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

  /* Responsive */
  @media (max-width: 768px) {
    .chart-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .chart-controls {
      width: 100%;
      justify-content: space-between;
    }

    .control-group {
      flex: 1;
      min-width: 120px;
    }

    .export-btn {
      width: 100%;
      justify-content: center;
    }

    .category-pills {
      gap: var(--spacing-xs);
    }

    .category-pill {
      flex: 1;
      justify-content: center;
      min-width: 100px;
    }
  }
</style>
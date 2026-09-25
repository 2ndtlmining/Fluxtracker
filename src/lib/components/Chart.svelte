<script>
  import { onMount, onDestroy } from 'svelte';
  import { cssomStyle } from '$lib/actions/cssomStyle.js';
  import { loadChartJs } from '$lib/utils/loadChartJs.js';
  import { getApiUrl } from '$lib/config.js';
  import { formatCount, formatNumber, formatUsd } from '$lib/utils/format.js';
  import { buildGameMetrics, buildGameSnapshots, GAMING_TOTAL_METRIC } from '$lib/utils/gameSeries.js';
  import { mixFields } from '$lib/utils/revenueSources.js';
  import { DollarSign, Server, Cloud, Package, Globe, Download, Users, Gamepad2 } from 'lucide-svelte';

  // Props
  export let title = 'Historical Data';
  export let height = 400;
  // See cssomStyle: the CSP blocks inline style attributes, so dynamic styles in this app
  // must be written through the CSSOM or they are silently dropped.
  export let defaultCategory = 'revenue';
  export let defaultTimeframe = '30d';

  // IMPORTANT: API_URL must be set in onMount(), not here!
  let API_URL = '';

  // State
  let chartCanvas;
  let chartInstance = null;
  // Chart.js arrives on demand (issue #297): it was ~59% of the single page chunk and sat on
  // the critical path of first paint. Null until loaded; rendering waits for it.
  let ChartJS = null;
  let loading = true;
  let error = null;

  // Selected filters
  let selectedCategory = defaultCategory;
  let selectedMetric = null;
  let selectedTimeframe = defaultTimeframe;
  let selectedAggregation = 'daily'; // NEW: aggregation selector

  // Cached data - fetch once, reuse many times
  let allSnapshots = [];
  let chartData = { labels: [], data: [], rawDates: [] };
  let availableMetrics = [];

  // Decentralization entity search (issue #138 follow-up): search-and-select a single
  // country/continent/datacenter to trend over time, similar to the removed docker_repos
  // search feature (see git history pre-#109's Chart.svelte). Unlike that feature, this
  // needs only ONE fetch per timeframe: /api/decentralization/history already returns
  // every entity's daily counts for every dimension in one response, so switching the
  // selected entity (or Qty/% toggle) just re-derives allSnapshots client-side -- no
  // per-entity network round trip.
  let decentralizationView = 'overview'; // 'overview' | 'country' | 'continent' | 'datacenter'
  let decentralizationHistory = null; // raw /api/decentralization/history response, cached per timeframe
  let entityList = [];
  let entitySearchQuery = '';
  let selectedEntity = null;
  let showEntityDropdown = false;
  let filteredEntityList = [];
  let entityValueType = 'qty'; // 'qty' | 'percent'

  // Gaming (issue #175): like the decentralization entity search above, ONE fetch per
  // timeframe serves the whole category -- /api/history/games returns every game's daily
  // counts plus the network-wide total in a single response, so switching game in the
  // metric dropdown is a client-side re-derive with no network round trip.
  let gameHistory = null; // raw /api/history/games response, cached per timeframe

  // /api/history/snapshots/full backs every snapshot category (nodes, cloud, apps, ...), and
  // each category click used to download it again -- up to ~0.8 MB raw at "All" (issue #303).
  // Kept per limit for a few minutes, so moving between those categories is a re-derive.
  const SNAPSHOT_CACHE_MS = 5 * 60 * 1000;
  let snapshotCache = null; // { limit, rows, at }

  // The metric list and the per-day series both live in $lib/utils/gameSeries.js -- the
  // gap-vs-zero rule they implement is the point of the feature and is unit-tested there.
  // Every gaming metric reads the same `game_instances` field, so processChartData() needs
  // no gaming-specific branch.

  const ENTITY_DIMENSIONS = {
    country: { label: 'Country', pluralLabel: 'Countries', historyKey: 'countryHistory', nameField: 'country' },
    continent: { label: 'Continent', pluralLabel: 'Continents', historyKey: 'continentHistory', nameField: 'continent' },
    datacenter: { label: 'Datacenter', pluralLabel: 'Datacenters', historyKey: 'history', nameField: 'org' }
  };
  // 'Overview' (the existing headline metrics) plus one toggle per ENTITY_DIMENSIONS entry.
  const DECENTRALIZATION_VIEWS = [
    { id: 'overview', label: 'Overview' },
    ...Object.entries(ENTITY_DIMENSIONS).map(([id, dim]) => ({ id, label: dim.pluralLabel }))
  ];

  // Locked collateral runs to ~90M FLUX (issue #210), and cumulative revenue is in the
  // millions too. `toFixed(0)` on those produces a nine-character axis label that crowds
  // the plot area, so the axis compacts and the tooltip keeps the exact figure.
  //
  // Both go through the shared formatters (issue #323): upper-case K/M like the cards, and
  // thousands separators on USD and counts, which the tooltip and axis used to lack.
  function formatChartValue(value, format, { axis = false } = {}) {
    if (format === 'flux') {
      return (axis ? formatCount(value, { compact: true }) : formatCount(value)) + ' FLUX';
    }
    if (format === 'usd') {
      return axis ? '$' + formatCount(value, { compact: true }) : formatUsd(value, { compact: false });
    }
    if (format === 'percent') return formatNumber(value, 2) + '%';
    return axis ? formatCount(value, { compact: true }) : formatCount(value);
  }

  // prefers-reduced-motion (issue #324): Chart.js animates every redraw by default.
  const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Category definitions
  let categories = {
    revenue: {
      label: 'Revenue',
      color: 'rgb(0, 255, 255)',
      metrics: [
        { id: 'daily_revenue', label: 'Daily Revenue (FLUX)', field: 'daily_revenue', format: 'flux' },
        { id: 'daily_revenue_usd', label: 'Daily Revenue ($)', field: 'daily_revenue_usd', format: 'usd' },
        { id: 'cumulative_revenue', label: 'Cumulative Revenue (FLUX)', field: 'daily_revenue', format: 'flux', cumulative: true },
        { id: 'cumulative_revenue_usd', label: 'Cumulative Revenue ($)', field: 'daily_revenue_usd', format: 'usd', cumulative: true }
      ]
    },
    nodes: {
      label: 'Node Distribution',
      color: 'rgb(0, 255, 65)',
      metrics: [
        { id: 'node_total', label: 'Total Nodes', field: 'node_total', format: 'number' },
        { id: 'node_cumulus', label: 'Cumulus Nodes', field: 'node_cumulus', format: 'number' },
        { id: 'node_nimbus', label: 'Nimbus Nodes', field: 'node_nimbus', format: 'number' },
        { id: 'node_stratus', label: 'Stratus Nodes', field: 'node_stratus', format: 'number' },
        // Issue #201. dropNulls because every snapshot predating this feature -- and the
        // 37 days the imported history has no reading for -- stores NULL, and plotting
        // those as 0 would draw a network with no operators rather than a gap.
        { id: 'unique_wallets', label: 'Unique Wallets', field: 'unique_wallets', format: 'number', dropNulls: true },
        // Issue #210. Metrics of this category rather than a category of their own: they
        // are derived from the tier counts directly above them, and a seventh top-level
        // button costs more space than the grouping saves. The unit is per-metric -- the
        // axis and tooltip both read `metric.format` -- so FLUX amounts and node counts
        // sit in one dropdown without either rendering in the other's unit.
        //
        // No aggregateAsSum. Locked collateral is a LEVEL, not a flow -- summing a week of
        // daily readings would report seven times the FLUX that was ever locked. The
        // default average is the right weekly/monthly figure.
        //
        // dropNulls for the same reason as unique_wallets above: rows predating the
        // feature, and the days with no tier counts to derive from, store NULL. Plotting
        // those as 0 would draw a network with nothing staked rather than a gap.
        { id: 'locked_collateral', label: 'Total Locked (FLUX)', field: 'locked_collateral', format: 'flux', dropNulls: true },
        { id: 'locked_collateral_cumulus', label: 'Cumulus Locked (FLUX)', field: 'locked_collateral_cumulus', format: 'flux', dropNulls: true },
        { id: 'locked_collateral_nimbus', label: 'Nimbus Locked (FLUX)', field: 'locked_collateral_nimbus', format: 'flux', dropNulls: true },
        { id: 'locked_collateral_stratus', label: 'Stratus Locked (FLUX)', field: 'locked_collateral_stratus', format: 'flux', dropNulls: true }
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
        { id: 'ram_total', label: 'Total Ram TB', field: 'total_ram_gb', format: 'number' },
        { id: 'storage_total', label: 'Total Storage TB', field: 'total_storage_gb', format: 'number' },
        { id: 'cpu_used', label: 'Used CPU cores', field: 'used_cpu_cores', format: 'number' },
        { id: 'ram_used', label: 'Used Ram TB', field: 'used_ram_gb', format: 'number' },
        { id: 'storage_used', label: 'Used Storage TB', field: 'used_storage_gb', format: 'number' },
        // Issue #347: not a history but a forecast -- see PROJECTION_METRIC below.
        { id: 'utilization_projection', label: 'Utilization Projection', field: null, format: 'number', projection: true },
      ]
    },
    apps: {
      // Only the true instance census (unaffected by FluxOS v8.18 — see runningAppsProvider.js).
      // wordpress_count, gitapps_count/percent, dockerapps_count/percent all derive from
      // resolved-image categorization, which only covers ~76-78% of running instances since
      // the API dropped Image — removed rather than shown as an undercount (issue #106).
      label: 'Applications',
      color: 'rgb(255, 100, 255)',
      metrics: [
        { id: 'total_apps', label: 'Total Applications', field: 'total_apps', format: 'number', group: 'Daily' },
        { id: 'apps_deployed_today', label: 'New/Updated Today', field: 'apps_deployed_today', format: 'number', group: 'Daily' },
        { id: 'apps_expiring_today', label: 'Expiring Today', field: 'apps_expiring_today', format: 'number', group: 'Daily' },
        // Issue #209. dropNulls for the same reason as unique_wallets: every snapshot
        // predating this feature stores NULL, and plotting those as 0 would draw a
        // network with no app operators rather than a gap in the record.
        { id: 'unique_app_owners', label: 'Unique App Owners', field: 'unique_app_owners', format: 'number', dropNulls: true, group: 'Daily' },
        // Issue #264: retention cohorts, by the month an app was registered (migration 022).
        // Survival counts only apps old enough to know, so a young cohort shows a gap (null,
        // dropped) rather than 0%. Monthly only -- a cohort is a calendar month. The owner's
        // review (2026-09-25) cut 30/180-day survival, "paid again" and "still active today":
        // 30 days measured plan length (a 1-month plan survives it automatically), and the
        // others were confounded by cohort age or too sparse to read.
        { id: 'cohort_new_apps', label: 'New apps registered (per month)', field: 'new_apps', format: 'number', aggregateAsSum: true, monthlyOnly: true, source: 'cohorts', group: 'By month registered',
          description: 'Apps registered for the first time each month. A name reused after it expired counts again.' },
        { id: 'cohort_survival_90', label: 'Still running after 3 months (%)', field: 'survival_90_percent', format: 'percent', ratioFields: { numerator: 'survived_90', denominator: 'eligible_90' }, dropNulls: true, monthlyOnly: true, source: 'cohorts', group: 'By month registered',
          description: 'Of the apps registered each month, the share still paid for 3 months later. Months less than 3 months ago are not shown yet.',
          emptyMessage: 'No month in this period is 3 months old yet. Choose a longer period (6 months or more).' }
      ]
    },
    decentralization: {
      label: 'Decentralization',
      color: 'rgb(255, 180, 0)',
      metrics: [
        { id: 'dc_count', label: 'Quantity Datacenters', field: 'decentralization_datacenter_count', format: 'number' },
        { id: 'indep_count', label: 'Quantity Independent', field: 'decentralization_independent_count', format: 'number' },
        { id: 'dc_percent', label: '% Datacenter', field: 'decentralization_datacenter_percent', format: 'percent' },
        { id: 'indep_percent', label: '% Independent', field: 'decentralization_datacenter_percent', format: 'percent', invert: true },
        { id: 'decentralization_percent', label: 'Decentralization %', field: 'decentralization_datacenter_percent', format: 'percent', invert: true }
      ]
    },
    gaming: {
      // Issue #175. Deliberately NOT gaming_apps_total: that is the older image-only count
      // which misses ~25% of instances (enterprise-encrypted specs carry no image), and is
      // kept on daily_snapshots only so the pre-existing Applications trend stays
      // continuous. Two series both labelled "gaming" but differing by 100+ would mislead.
      label: 'Gaming',
      color: 'rgb(189, 147, 249)', // --accent-purple, matching the Gaming card's icon
      metrics: [GAMING_TOTAL_METRIC]
    },
    team_funded: {
      // Issue #146: Flux team's own FLUX_TEAM_ADDRESSES spend, trended daily -- FLUX amount,
      // $ amount, and % of that day's total revenue, so a rising share is visible over time.
      // Transaction-based (like Revenue), not snapshot-based, so full history is available
      // immediately rather than only from whenever snapshotting started.
      //
      // Issue #261 widened it into Revenue Sources: who paid -- organic (real on-chain
      // customers), the fiat on-ramp, or the Flux team. Organic is the remainder, so the three
      // add up to total revenue. The category id stays team_funded so existing links keep
      // working. Percentages are shares of total FLUX, like the Revenue card's.
      label: 'Revenue Sources',
      color: 'rgb(255, 215, 0)',
      metrics: [
        // Who paid (issue #261): organic is the remainder, so the three add up to total revenue.
        // Percentages are shares of total FLUX. Weekly/monthly % views sum numerator and
        // denominator separately and divide afterwards (ratioFields), never average daily %.
        { id: 'organic_usd', label: 'Organic ($)', field: 'organic_usd', format: 'usd', aggregateAsSum: true, group: 'Who paid', description: 'Paid by ordinary customer wallets -- everyone except the Flux team and the fiat on-ramp.' },
        { id: 'organic_flux', label: 'Organic (FLUX)', field: 'organic_flux', format: 'flux', aggregateAsSum: true, group: 'Who paid', description: 'Paid by ordinary customer wallets -- everyone except the Flux team and the fiat on-ramp.' },
        { id: 'organic_percent', label: 'Organic (% of Revenue)', field: 'organic_percent', format: 'percent', ratioFields: { numerator: 'organic_flux', denominator: 'total_flux' }, group: 'Who paid', description: 'Paid by ordinary customer wallets -- everyone except the Flux team and the fiat on-ramp.' },
        { id: 'fiat_usd', label: 'Fiat on-ramp ($)', field: 'fiat_usd', format: 'usd', aggregateAsSum: true, group: 'Who paid', description: 'Paid through the fiat on-ramp, which buys FLUX for customers paying by card.' },
        { id: 'fiat_flux', label: 'Fiat on-ramp (FLUX)', field: 'fiat_flux', format: 'flux', aggregateAsSum: true, group: 'Who paid', description: 'Paid through the fiat on-ramp, which buys FLUX for customers paying by card.' },
        { id: 'fiat_percent', label: 'Fiat on-ramp (% of Revenue)', field: 'fiat_percent', format: 'percent', ratioFields: { numerator: 'fiat_flux', denominator: 'total_flux' }, group: 'Who paid', description: 'Paid through the fiat on-ramp, which buys FLUX for customers paying by card.' },
        { id: 'team_funded_usd', label: 'Team Funded ($)', field: 'team_funded_usd', format: 'usd', aggregateAsSum: true, group: 'Who paid', description: 'Paid by Flux team addresses. Already included in total revenue, never subtracted.' },
        { id: 'team_funded_flux', label: 'Team Funded (FLUX)', field: 'team_funded_flux', format: 'flux', aggregateAsSum: true, group: 'Who paid', description: 'Paid by Flux team addresses. Already included in total revenue, never subtracted.' },
        { id: 'team_funded_percent', label: 'Team Funded (% of Revenue)', field: 'team_funded_percent', format: 'percent', ratioFields: { numerator: 'team_funded_flux', denominator: 'total_flux' }, group: 'Who paid', description: 'Paid by Flux team addresses. Already included in total revenue, never subtracted.' },
        // What was bought (issue #262), from each payment's permanent message (migration 019).
        // The ~3% of payments never matched to a message sit in the total only.
        { id: 'mix_new_usd', label: 'New deployments ($)', field: 'new_usd', format: 'usd', aggregateAsSum: true, needsMix: true, group: 'What was bought', description: 'Payments that registered a brand-new app.' },
        { id: 'mix_new_percent', label: 'New deployments (% of Revenue)', field: 'mix_new_percent', format: 'percent', ratioFields: { numerator: 'new_flux', denominator: 'total_flux' }, needsMix: true, group: 'What was bought', description: 'Payments that registered a brand-new app. Share of revenue that day; about 3% of payments cannot be classified, so the shares add up to just under 100%.' },
        { id: 'mix_update_usd', label: 'Renewals & updates ($)', field: 'update_usd', format: 'usd', aggregateAsSum: true, needsMix: true, group: 'What was bought', description: 'Payments that renewed or changed an app that was already running.' },
        { id: 'mix_update_percent', label: 'Renewals & updates (% of Revenue)', field: 'mix_update_percent', format: 'percent', ratioFields: { numerator: 'update_flux', denominator: 'total_flux' }, needsMix: true, group: 'What was bought', description: 'Payments that renewed or changed an app that was already running. Share of revenue that day; about 3% of payments cannot be classified, so the shares add up to just under 100%.' },
        { id: 'mix_enterprise_usd', label: 'Private (enterprise) apps ($)', field: 'enterprise_usd', format: 'usd', aggregateAsSum: true, needsMix: true, group: 'What was bought', description: 'Payments for private (enterprise) apps, whose specs are encrypted.' },
        { id: 'mix_enterprise_percent', label: 'Private (enterprise) apps (% of Revenue)', field: 'mix_enterprise_percent', format: 'percent', ratioFields: { numerator: 'enterprise_flux', denominator: 'total_flux' }, needsMix: true, group: 'What was bought', description: 'Payments for private (enterprise) apps, whose specs are encrypted. Share of revenue that day.' },
        // Paying customers (issue #267): distinct wallets, team and fiat on-ramp excluded.
        // Counted per calendar month -- distinct wallets cannot be summed from daily counts --
        // so these force the Monthly view.
        { id: 'payers_total', label: 'Paying customers (per month)', field: 'payers', format: 'number', aggregateAsSum: true, monthlyOnly: true, group: 'Paying customers', description: 'Distinct wallets that paid for apps that month, not counting the Flux team or the fiat on-ramp.' },
        { id: 'payers_new', label: 'New paying customers (per month)', field: 'new_payers', format: 'number', aggregateAsSum: true, monthlyOnly: true, group: 'Paying customers', description: 'Wallets whose first-ever payment was that month.' },
        { id: 'payers_returning', label: 'Returning paying customers (per month)', field: 'returning_payers', format: 'number', aggregateAsSum: true, monthlyOnly: true, group: 'Paying customers', description: 'Wallets that paid that month and had paid before.' }
      ]
    }
  };

  // Timeframe options (days: null = fetch all available data)
  const timeframes = [
    { id: '7d', label: '7 Days', days: 7 },
    { id: '14d', label: '14 Days', days: 14 },
    { id: '30d', label: '30 Days', days: 30 },
    { id: '60d', label: '60 Days', days: 60 },
    { id: '90d', label: '90 Days', days: 90 },
    { id: '1Y', label: '1 Year', days: 365 },
    { id: 'all', label: 'All', days: null },
  ];

  // NEW: Aggregation options
  const aggregations = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' }
  ];

  // Update available metrics when category changes. Entity-search mode (decentralization
  // country/continent/datacenter) builds its own synthetic Qty/% metrics below instead --
  // skip the normal fixed-column list so it doesn't fight that block for selectedMetric.
  $: {
    if (selectedCategory && categories[selectedCategory] && !(selectedCategory === 'decentralization' && decentralizationView !== 'overview')) {
      availableMetrics = categories[selectedCategory].metrics;
      if (!selectedMetric || !availableMetrics.find(m => m.id === selectedMetric)) {
        selectedMetric = availableMetrics[0]?.id;
      }
    }
  }

  // Entity-search mode's own metric pair -- reruns whenever the selected entity or
  // dimension changes so the label (and the subtitle it drives) stays current.
  $: if (selectedCategory === 'decentralization' && decentralizationView !== 'overview') {
    const dim = ENTITY_DIMENSIONS[decentralizationView];
    const entityLabel = selectedEntity || `Select a ${dim.label.toLowerCase()}`;
    availableMetrics = [
      { id: 'entity_qty', label: `${entityLabel} — Quantity`, field: 'instance_count', format: 'number' },
      { id: 'entity_percent', label: `${entityLabel} — % of classified`, field: 'instance_percent', format: 'percent' }
    ];
    selectedMetric = entityValueType === 'qty' ? 'entity_qty' : 'entity_percent';
  }

  // ---- Utilization Projection (issue #347), a Cloud Resources metric. Not a history: it is
  // what the network would still run on each coming day if no app renewed, from every app
  // spec's expiry. Selecting it retitles the chart, hides View/Period (they describe the
  // past), and draws two lines -- app instances (every app) and CPU cores (only specs whose
  // resources are readable; encrypted game-site specs hide theirs, and the note says so).
  const PROJECTION_METRIC = 'utilization_projection';
  let projection = null;
  let projectionError = null;

  // Paying-wallet metrics (issue #267) are monthly by nature; selecting one pins View to
  // Monthly. payersAvailable is false when the database lacks migration 018 -- then the
  // chart says so instead of plotting a row of zeros.
  let payersAvailable = null;
  let cohortsAvailable = null; // the same, for retention cohorts and migration 022 (#264)
  let mixAvailable = null; // the same, for the revenue-mix metrics and migration 020 (#262)
  $: currentMetric = availableMetrics.find(m => m.id === selectedMetric);
  $: if (currentMetric?.monthlyOnly && selectedAggregation !== 'monthly') selectedAggregation = 'monthly';
  $: payerError = currentMetric?.monthlyOnly && !currentMetric.source && payersAvailable === false
    ? 'Paying-wallet data is not available yet (database migration 018 not applied)'
    : currentMetric?.needsMix && mixAvailable === false
      ? 'Revenue mix data is not available yet (database migration 020 not applied)'
      : currentMetric?.source === 'cohorts' && cohortsAvailable === false
        ? 'Retention data is not available yet (database migration 022 not applied)'
        : null;

  // True when this metric's data needs a migration the database does not have yet.
  function awaitingMigration(metric) {
    return (metric?.monthlyOnly && !metric.source && payersAvailable === false)
      || (metric?.needsMix && mixAvailable === false)
      || (metric?.source === 'cohorts' && cohortsAvailable === false);
  }

  // The metric dropdown in groups (<optgroup>), in order of first appearance. Metrics with no
  // group render as plain options, so categories that never set one look as before.
  $: metricGroups = availableMetrics.reduce((groups, metric) => {
    const name = metric.group ?? null;
    let group = groups.find(g => g.name === name);
    if (!group) groups.push(group = { name, metrics: [] });
    group.metrics.push(metric);
    return groups;
  }, []);

  $: isProjection = selectedMetric === PROJECTION_METRIC;
  $: displayTitle = isProjection ? 'Utilization Projection' : title;

  const projectionDate = iso => {
    const [, m, d] = String(iso).split('-').map(Number);
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
  };

  async function loadProjection() {
    try {
      const response = await fetch(`${API_URL}/api/cloud/utilization-projection`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!body?.available) throw new Error('projection unavailable');
      projection = body;
      projectionError = null;
    } catch (err) {
      console.error('Error fetching utilization projection:', err);
      projectionError = 'Projection unavailable right now';
    }
  }

  $: projectionSummary = projection
    ? `If no app renews: ${formatCount(projection.drops.d7.instances)} instances gone in 7 days, `
      + `${formatCount(projection.drops.d30.instances)} of ${formatCount(projection.today.instances)} within 30 days`
    : '';

  // When metric changes, check if we need to re-fetch (FLUX vs USD uses different endpoints)
  let lastMetric = selectedMetric;
  // A metric that came back empty (cohorts before migration 022) still has to be
  // able to switch away -- otherwise the next metric draws whatever chartData was left over.
  const metricSource = id => {
    const metric = Object.values(categories).flatMap(c => c.metrics).find(m => m.id === id);
    return metric?.source ?? null;
  };
  $: if (selectedMetric !== lastMetric && (allSnapshots.length > 0 || (metricSource(lastMetric) && !loading))) {
    // Check if switching between FLUX and USD revenue (requires re-fetch)
    const fluxMetrics = ['daily_revenue', 'cumulative_revenue'];
    const usdMetrics = ['daily_revenue_usd', 'cumulative_revenue_usd'];
    const wasUSD = usdMetrics.includes(lastMetric);
    const isNowUSD = usdMetrics.includes(selectedMetric);
    // Cohort metrics have their own endpoint: switching into or out of one
    // re-fetches, whatever the category.
    const needsRefetch = (selectedCategory === 'revenue' && wasUSD !== isNowUSD)
      || metricSource(lastMetric) !== metricSource(selectedMetric);

    if (needsRefetch) {
      console.log(`🔄 Re-fetching data for metric: ${selectedMetric}`);
      lastMetric = selectedMetric;
      fetchAllData();
    } else if (selectedCategory === 'gaming') {
      // Switching game re-derives from the cached payload -- no fetch. allSnapshots holds
      // one series at a time, so it has to be rebuilt before the data is reprocessed.
      lastMetric = selectedMetric;
      allSnapshots = buildGameSnapshots(gameHistory, selectedMetric);
      processChartData();
    } else {
      console.log(`📄 Metric changed to ${selectedMetric} - processing cached data`);
      lastMetric = selectedMetric;
      processChartData();
    }
  }
  
  // When category changes, process existing data
  $: if (selectedCategory && allSnapshots.length > 0) {
    processChartData();
  }

  // NEW: Watch for aggregation changes
  $: if (selectedAggregation) {
    console.log(`📊 Aggregation changed to ${selectedAggregation}`);
    if (allSnapshots.length > 0) {
      processChartData();
    }
  }

  // Text alternative for the canvas (issue #326): what is plotted, over which range, and
  // where it ends. Declared AFTER the blocks that call processChartData(): Svelte cannot see
  // the chartData assignment inside that function, so declared earlier it ran first in each
  // flush and described the previous metric's data under the new metric's label.
  $: chartAriaLabel = isProjection ? `Utilization projection. ${projectionSummary}` : (() => {
    const metric = availableMetrics.find(m => m.id === selectedMetric);
    const range = timeframes.find(t => t.id === selectedTimeframe)?.label ?? selectedTimeframe;
    const points = chartData.data.length;
    const parts = [
      `${categories[selectedCategory]?.label ?? 'Chart'}: ${metric?.label ?? ''}`,
      `${range}, ${selectedAggregation}`
    ];
    if (points > 0) {
      parts.push(`latest ${formatChartValue(chartData.data[points - 1], metric?.format)} on ${chartData.labels[points - 1]}`);
    }
    return parts.join('. ');
  })();

  // When canvas becomes available and we have data, render the chart
  $: if (chartCanvas && ChartJS && chartData.labels.length > 0 && !loading) {
    console.log('🎨 Canvas ready and data available - rendering initial chart');
    renderChart();
  }

  // When timeframe changes, fetch new data
  let lastTimeframe = selectedTimeframe;
  $: if (selectedTimeframe !== lastTimeframe) {
    console.log(`⏱️ Timeframe changed from ${lastTimeframe} to ${selectedTimeframe} - fetching new data`);
    lastTimeframe = selectedTimeframe;
    // Invalidate the cached decentralization history unconditionally, not just when
    // currently viewing an entity-search tab: fetchAllData()'s decentralization branch only
    // runs for decentralizationView !== 'overview', so a timeframe change made while on
    // Overview left the old timeframe's payload sitting in decentralizationHistory.
    // handleDecentralizationViewChange() then trusted that stale cache as "already have
    // this timeframe" the next time the user switched into Countries/Continents/Datacenters,
    // rendering the wrong period under the new timeframe's label/CSV filename.
    decentralizationHistory = null;
    // Same reasoning as decentralizationHistory above: the cache is keyed by nothing but
    // "we already fetched", so a timeframe change has to drop it or the next visit to
    // Gaming renders the previous period under the new period's label.
    gameHistory = null;
    fetchAllData();
  }

  onMount(async () => {
    // Get API URL in browser context
    API_URL = getApiUrl();

    // The library download and the data fetch run in parallel; whichever finishes last
    // triggers the first render through the reactive block above.
    loadChartJs()
      .then(lib => { ChartJS = lib; })
      .catch(err => {
        console.error('Could not load the chart library:', err);
        error = 'Chart library failed to load';
      });
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
      const timeframe = timeframes.find(t => t.id === selectedTimeframe);
      // null days means "all available data" — use a large limit that exceeds any realistic dataset
      const limitParam = timeframe?.days ?? 9999;

      console.log(`📡 Fetching data for ${timeframe?.days === null ? 'ALL time' : limitParam + ' days'}`);

      if (selectedCategory === 'revenue') {
      // For REVENUE category, use transaction-based endpoint for real-time data
        // Check if USD metric is selected
        const metric = availableMetrics.find(m => m.id === selectedMetric);
        const isUSD = metric && (metric.id === 'daily_revenue_usd' || metric.id === 'cumulative_revenue_usd');


        const endpoint = isUSD
          ? `${API_URL}/api/history/revenue/daily-usd?limit=${limitParam}`
          : `${API_URL}/api/history/revenue/daily?limit=${limitParam}`;

        console.log(`💰 Fetching ${isUSD ? 'USD' : 'FLUX'} revenue from transactions (real-time)`);
        const response = await fetch(endpoint);

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
      } else if (selectedCategory === 'decentralization' && decentralizationView !== 'overview') {
        // Entity-search mode: one fetch covers every country/continent/datacenter for the
        // whole timeframe, so switching the selected entity never needs a re-fetch --
        // only a timeframe change lands back here.
        console.log(`🌍 Fetching decentralization ${decentralizationView} history`);
        const response = await fetch(`${API_URL}/api/decentralization/history?days=${limitParam}`);

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        decentralizationHistory = await response.json();
        buildEntityList();

        if (!selectedEntity) {
          // Nothing picked yet -- this is the normal "search and select" placeholder
          // state, not an error, so return before the empty-data check below.
          allSnapshots = [];
          loading = false;
          return;
        }

        allSnapshots = buildEntitySnapshots(selectedEntity);
      } else if (selectedCategory === 'gaming') {
        // One fetch covers every game plus the total for the whole timeframe; only a
        // timeframe change lands back here.
        if (!gameHistory) {
          console.log('🎮 Fetching per-game history');
          const response = await fetch(`${API_URL}/api/history/games?days=${limitParam}`);

          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          gameHistory = await response.json();
          applyGameMetrics();
        }

        allSnapshots = buildGameSnapshots(gameHistory, selectedMetric);

        if (allSnapshots.length === 0) {
          // Collection starts at migration 013, so a fresh (or un-migrated) database has
          // nothing here yet -- and the endpoint degrades to empty rather than 500ing for
          // exactly that case. That is an expected empty state, not a failure: fall through
          // to the placeholder below instead of the red error box every other category
          // would show. chartData is cleared so no stale series from the previous category
          // is left for the render block to draw.
          chartData = { labels: [], data: [], rawDates: [] };
          loading = false;
          return;
        }
      } else if (selectedCategory === 'team_funded') {
        // Team Funded (issue #146): fetch the team-addresses daily trend plus the existing
        // total-revenue-daily endpoint for the same range, then compute % of revenue
        // client-side per day -- same convention as the decentralization entity percentages,
        // never stored. Percent is always share of total FLUX (matches the Revenue card's
        // existing selfFundedShare, which is also FLUX-based, not USD-based).
        console.log('💵 Fetching Team Funded revenue trend');
        const endDate = new Date();
        const endDateStr = endDate.toISOString().split('T')[0];
        const startDateStr = timeframe?.days
          ? (() => {
              // -1: BETWEEN is inclusive on both ends, so "30 Days" must span exactly 30
              // calendar days (today back through today-29), matching the Revenue chart's
              // own convention (getDailyRevenueFromTransactions/UsingUSD subtract days - 1
              // for the same reason) -- subtracting the raw day count here previously
              // fetched 31 days, one more than every sibling chart for the same selection.
              const d = new Date(endDate);
              d.setDate(d.getDate() - (timeframe.days - 1));
              return d.toISOString().split('T')[0];
            })()
          : '2018-01-01'; // 'All' -- predates Flux mainnet, so this just covers every real row

        // One endpoint returns every source per day (issue #261), including days with no
        // team or fiat payment -- so each day's total_flux is always present for the
        // weekly/monthly ratioFields sums below, and no period share is overstated.
        const [sourcesRes, payersRes, mixRes] = await Promise.all([
          fetch(`${API_URL}/api/history/revenue/sources/daily?start_date=${startDateStr}&end_date=${endDateStr}`),
          fetch(`${API_URL}/api/history/revenue/payers/monthly?start_date=${startDateStr}&end_date=${endDateStr}`),
          fetch(`${API_URL}/api/history/revenue/mix/daily?start_date=${startDateStr}&end_date=${endDateStr}`)
        ]);
        if (!sourcesRes.ok) {
          throw new Error('API error fetching Revenue Sources data');
        }
        const sourcesJson = await sourcesRes.json();
        const payersJson = payersRes.ok ? await payersRes.json() : { available: false, data: [] };
        payersAvailable = payersJson.available !== false;
        const payersByMonth = new Map((payersJson.data || []).map(row => [row.month, row]));
        const mixJson = mixRes.ok ? await mixRes.json() : { available: false, data: [] };
        mixAvailable = mixJson.available !== false;
        const mixByDate = new Map((mixJson.data || []).map(row => [row.date, row]));
        const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0); // $0 days: 0%, never NaN

        allSnapshots = (sourcesJson.data || []).map(day => {
          const totalFlux = day.total_flux || 0;
          return {
            date: day.date,
            organic_flux: day.organic_flux || 0,
            organic_usd: day.organic_usd || 0,
            organic_percent: pct(day.organic_flux || 0, totalFlux),
            fiat_flux: day.fiat_flux || 0,
            fiat_usd: day.fiat_usd || 0,
            fiat_percent: pct(day.fiat_flux || 0, totalFlux),
            team_funded_flux: day.team_flux || 0,
            team_funded_usd: day.team_usd || 0,
            team_funded_percent: pct(day.team_flux || 0, totalFlux),
            // Kept alongside the pre-computed daily percent so weekly/monthly aggregation
            // can sum team_funded_flux and total_flux separately and divide afterwards --
            // averaging the daily percentages themselves (as every other percent metric
            // does) understates the real period share whenever revenue is unevenly spread
            // across the days in that period. See the ratioFields handling below.
            total_flux: totalFlux,
            ...mixFields(mixByDate.get(day.date), totalFlux)
          };
        });

        // Paying-wallet counts ride on the first day of each month; the Monthly view sums
        // them, and every other field is left at 0 there so no revenue total is touched. A
        // month whose first day had no revenue gets its own row.
        const byDate = new Map(allSnapshots.map(row => [row.date, row]));
        for (const [month, row] of payersByMonth) {
          const target = byDate.get(month) ?? { date: month, total_flux: 0 };
          target.payers = row.payers;
          target.new_payers = row.new_payers;
          target.returning_payers = row.returning_payers;
          if (!byDate.has(month)) byDate.set(month, target);
        }
        allSnapshots = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      } else if (availableMetrics.find(m => m.id === selectedMetric)?.source === 'cohorts') {
        // Retention cohorts (#264): one row per registration month from their own endpoint.
        const endDateStr = new Date().toISOString().split('T')[0];
        const start = new Date();
        start.setDate(start.getDate() - (limitParam - 1));
        const startDateStr = timeframe?.days ? start.toISOString().split('T')[0] : '2018-01-01';
        const response = await fetch(`${API_URL}/api/history/apps/cohorts?start_date=${startDateStr}&end_date=${endDateStr}`);
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        cohortsAvailable = result.available !== false;
        allSnapshots = result.data || [];
        if (!cohortsAvailable) {
          chartData = { labels: [], data: [], rawDates: [] };
          error = null;
          loading = false;
          return;
        }
      } else {
        // For other categories, use snapshot data -- from the cache when this timeframe's
        // rows are already here (issue #303).
        const cached = snapshotCache && snapshotCache.limit === limitParam
          && Date.now() - snapshotCache.at < SNAPSHOT_CACHE_MS;
        if (cached) {
          allSnapshots = snapshotCache.rows;
        } else {
          const response = await fetch(`${API_URL}/api/history/snapshots/full?limit=${limitParam}`);

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
          snapshotCache = { limit: limitParam, rows: allSnapshots, at: Date.now() };
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

  function formatDateLabel(date, index, allDates, mode) {
    const baseOpts = { month: 'short', day: 'numeric' };
    const base = date.toLocaleDateString('en-US', baseOpts);

    // Check if data spans multiple years
    const firstYear = new Date(allDates[0]).getFullYear();
    const lastYear = new Date(allDates[allDates.length - 1]).getFullYear();
    if (firstYear === lastYear) {
      return mode === 'weekly' ? `Week of ${base}` : base;
    }

    // Multi-year: show year on first label and at year boundaries
    const year = date.getFullYear();
    const shortYear = `'${String(year).slice(2)}`;
    const prevYear = index > 0 ? new Date(allDates[index - 1]).getFullYear() : null;
    const showYear = index === 0 || year !== prevYear;

    const label = showYear ? `${base} ${shortYear}` : base;
    return mode === 'weekly' ? `Week of ${label}` : label;
  }

  function processChartData() {
    if (selectedMetric === PROJECTION_METRIC) {
      if (!projection) {
        loading = true;
        loadProjection().then(() => {
          loading = false;
          if (projection) processChartData();
          else error = projectionError;
        });
        return;
      }
      error = null;
      chartData = {
        labels: projection.points.map(p => projectionDate(p.date)),
        data: projection.points.map(p => p.instances),
        cpu: projection.points.map(p => Math.round(p.cpu)),
        rawDates: projection.points.map(p => p.date)
      };
      return;
    }
    if (!allSnapshots || allSnapshots.length === 0) {
      console.warn('⚠️ No snapshots available to process');
      return;
    }

    const metric = availableMetrics.find(m => m.id === selectedMetric);
    if (!metric) {
      console.error('❌ Invalid metric');
      return;
    }

    // A metric whose migration is not applied has nothing to plot, and the "not applied"
    // notice (payerError) explains why. Processing leftover rows here would instead raise a
    // "No data recorded" error, which outranks that notice and names the wrong metric.
    if (awaitingMigration(metric)) {
      chartData = { labels: [], data: [], rawDates: [] };
      error = null;
      return;
    }

    console.log(`📊 Processing data for ${metric.label} (${metric.field}) - Aggregation: ${selectedAggregation}`);

    // Sort data by date (oldest first)
    const sortedSnapshots = [...allSnapshots].sort((a, b) => {
      const dateA = new Date(a.date || a.snapshot_date);
      const dateB = new Date(b.date || b.snapshot_date);
      return dateA - dateB;
    });

    // Columns with no DEFAULT read back NULL on every day before their feature shipped --
    // the whole decentralization category, and any metric flagged dropNulls. Those days are
    // dropped rather than plotted, so the chart shows a gap instead of fabricating a 0 (or,
    // for invert metrics, a misleading 100%).
    const rows = (selectedCategory === 'decentralization' || metric.dropNulls)
      ? sortedSnapshots.filter(s => s[metric.field] != null)
      : sortedSnapshots;

    // Dropping can empty the set even though the category itself has data -- e.g. Nodes per
    // Wallet over days that carry a wallet count but no node count. Say so explicitly:
    // returning early here would leave the PREVIOUS metric's plot on screen under the new
    // metric's title, which reads as real data for the wrong series.
    if (rows.length === 0) {
      chartData = { labels: [], data: [], rawDates: [] };
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      error = metric.emptyMessage ?? `No data recorded for ${metric.label} in this period`;
      return;
    }
    error = null;

    let labels = [];
    let data = [];
    let rawDates = [];

    if (selectedAggregation === 'daily') {
      // DAILY - Your existing logic
      const allDateStrs = rows.map(s => s.date || s.snapshot_date);
      for (let i = 0; i < rows.length; i++) {
        const snapshot = rows[i];
        const dateStr = snapshot.date || snapshot.snapshot_date;
        if (!dateStr) continue;

        const date = new Date(dateStr);
        labels.push(formatDateLabel(date, i, allDateStrs, 'daily'));
        rawDates.push(dateStr);

        let value = 0;
        if (selectedCategory === 'revenue') {
          if (metric.id === 'daily_revenue_usd' || metric.id === 'cumulative_revenue_usd') {
            // For USD, use the daily_revenue_usd field (handles NULL gracefully with || 0)
            value = snapshot.daily_revenue_usd || 0;
          } else {
            value = snapshot.revenue || snapshot[metric.field] || 0;
          }
        } else {
          value = snapshot[metric.field] || 0;
          if (metric.invert) value = 100 - value;
        }

        data.push(value);
      }
    } else if (selectedAggregation === 'weekly') {
      // WEEKLY AGGREGATION
      const weeklyData = aggregateByWeek(rows, metric);
      labels = weeklyData.labels;
      data = weeklyData.data;
      rawDates = weeklyData.rawDates;
    } else if (selectedAggregation === 'monthly') {
      // MONTHLY AGGREGATION
      const monthlyData = aggregateByMonth(rows, metric);
      labels = monthlyData.labels;
      data = monthlyData.data;
      rawDates = monthlyData.rawDates;
    }

    // Cumulative: convert daily values to running total
    if (metric.cumulative) {
      let runningTotal = 0;
      data = data.map(v => { runningTotal += v; return runningTotal; });
    }

    console.log(`✅ Processed ${data.length} ${selectedAggregation} data points${metric.cumulative ? ' (cumulative)' : ''}`);
    console.log(`   First date: ${rawDates[0]}, Last date: ${rawDates[rawDates.length - 1]}`);
    console.log(`   First value: ${data[0]}, Last value: ${data[data.length - 1]}`);

    chartData = { labels, data, rawDates };
  }

  // NEW: Helper function for weekly aggregation
  function aggregateByWeek(snapshots, metric) {
    const weeklyMap = new Map();
    
    snapshots.forEach(snapshot => {
      const dateStr = snapshot.date || snapshot.snapshot_date;
      if (!dateStr) return;
      
      const date = new Date(dateStr);
      
      // Get Monday of the week (ISO week)
      const dayOfWeek = date.getDay();
      const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(date.setDate(diff));
      const weekKey = monday.toISOString().split('T')[0];
      
      if (!weeklyMap.has(weekKey)) {
        weeklyMap.set(weekKey, {
          total: 0,
          count: 0,
          numeratorSum: 0,
          denominatorSum: 0,
          date: monday
        });
      }

      const weekData = weeklyMap.get(weekKey);

      // Ratio metrics (Team Funded's % of revenue): sum numerator and denominator
      // separately and divide once at the end -- averaging the daily percentages instead
      // understates the real period share whenever revenue is unevenly spread across days.
      if (metric.ratioFields) {
        weekData.numeratorSum += snapshot[metric.ratioFields.numerator] || 0;
        weekData.denominatorSum += snapshot[metric.ratioFields.denominator] || 0;
        return;
      }

      let value = 0;
      if (selectedCategory === 'revenue') {
        if (metric.id === 'daily_revenue_usd' || metric.id === 'cumulative_revenue_usd') {
          value = snapshot.daily_revenue_usd || 0;
        } else {
          value = snapshot.revenue || snapshot[metric.field] || 0;
        }
      } else {
        value = snapshot[metric.field] || 0;
        if (metric.invert) value = 100 - value;
      }

      // For revenue (and other sum-flagged metrics like Team Funded FLUX/$), sum up.
      // For other metrics, average.
      if ((selectedCategory === 'revenue' && !metric.level) || metric.aggregateAsSum) {
        weekData.total += value;
      } else {
        weekData.total += value;
        weekData.count++;
      }
    });

    // Convert map to arrays
    const sortedWeeks = Array.from(weeklyMap.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]));

    const weekKeys = sortedWeeks.map(([key]) => key);
    const labels = sortedWeeks.map(([key, data], index) => {
      const date = new Date(key);
      return formatDateLabel(date, index, weekKeys, 'weekly');
    });

    const data = sortedWeeks.map(([key, weekData]) => {
      if (metric.ratioFields) {
        // $0-total weeks report 0%, never NaN/Infinity -- same convention as the daily value.
        return weekData.denominatorSum > 0 ? (weekData.numeratorSum / weekData.denominatorSum) * (metric.ratioFields.scale ?? 100) : 0;
      }
      if ((selectedCategory === 'revenue' && !metric.level) || metric.aggregateAsSum) {
        return weekData.total; // Sum for revenue / sum-flagged metrics
      } else {
        return weekData.count > 0 ? weekData.total / weekData.count : 0; // Average for others
      }
    });
    
    const rawDates = sortedWeeks.map(([key]) => key);
    
    return { labels, data, rawDates };
  }

  // NEW: Helper function for monthly aggregation
  function aggregateByMonth(snapshots, metric) {
    const monthlyMap = new Map();
    
    snapshots.forEach(snapshot => {
      const dateStr = snapshot.date || snapshot.snapshot_date;
      if (!dateStr) return;
      
      const date = new Date(dateStr);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          total: 0,
          count: 0,
          numeratorSum: 0,
          denominatorSum: 0,
          year: date.getFullYear(),
          month: date.getMonth()
        });
      }

      const monthData = monthlyMap.get(monthKey);

      // Ratio metrics (Team Funded's % of revenue): sum numerator and denominator
      // separately and divide once at the end -- see aggregateByWeek's identical handling.
      if (metric.ratioFields) {
        monthData.numeratorSum += snapshot[metric.ratioFields.numerator] || 0;
        monthData.denominatorSum += snapshot[metric.ratioFields.denominator] || 0;
        return;
      }

      let value = 0;
      if (selectedCategory === 'revenue') {
        if (metric.id === 'daily_revenue_usd' || metric.id === 'cumulative_revenue_usd') {
          value = snapshot.daily_revenue_usd || 0;
        } else {
          value = snapshot.revenue || snapshot[metric.field] || 0;
        }
      } else {
        value = snapshot[metric.field] || 0;
        if (metric.invert) value = 100 - value;
      }

      // For revenue (and other sum-flagged metrics like Team Funded FLUX/$), sum up.
      // For other metrics, average.
      if ((selectedCategory === 'revenue' && !metric.level) || metric.aggregateAsSum) {
        monthData.total += value;
      } else {
        monthData.total += value;
        monthData.count++;
      }
    });

    // Convert map to arrays
    const sortedMonths = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    const labels = sortedMonths.map(([key, data]) => {
      const date = new Date(data.year, data.month);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });

    const data = sortedMonths.map(([key, monthData]) => {
      if (metric.ratioFields) {
        // $0-total weeks report 0%, never NaN/Infinity -- same convention as the daily value.
        return monthData.denominatorSum > 0 ? (monthData.numeratorSum / monthData.denominatorSum) * (metric.ratioFields.scale ?? 100) : 0;
      }
      if ((selectedCategory === 'revenue' && !metric.level) || metric.aggregateAsSum) {
        return monthData.total; // Sum for revenue / sum-flagged metrics
      } else {
        return monthData.count > 0 ? monthData.total / monthData.count : 0; // Average for others
      }
    });
    
    const rawDates = sortedMonths.map(([key]) => key + '-01');
    
    return { labels, data, rawDates };
  }

  function renderProjection() {
    if (chartInstance) chartInstance.destroy();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tick = color => ({ color, font: { family: "'JetBrains Mono', monospace", size: 11 }, callback: v => formatCount(v, { compact: true }) });
    chartInstance = new ChartJS(chartCanvas, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'App instances',
            data: chartData.data,
            borderColor: 'rgb(100, 200, 255)',
            backgroundColor: 'rgba(100, 200, 255, 0.12)',
            fill: true,
            yAxisID: 'instances',
            pointRadius: 0,
            borderWidth: 2,
            stepped: true
          },
          {
            label: 'CPU cores (readable specs)',
            data: chartData.cpu,
            borderColor: 'rgb(189, 147, 249)',
            backgroundColor: 'transparent',
            yAxisID: 'cpu',
            pointRadius: 0,
            borderWidth: 2,
            borderDash: [4, 3],
            stepped: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduced ? false : undefined,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, labels: { color: '#8b92b0', font: { family: "'JetBrains Mono', monospace", size: 11 } } },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 23, 0.95)',
            titleColor: '#00ffff',
            bodyColor: '#ffffff',
            padding: 12,
            callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCount(ctx.parsed.y)}` }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(139, 146, 176, 0.1)' }, ticks: { color: '#8b92b0', maxTicksLimit: 10, font: { family: "'JetBrains Mono', monospace", size: 10 } } },
          instances: { position: 'left', beginAtZero: true, grid: { color: 'rgba(139, 146, 176, 0.1)' }, ticks: tick('rgb(100, 200, 255)') },
          cpu: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: tick('rgb(189, 147, 249)') }
        }
      }
    });
  }

  function renderChart() {
    if (!chartCanvas || !ChartJS) {
      return; // re-run by the reactive block once both exist
    }
    if (selectedMetric === PROJECTION_METRIC) {
      if (chartData.cpu) renderProjection();
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
    chartInstance = new ChartJS(chartCanvas, {
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
        animation: prefersReducedMotion() ? false : undefined,
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
              // Tooltips keep full precision -- the axis is where compaction belongs.
              label: (context) => formatChartValue(context.parsed.y, metric.format)
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
                family: "'JetBrains Mono', monospace",
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
                family: "'JetBrains Mono', monospace",
                size: 11
              },
              callback: (value) => formatChartValue(value, metric.format, { axis: true })
            }
          }
        }
      }
    });

    console.log('✅ Chart rendered successfully');
  }

  function handleCategoryChange(categoryId) {
    console.log(`User clicked category: ${categoryId}`);
    selectedCategory = categoryId;

    // Reset entity-search state when leaving decentralization -- switching back into it
    // later starts fresh at Overview rather than reopening on a stale search.
    if (categoryId !== 'decentralization') {
      decentralizationView = 'overview';
      selectedEntity = null;
      entitySearchQuery = '';
      showEntityDropdown = false;
    }

    // Fetch new data when category changes (revenue vs snapshots)
    fetchAllData();
  }

  function handleDecentralizationViewChange(view) {
    decentralizationView = view;
    selectedEntity = null;
    entitySearchQuery = '';
    showEntityDropdown = false;

    if (view !== 'overview' && decentralizationHistory) {
      // Already have this timeframe's raw history cached (from a prior entity-mode visit
      // in this same session) -- just rebuild the picker list, no need to refetch.
      buildEntityList();
      allSnapshots = [];
      loading = false;
    } else {
      fetchAllData();
    }
  }

  /** Distinct, sorted entity names for the search dropdown -- issue #138. */
  function buildEntityList() {
    if (!decentralizationHistory || decentralizationView === 'overview') {
      entityList = [];
      filteredEntityList = [];
      return;
    }
    const dim = ENTITY_DIMENSIONS[decentralizationView];
    const rows = decentralizationHistory[dim.historyKey] || [];
    entityList = [...new Set(rows.map(r => r[dim.nameField]))].filter(Boolean).sort();
    filteredEntityList = entityList;
  }

  /**
   * One row per day for the selected entity, with both its raw count and its % of that
   * day's total classified for this dimension (every classified node has exactly one
   * country/continent/org, so summing every entity's count for a day IS that day's
   * total classified -- no extra fetch needed for the percent view).
   */
  function buildEntitySnapshots(entity) {
    const dim = ENTITY_DIMENSIONS[decentralizationView];
    const rows = decentralizationHistory?.[dim.historyKey] || [];

    const dailyTotals = new Map();
    for (const row of rows) {
      dailyTotals.set(row.date, (dailyTotals.get(row.date) || 0) + row.count);
    }

    const byDate = new Map(rows.filter(r => r[dim.nameField] === entity).map(r => [r.date, r.count]));
    const allDates = [...dailyTotals.keys()].sort();

    return allDates.map(date => {
      const count = byDate.get(date) || 0;
      const total = dailyTotals.get(date) || 0;
      return {
        snapshot_date: date,
        instance_count: count,
        instance_percent: total > 0 ? (count / total) * 100 : 0
      };
    });
  }

  /**
   * Swap in the freshly-fetched game list. Reassigning `categories` is what re-runs the
   * availableMetrics reactive block, which in turn fixes up selectedMetric.
   */
  function applyGameMetrics() {
    categories = {
      ...categories,
      gaming: { ...categories.gaming, metrics: buildGameMetrics(gameHistory?.games || []) }
    };
  }

  function handleEntitySelect(entity) {
    selectedEntity = entity;
    entitySearchQuery = entity;
    showEntityDropdown = false;
    allSnapshots = buildEntitySnapshots(entity);
    loading = false;
    processChartData();
  }

  function handleEntitySearchInput(event) {
    entitySearchQuery = event.target.value;
    showEntityDropdown = true;
    filteredEntityList = entityList.filter(e =>
      e.toLowerCase().includes(entitySearchQuery.toLowerCase())
    );
  }

  function handleEntitySearchFocus() {
    showEntityDropdown = true;
    filteredEntityList = entityList.filter(e =>
      e.toLowerCase().includes(entitySearchQuery.toLowerCase())
    );
  }

  function handleEntitySearchBlur() {
    // Delay to allow click on dropdown items
    setTimeout(() => { showEntityDropdown = false; }, 200);
  }

  function handleEntityValueTypeChange(type) {
    entityValueType = type;
    selectedMetric = type === 'qty' ? 'entity_qty' : 'entity_percent';
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

    if (selectedMetric === PROJECTION_METRIC) {
      const csv = ['Date,App instances if no renewals,CPU cores (readable specs) if no renewals',
        ...chartData.rawDates.map((date, i) => `${date},${chartData.data[i]},${chartData.cpu[i]}`)].join('\n');
      const link = document.createElement('a');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      link.href = url;
      link.download = `flux_utilization_projection_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    // Build CSV content
    const headers = ['Date', metric.label, 'Category', 'Timeframe', 'Aggregation'];
    const rows = chartData.rawDates.map((date, index) => {
      const value = chartData.data[index];
      return [
        date,
        value,
        category.label,
        selectedTimeframe,
        selectedAggregation
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
    const entitySuffix = selectedEntity ? `_${selectedEntity.replace(/[^a-z0-9]+/gi, '-')}` : '';
    const filename = `flux_${selectedCategory}_${selectedMetric}${entitySuffix}_${selectedAggregation}_${selectedTimeframe}_${timestamp}.csv`;
    
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
      <h3 class="chart-title">{displayTitle}</h3>
      {#if !loading && !error}
        <span class="chart-subtitle">
          {isProjection ? projectionSummary : (currentMetric?.description ?? currentMetric?.label ?? '')}
        </span>
      {/if}
    </div>

    <div class="chart-controls">
      <!-- View and Period describe the past; the projection looks forward (issue #347). -->
      {#if !isProjection}
      <!-- NEW: Aggregation Selector -->
      <div class="control-group">
        <label for="aggregation-{title}">View:</label>
        <select 
          id="aggregation-{title}"
          bind:value={selectedAggregation}
          class="chart-select"
          disabled={currentMetric?.monthlyOnly}
          title={currentMetric?.monthlyOnly ? 'Counted per calendar month' : undefined}
        >
          {#each aggregations as agg}
            <option value={agg.id}>{agg.label}</option>
          {/each}
        </select>
      </div>

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
      {/if}

      <!-- Metric Selector (or entity search for decentralization country/continent/datacenter) -->
      {#if selectedCategory === 'decentralization' && decentralizationView !== 'overview'}
        <div class="control-group entity-search-container">
          <label for="entity-search-{title}">{ENTITY_DIMENSIONS[decentralizationView].label}:</label>
          <div class="entity-search-wrapper">
            <input
              id="entity-search-{title}"
              type="text"
              class="chart-select entity-search-input"
              placeholder="Search {ENTITY_DIMENSIONS[decentralizationView].pluralLabel.toLowerCase()}..."
              value={entitySearchQuery}
              on:input={handleEntitySearchInput}
              on:focus={handleEntitySearchFocus}
              on:blur={handleEntitySearchBlur}
            />
            {#if showEntityDropdown && filteredEntityList.length > 0}
              <div class="entity-dropdown">
                {#each filteredEntityList.slice(0, 50) as entity}
                  <button
                    class="entity-dropdown-item"
                    class:selected={entity === selectedEntity}
                    on:mousedown|preventDefault={() => handleEntitySelect(entity)}
                  >
                    {entity}
                  </button>
                {/each}
                {#if filteredEntityList.length > 50}
                  <div class="entity-dropdown-more">
                    ...{filteredEntityList.length - 50} more results
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        {#if selectedEntity}
          <div class="control-group value-type-toggle">
            <button
              type="button"
              class="value-type-btn"
              class:active={entityValueType === 'qty'}
              aria-pressed={entityValueType === 'qty'}
              on:click={() => handleEntityValueTypeChange('qty')}
            >Qty</button>
            <button
              type="button"
              class="value-type-btn"
              class:active={entityValueType === 'percent'}
              aria-pressed={entityValueType === 'percent'}
              aria-label="Percent"
              on:click={() => handleEntityValueTypeChange('percent')}
            >%</button>
          </div>
        {/if}
      {:else}
        <div class="control-group">
          <label for="metric-{title}">Metric:</label>
          <select
            id="metric-{title}"
            bind:value={selectedMetric}
            on:change={handleMetricChange}
            class="chart-select"
          >
            {#each metricGroups as group}
              {#if group.name}
                <optgroup label={group.name}>
                  {#each group.metrics as metric}
                    <option value={metric.id}>{metric.label}</option>
                  {/each}
                </optgroup>
              {:else}
                {#each group.metrics as metric}
                  <option value={metric.id}>{metric.label}</option>
                {/each}
              {/if}
            {/each}
          </select>
        </div>
      {/if}

      <!-- CSV Export Button -->
      {#if !loading && !error && chartData.labels.length > 0}
        <button 
          class="export-btn" 
          on:click={exportToCSV}
          title="Export chart data to CSV"
        >
        <Download size={14} strokeWidth={2} />
          <span class="export-text">CSV</span>
      </button>
      {/if}
    </div>
  </div>

  <!-- Category Pills -->
  <div class="category-pills" role="group" aria-label="Chart category">
    {#each Object.entries(categories) as [id, category]}
      <button
        type="button"
        class="category-pill"
        class:active={selectedCategory === id}
        aria-pressed={selectedCategory === id}
        on:click={() => handleCategoryChange(id)}
        use:cssomStyle={{ '--category-color': category.color }}
      >
        <span class="category-icon" aria-hidden="true">
          {#if id === 'revenue'}
            <DollarSign size={16} strokeWidth={2} />
          {:else if id === 'nodes'}
            <Server size={16} strokeWidth={2} />
          {:else if id === 'resources'}
            <Cloud size={16} strokeWidth={2} />
          {:else if id === 'apps'}
            <Package size={16} strokeWidth={2} />
          {:else if id === 'decentralization'}
            <Globe size={16} strokeWidth={2} />
          {:else if id === 'gaming'}
            <Gamepad2 size={16} strokeWidth={2} />
          {:else if id === 'team_funded'}
            <Users size={16} strokeWidth={2} />
          {/if}
        </span>
        <span class="category-label">{category.label}</span>
      </button>
    {/each}
  </div>

  <!-- Decentralization view toggle (issue #138): Overview is the existing headline
       %/count metrics; the other three switch to the entity-search trend above. -->
  {#if selectedCategory === 'decentralization'}
    <div class="decentralization-view-toggle" role="group" aria-label="Decentralization view">
      {#each DECENTRALIZATION_VIEWS as view}
        <button
          type="button"
          class="view-toggle-btn"
          class:active={decentralizationView === view.id}
          aria-pressed={decentralizationView === view.id}
          on:click={() => handleDecentralizationViewChange(view.id)}
        >{view.label}</button>
      {/each}
    </div>
  {/if}

  <!-- Chart Area -->
  <!-- style: directive, not a style="" attribute. The CSP has no 'unsafe-inline' in
       style-src, which blocks inline style ATTRIBUTES outright -- this div's height was
       being silently dropped and the chart sat at Chart.js's 150px default no matter what
       `height` was set to. Svelte compiles `style:` to element.style.setProperty(), a CSSOM
       write, which CSP permits. Use `style:` for every dynamic style in this app. -->
  <div class="chart-wrapper" use:cssomStyle={{ height: `${height}px` }}>
    {#if loading}
      <div class="chart-loading">
        <div class="loading-spinner"></div>
        <p>Loading chart data...</p>
      </div>
    {:else if error || payerError}
      <div class="chart-error">
        <span class="error-icon">!</span>
        <p>{error || payerError}</p>
      </div>
    {:else if selectedCategory === 'gaming' && allSnapshots.length === 0}
      <div class="chart-loading">
        <Gamepad2 size={40} strokeWidth={1.5} />
        <p>No game history collected yet</p>
        <p class="repo-count-hint">Per-game counts start with the next daily snapshot</p>
      </div>
    {:else if selectedCategory === 'decentralization' && decentralizationView !== 'overview' && !selectedEntity}
      <div class="chart-loading">
        <Globe size={40} strokeWidth={1.5} />
        <p>Search and select a {ENTITY_DIMENSIONS[decentralizationView].label.toLowerCase()} above to view its trend</p>
        {#if entityList.length > 0}
          <p class="repo-count-hint">{entityList.length} {ENTITY_DIMENSIONS[decentralizationView].pluralLabel.toLowerCase()} tracked</p>
        {/if}
      </div>
    {:else}
      <!-- A canvas is invisible to screen readers (issue #326): the wrapper names what it
           plots and the latest value. (role="img" goes on the wrapper -- Svelte's a11y check
           rejects it on <canvas> itself.) -->
      <div class="chart-canvas" role="img" aria-label={chartAriaLabel}>
        <canvas bind:this={chartCanvas} aria-hidden="true"></canvas>
      </div>
    {/if}
  </div>

  {#if isProjection && projection && !loading && !error}
    <div class="projection-notes">
      {#if projection.biggestDrop?.instances > 0}
        <p>
          <span class="note-label">Biggest week</span>
          {projectionDate(projection.biggestDrop.from)} – {projectionDate(projection.biggestDrop.to)}:
          −{formatCount(projection.biggestDrop.instances)} instances, −{formatCount(Math.round(projection.biggestDrop.cpu))} cores
        </p>
      {/if}
      <p>
        <span class="note-label">CPU line covers</span>
        {formatCount(Math.round(projection.today.cpu))} cores ordered by readable specs.
        {formatCount(projection.coverage.cpuUnreadableApps)} encrypted apps (mostly game sites) hide their
        CPU; their instances are in the instance line.
      </p>
    </div>
  {/if}
</div>

<style>
  .projection-notes {
    margin-top: var(--spacing-md);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  .note-label {
    display: inline-block;
    min-width: 9rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .chart-canvas {
    position: relative;
    width: 100%;
    height: 100%;
  }

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
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
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
    font-family: var(--font-mono);
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

  /* Decentralization view toggle (issue #138): Overview vs Countries/Continents/Datacenters */
  .decentralization-view-toggle {
    display: flex;
    gap: var(--spacing-xs);
    margin-bottom: var(--spacing-md);
    flex-wrap: wrap;
  }

  .view-toggle-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-muted);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .view-toggle-btn:hover {
    border-color: var(--accent-cyan);
    color: var(--text-white);
  }

  .view-toggle-btn.active {
    background: rgba(255, 180, 0, 0.15);
    border-color: rgb(255, 180, 0);
    color: rgb(255, 180, 0);
  }

  /* Entity search (country/continent/datacenter) -- same pattern the removed docker_repos
     search used (see git history pre-#109's Chart.svelte). */
  .entity-search-container {
    position: relative;
  }

  .entity-search-wrapper {
    position: relative;
  }

  .entity-search-input {
    min-width: 220px;
  }

  .entity-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 300px;
    overflow-y: auto;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    z-index: 100;
  }

  .entity-dropdown-item {
    display: block;
    width: 100%;
    padding: var(--spacing-xs) var(--spacing-sm);
    background: none;
    border: none;
    color: var(--text-white);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .entity-dropdown-item:hover {
    background: rgba(255, 180, 0, 0.15);
  }

  .entity-dropdown-item.selected {
    background: rgba(255, 180, 0, 0.25);
    color: rgb(255, 180, 0);
  }

  .entity-dropdown-more {
    padding: var(--spacing-xs) var(--spacing-sm);
    color: var(--text-muted);
    font-size: 0.75rem;
    font-style: italic;
    text-align: center;
  }

  .repo-count-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  /* Qty / % toggle once an entity is selected */
  .value-type-toggle {
    display: flex;
    gap: 2px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 2px;
  }

  .value-type-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    padding: var(--spacing-xs) var(--spacing-sm);
    border-radius: calc(var(--radius-sm) - 2px);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .value-type-btn:hover {
    color: var(--text-white);
  }

  .value-type-btn.active {
    background: rgba(255, 180, 0, 0.2);
    color: rgb(255, 180, 0);
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
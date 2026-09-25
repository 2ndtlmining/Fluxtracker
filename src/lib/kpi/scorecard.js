/**
 * Executive KPI scorecard for Discord (owner redesign, 2026-09-26). Pure.
 *
 * One message, no tables: a title, a one-line headline in plain words, then nine tiles in a
 * 3 x 3 grid (Discord lays inline fields out three to a row on desktop and stacks them on
 * mobile). No emoji -- direction is carried by the plain triangles ▲ ▼ and signed numbers.
 * Longer reports add one revenue trend line drawn with block characters. The per-app detail
 * the old report sent as a second message is replaced by one "Most deployed" line.
 *
 * Every figure is a period comparison of two COMPLETED periods, as before (periods.js).
 */

const GREEN = 0x00c853;
const RED = 0xd50000;
const NEUTRAL = 0x00b8d4;
const SPARK = '▁▂▃▄▅▆▇█';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TITLES = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

const utcDate = iso => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);

/** How the comparison period reads in a sentence: "Tuesday", "August", "the previous week". */
export function comparisonName(timeframe, comparison) {
  const d = utcDate(comparison.start);
  if (timeframe === 'daily') return DAY_NAMES[d.getUTCDay()];
  if (timeframe === 'monthly') return MONTH_NAMES[d.getUTCMonth()];
  if (timeframe === 'weekly') return 'the previous week';
  if (timeframe === 'quarterly') return 'the previous quarter';
  return String(d.getUTCFullYear());
}

const int = n => Math.round(n).toLocaleString('en-US');
const usd = n => '$' + int(n);
const pct1 = n => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

/** "▲ 27.0%", "▼ 0.9%", "no change" -- a percent change. */
export function trendPercent(p) {
  if (!Number.isFinite(p)) return 'no comparison';
  if (Math.abs(p) < 0.05) return 'no change';
  return `${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%`;
}

/** "▲ 0.5 pts" -- a change in a percentage, in percentage points. */
export function trendPoints(p) {
  if (!Number.isFinite(p)) return 'no comparison';
  if (Math.abs(p) < 0.05) return 'no change';
  return `${p > 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)} pts`;
}

const change = (cur, prev) => (Number.isFinite(cur) && Number.isFinite(prev) && prev > 0 ? ((cur - prev) / prev) * 100 : NaN);

/** Block-character sparkline: one character per value, scaled min..max. */
export function sparkline(values) {
  const v = values.map(x => Number(x) || 0);
  if (v.length === 0) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (max === min) return SPARK[3].repeat(v.length);
  return v.map(x => SPARK[Math.round(((x - min) / (max - min)) * (SPARK.length - 1))]).join('');
}

/**
 * Revenue trend buckets for a period: by day (weekly, monthly), by week (quarterly) or by
 * month (yearly), so the line stays short enough to read. Daily reports get none.
 * @param {{date: string, daily_revenue_usd: number}[]} rows
 */
export function revenueTrend(timeframe, rows, current) {
  if (timeframe === 'daily') return null;
  const byDate = new Map((rows ?? []).map(r => [String(r.date).slice(0, 10), Number(r.daily_revenue_usd) || 0]));
  const days = [];
  for (let t = utcDate(current.start).getTime(); t <= utcDate(current.end).getTime(); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    days.push({ date, usd: byDate.get(date) ?? 0 });
  }
  let unit = 'day';
  let buckets = days.map(d => d.usd);
  if (timeframe === 'quarterly') {
    unit = 'week';
    buckets = [];
    for (let i = 0; i < days.length; i += 7) buckets.push(days.slice(i, i + 7).reduce((a, d) => a + d.usd, 0));
  } else if (timeframe === 'yearly') {
    unit = 'month';
    const months = new Map();
    for (const d of days) months.set(d.date.slice(0, 7), (months.get(d.date.slice(0, 7)) ?? 0) + d.usd);
    buckets = [...months.values()];
  }
  return { unit, line: sparkline(buckets), low: Math.min(...buckets), high: Math.max(...buckets) };
}

/**
 * The single "Most deployed" line that replaces the old per-app activity message: game
 * names with counts, then everything else as "other".
 * @param {string[]} names app names deployed in the last 24h
 * @param {(name: string) => string|null} resolveGame
 */
export function mostDeployedLine(names, resolveGame, top = 3) {
  if (!names || names.length === 0) return null;
  const counts = new Map();
  for (const name of names) {
    const game = resolveGame(name);
    if (game) counts.set(game, (counts.get(game) ?? 0) + 1);
  }
  const shown = [...counts].sort((a, b) => b[1] - a[1]).slice(0, top);
  const parts = shown.map(([g, n]) => `${g} ${n}`);
  const rest = names.length - shown.reduce((a, [, n]) => a + n, 0);
  if (rest > 0) parts.push(`other ${rest}`);
  return `Most deployed: ${parts.join(' · ')}`;
}

const metricOf = (dataset, sectionKey, metricKey) =>
  dataset.sections.find(s => s.key === sectionKey)?.metrics.find(m => m.key === metricKey) ?? null;

function tile(name, value, detail) {
  return { name, value: detail ? `**${value}**\n${detail}` : `**${value}**`, inline: true };
}

const NA = (name, why = 'not enough data') => tile(name, 'n/a', why);

/**
 * @param {object} report  buildKpiReport() output, including `executive` (see kpiService)
 * @returns Discord webhook JSON body
 */
export function buildScorecardPayload(report) {
  const { timeframe, current, comparison, dataset, currentLabel, comparisonLabel, executive = {} } = report;
  const revenue = metricOf(dataset, 'revenue', 'usd');
  const nodes = metricOf(dataset, 'nodes', 'total');
  const cpu = metricOf(dataset, 'resources', 'cpuPercent');
  const dc = metricOf(dataset, 'decentralization', 'datacenterPercent');
  const apps = metricOf(dataset, 'applications', 'total');
  const vs = comparisonName(timeframe, comparison);
  const perDay = timeframe === 'daily';

  // ---- headline, in words
  const parts = [];
  if (revenue?.available) {
    const p = revenue.change?.percent;
    parts.push(Math.abs(p) < 1 ? `Revenue flat on ${vs}` : `Revenue ${p > 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(0)}% on ${vs}`);
  }
  if (nodes?.available) {
    const p = nodes.change?.percent;
    parts.push(Math.abs(p) < 1 ? 'nodes steady' : `nodes ${p > 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(1)}%`);
  }
  const headline = parts.length ? parts.join('; ') + '.' : 'Not enough data to compare periods.';

  // ---- tiles, three rows of three: money / network / apps
  const tiles = [];
  tiles.push(revenue?.available ? tile('Revenue', usd(revenue.current), trendPercent(revenue.change?.percent)) : NA('Revenue'));

  const g = executive.gameRevenue;
  tiles.push(g?.current
    ? tile('Game revenue', usd(g.current.usd), g.current.sharePercent != null ? `${pct1(g.current.sharePercent)} of revenue` : trendPercent(change(g.current.usd, g.comparison?.usd)))
    : NA('Game revenue'));

  const mix = executive.mix;
  tiles.push(mix ? tile('New vs renewal', `${Math.round(mix.newPercent)}% / ${Math.round(mix.renewalPercent)}%`, 'of revenue') : NA('New vs renewal'));

  tiles.push(nodes?.available ? tile(perDay ? 'Nodes' : 'Nodes (average)', int(nodes.current), trendPercent(nodes.change?.percent)) : NA('Nodes'));
  tiles.push(cpu?.available ? tile('CPU in use', pct1(cpu.current), trendPoints(cpu.change?.absolute)) : NA('CPU in use'));
  tiles.push(dc?.available ? tile('In datacenters', pct1(dc.current), trendPoints(dc.change?.absolute)) : NA('In datacenters'));

  tiles.push(apps?.available ? tile(perDay ? 'Apps running' : 'Apps running (average)', int(apps.current), trendPercent(apps.change?.percent)) : NA('Apps running'));
  const act = executive.activity;
  tiles.push(act && Number.isFinite(act.deployed) && Number.isFinite(act.expiring)
    ? tile(perDay ? 'Deployed / expiring' : 'Deployed / expired', `${int(act.deployed)} / ${int(act.expiring)}`, perDay ? 'last 24 hours' : 'in the period')
    : NA(perDay ? 'Deployed / expiring' : 'Deployed / expired'));
  const m = executive.medianDaysLeft;
  tiles.push(m && Number.isFinite(m.current)
    ? tile('Median time left', `${Math.round(m.current)} days`, Number.isFinite(m.comparison) ? trendPercent(change(m.current, m.comparison)) : 'running apps')
    : NA('Median time left', 'recording since Sep 2026'));

  // ---- description: headline, then the trend and most-deployed lines when present
  const lines = [headline];
  const trend = executive.trend;
  if (trend?.line) lines.push(`Revenue by ${trend.unit}: \`${trend.line}\`  (${usd(trend.low)} to ${usd(trend.high)})`);
  if (executive.mostDeployed) lines.push(executive.mostDeployed);

  const tileKeys = [revenue, nodes, cpu, dc, apps];
  const complete = tileKeys.every(x => x?.available);
  const color = revenue?.available ? (revenue.change?.percent >= 0 ? GREEN : RED) : NEUTRAL;

  return {
    username: 'FluxTracker',
    embeds: [{
      title: `Flux Network · ${TITLES[timeframe]} KPIs · ${currentLabel}`,
      description: lines.join('\n'),
      color,
      fields: tiles,
      footer: { text: `vs ${comparisonLabel} · ${complete ? 'data complete' : 'some figures lack full data (shown as n/a)'}` },
      timestamp: report.generatedAt
    }]
  };
}

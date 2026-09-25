import { describe, it, expect } from 'vitest';
import { buildScorecardPayload, comparisonName, trendPercent, trendPoints, sparkline, revenueTrend, mostDeployedLine } from '../scorecard.js';
import { buildKpiDataset } from '../metrics.js';

/** A daily report for Thu 24 Sep 2026 vs Wed 23 Sep, with the owner's real numbers. */
function dailyReport(executive = {}, snapshotOverrides = {}) {
  const current = { start: '2026-09-24', end: '2026-09-24' };
  const comparison = { start: '2026-09-23', end: '2026-09-23' };
  const snap = (date, o = {}) => [{
    snapshot_date: date,
    node_total: 6508, node_cumulus: 3270, node_nimbus: 1577, node_stratus: 1661, unique_wallets: 810,
    used_cpu_cores: 14070, used_ram_gb: 29500, used_storage_gb: 365000,
    cpu_utilization_percent: 26.7, ram_utilization_percent: 16.8, storage_utilization_percent: 11.7,
    flux_price_usd: 0.0694, total_apps: 7908, decentralization_datacenter_percent: 54.5, ...o
  }];
  const dataset = buildKpiDataset({
    current, comparison,
    currentSnapshots: snap('2026-09-24', snapshotOverrides),
    comparisonSnapshots: snap('2026-09-23', { node_total: 6566, cpu_utilization_percent: 26.2, total_apps: 7938, decentralization_datacenter_percent: 53.8 }),
    currentRevenue: { flux: 11279.54, usd: 777.42 },
    comparisonRevenue: { flux: 8856.79, usd: 612.14 }
  });
  return {
    timeframe: 'daily', current, comparison, dataset,
    currentLabel: 'Sep 24, 2026', comparisonLabel: 'Sep 23, 2026',
    generatedAt: '2026-09-25T02:00:00.000Z',
    executive: {
      gameRevenue: { current: { usd: 488.63, flux: 7083, sharePercent: 62.8 }, comparison: null },
      mix: { newPercent: 51.2, renewalPercent: 48.8 },
      activity: { deployed: 136, expiring: 41 },
      medianDaysLeft: { current: 15.5, comparison: null },
      trend: null,
      mostDeployed: 'Most deployed: RuneScape: Dragonwilds 58 · Palworld 21 · other 57',
      ...executive
    }
  };
}

const tiles = payload => Object.fromEntries(payload.embeds[0].fields.map(f => [f.name, f.value]));

describe('buildScorecardPayload', () => {
  it('is one embed of nine inline tiles in money / network / apps order', () => {
    const embed = buildScorecardPayload(dailyReport()).embeds[0];
    expect(embed.fields.map(f => f.name)).toEqual([
      'Revenue', 'Game revenue', 'New vs renewal',
      'Nodes', 'CPU in use', 'In datacenters',
      'Apps running', 'Deployed / expiring', 'Median time left'
    ]);
    expect(embed.fields.every(f => f.inline)).toBe(true);
  });

  it('reads the owner\'s real day plainly', () => {
    const payload = buildScorecardPayload(dailyReport());
    const embed = payload.embeds[0];
    expect(embed.title).toBe('Flux Network · Daily KPIs · Sep 24, 2026');
    expect(embed.description.split('\n')[0]).toBe('Revenue up 27% on Wednesday; nodes steady.');
    const t = tiles(payload);
    expect(t['Revenue']).toBe('**$777**\n▲ 27.0%');
    expect(t['Game revenue']).toBe('**$489**\n62.8% of revenue');
    expect(t['New vs renewal']).toBe('**51% / 49%**\nof revenue');
    expect(t['Nodes']).toBe('**6,508**\n▼ 0.9%');
    expect(t['CPU in use']).toBe('**26.7%**\n▲ 0.5 pts');
    expect(t['In datacenters']).toBe('**54.5%**\n▲ 0.7 pts');
    expect(t['Deployed / expiring']).toBe('**136 / 41**\nlast 24 hours');
    expect(t['Median time left']).toBe('**16 days**\nrunning apps');
    expect(embed.description).toContain('Most deployed: RuneScape: Dragonwilds 58');
    expect(embed.footer.text).toBe('vs Sep 23, 2026 · data complete');
  });

  it('is green when revenue rose and red when it fell', () => {
    expect(buildScorecardPayload(dailyReport()).embeds[0].color).toBe(0x00c853);
    const down = dailyReport();
    down.dataset = buildKpiDataset({
      current: down.current, comparison: down.comparison,
      currentSnapshots: [{ snapshot_date: '2026-09-24', node_total: 6508 }],
      comparisonSnapshots: [{ snapshot_date: '2026-09-23', node_total: 6508 }],
      currentRevenue: { flux: 100, usd: 5 }, comparisonRevenue: { flux: 200, usd: 10 }
    });
    const embed = buildScorecardPayload(down).embeds[0];
    expect(embed.color).toBe(0xd50000);
    expect(embed.description).toMatch(/^Revenue down 50% on Wednesday/);
  });

  it('shows n/a for anything it cannot back with data -- never a fake zero', () => {
    const t = tiles(buildScorecardPayload(dailyReport({ gameRevenue: null, mix: null, activity: null, medianDaysLeft: null })));
    expect(t['Game revenue']).toBe('**n/a**\nnot enough data');
    expect(t['Median time left']).toBe('**n/a**\nrecording since Sep 2026');
  });

  it('contains no emoji and no code-block tables', () => {
    const json = JSON.stringify(buildScorecardPayload(dailyReport()));
    expect(json).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(json).not.toContain('```');
  });

  it('stays inside Discord limits', () => {
    const embed = buildScorecardPayload(dailyReport()).embeds[0];
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    expect(JSON.stringify(embed).length).toBeLessThan(6000);
    expect(embed.description.length).toBeLessThan(4096);
  });

  it('labels averaged figures on longer reports and adds the trend line', () => {
    const r = dailyReport({ trend: { unit: 'day', line: '▁▁▆▄▃▅█', low: 281, high: 777 } });
    r.timeframe = 'weekly';
    const payload = buildScorecardPayload(r);
    expect(payload.embeds[0].fields.map(f => f.name)).toContain('Nodes (average)');
    expect(payload.embeds[0].description).toContain('Revenue by day: `▁▁▆▄▃▅█`  ($281 to $777)');
  });
});

describe('scorecard helpers', () => {
  it('names the comparison period the way a person would', () => {
    expect(comparisonName('daily', { start: '2026-09-23' })).toBe('Wednesday');
    expect(comparisonName('monthly', { start: '2026-08-01' })).toBe('August');
    expect(comparisonName('weekly', { start: '2026-09-14' })).toBe('the previous week');
    expect(comparisonName('yearly', { start: '2025-01-01' })).toBe('2025');
  });

  it('formats changes with plain triangles, and says so when there is nothing to compare', () => {
    expect(trendPercent(27.04)).toBe('▲ 27.0%');
    expect(trendPercent(-0.88)).toBe('▼ 0.9%');
    expect(trendPercent(0)).toBe('no change');
    expect(trendPercent(NaN)).toBe('no comparison');
    expect(trendPoints(0.5)).toBe('▲ 0.5 pts');
  });

  it('draws a sparkline scaled to the period', () => {
    expect(sparkline([281, 294, 727, 548, 498, 612, 777])).toBe('▁▁▇▅▄▆█');
    expect(sparkline([5, 5, 5])).toBe('▄▄▄');
    expect(sparkline([])).toBe('');
  });

  it('buckets the trend by day, week or month so the line stays short', () => {
    const rows = [{ date: '2026-09-01', daily_revenue_usd: 10 }, { date: '2026-09-02', daily_revenue_usd: 20 }];
    expect(revenueTrend('daily', rows, { start: '2026-09-01', end: '2026-09-01' })).toBeNull();
    expect(revenueTrend('weekly', rows, { start: '2026-09-01', end: '2026-09-07' }).line).toHaveLength(7);
    expect(revenueTrend('quarterly', rows, { start: '2026-07-01', end: '2026-09-30' })).toMatchObject({ unit: 'week' });
    expect(revenueTrend('quarterly', rows, { start: '2026-07-01', end: '2026-09-30' }).line).toHaveLength(14);
    expect(revenueTrend('yearly', rows, { start: '2025-01-01', end: '2025-12-31' }).line).toHaveLength(12);
  });

  it('summarises deployments by game in one line', () => {
    const resolve = n => (n.startsWith('palworld') ? 'Palworld' : n.startsWith('valheim') ? 'Valheim' : null);
    expect(mostDeployedLine(['palworld1', 'palworld2', 'valheim1', 'wp'], resolve)).toBe('Most deployed: Palworld 2 · Valheim 1 · other 1');
    expect(mostDeployedLine([], resolve)).toBeNull();
  });
});

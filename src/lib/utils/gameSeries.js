/**
 * Series shaping for the Historical Performance chart's Gaming category (issue #175).
 *
 * Extracted from Chart.svelte for the same reason history.js exports shapeGameHistory: the
 * gap-vs-zero rule below is the whole point of the feature and needs testing without a
 * browser.
 */

export const GAME_METRIC_PREFIX = 'game:';

/** The base metric. Per-game metrics are appended at runtime -- never hardcoded. */
export const GAMING_TOTAL_METRIC = {
    id: 'gaming_instances_total',
    label: 'All Game Instances',
    field: 'game_instances',
    format: 'number',
    group: 'Instances'
};

// Issue #265: what game servers earn, from revenue_transactions (migration 024) rather than
// the per-game snapshots, hence their own source. Recognised by app name, so the
// explanation says what is and is not counted.
const GAME_REVENUE_NOTE = 'Payments for game servers (Palworld, Minecraft, Rust, Valheim and others), recognised by the game sites\' app names or, for servers deployed by hand, the game image.';
export const GAME_REVENUE_METRICS = [
    {
        id: 'game_revenue_usd', label: 'Game server revenue ($)', field: 'game_usd', format: 'usd',
        aggregateAsSum: true, source: 'gameRevenue', group: 'Revenue', description: GAME_REVENUE_NOTE
    },
    {
        id: 'game_revenue_percent', label: 'Game server revenue (% of Revenue)', field: 'game_revenue_percent', format: 'percent',
        ratioFields: { numerator: 'game_flux', denominator: 'total_flux' }, source: 'gameRevenue', group: 'Revenue',
        description: GAME_REVENUE_NOTE + ' Share of all revenue that day.'
    }
];

/**
 * Metric list for the Gaming dropdown: the total, then one entry per game the endpoint
 * returned (already ordered biggest-first by the API, so the dropdown reads the same way
 * the Gaming card does). Built from data, so adding a game to GAME_APP_PREFIXES makes it
 * appear here with no second edit.
 *
 * @param {Array<string>} games
 */
export function buildGameMetrics(games = []) {
    return [
        GAMING_TOTAL_METRIC,
        ...games.map(name => ({
            id: `${GAME_METRIC_PREFIX}${name}`,
            label: name,
            field: 'game_instances',
            format: 'number',
            group: 'Instances'
        })),
        ...GAME_REVENUE_METRICS
    ];
}

/**
 * One row per collected day for the selected metric.
 *
 * Days with no data are OMITTED rather than plotted as 0 -- game_snapshots only starts at
 * migration 013 and gaming_instances_total is NULL for every row before 012, and a
 * fabricated zero reads as "every game server on the network shut down", which is both
 * false and indistinguishable from a collection failure.
 *
 * A day that WAS collected but carries no row for the selected game is a different thing:
 * the collector writes a row for every game with at least one instance, so that game
 * genuinely ran none that day. Those are real zeros and are plotted -- which is why a
 * per-game series is built over the dates present in `history` rather than over the game's
 * own rows.
 *
 * @param {{games?: string[], history?: Array<{date: string, game: string, count: number}>,
 *          total?: Array<{date: string, count: number}>}} gameHistory
 * @param {string} metricId
 */
export function buildGameSnapshots(gameHistory, metricId) {
    if (!gameHistory) return [];

    // The total -- also the fallback for the moment before the availableMetrics reactive
    // block has moved selectedMetric off the previous category's id.
    if (!metricId?.startsWith(GAME_METRIC_PREFIX)) {
        return (gameHistory.total || []).map(r => ({ snapshot_date: r.date, game_instances: r.count }));
    }

    const game = metricId.slice(GAME_METRIC_PREFIX.length);
    const rows = gameHistory.history || [];
    const collectedDates = [...new Set(rows.map(r => r.date))].sort();
    const byDate = new Map(rows.filter(r => r.game === game).map(r => [r.date, r.count]));

    return collectedDates.map(date => ({
        snapshot_date: date,
        game_instances: byDate.get(date) ?? 0
    }));
}

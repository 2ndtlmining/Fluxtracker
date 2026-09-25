// Game-server revenue (issue #265). Pure.
//
// Rows from getDailyGameRevenueInRange (migration 024): per day, all revenue in FLUX and the
// part paid for game servers, recognised by app name (GAME_APP_NAME_PATTERN). Coverage is
// game servers deployed through Flux's game sites -- stated wherever the figure is shown.

export function shapeGameRevenueRows(rows) {
  const num = v => Number(v) || 0;
  return (rows ?? []).filter(row => row?.date).map(row => ({
    date: String(row.date).slice(0, 10),
    total_flux: num(row.total_flux),
    game_flux: num(row.game_flux),
    game_usd: num(row.game_usd)
  }));
}

/** Totals over a window, for the Gaming card: $ paid for game servers and their share. */
export function summarizeGameRevenue(rows) {
  const shaped = shapeGameRevenueRows(rows);
  const sum = key => shaped.reduce((total, row) => total + row[key], 0);
  const totalFlux = sum('total_flux');
  const gameFlux = sum('game_flux');
  return {
    usd: sum('game_usd'),
    flux: gameFlux,
    sharePercent: totalFlux > 0 ? Math.round((1000 * gameFlux) / totalFlux) / 10 : null
  };
}

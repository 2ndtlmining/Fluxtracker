/**
 * What the terminal header's idle rotation shows next. Pure functions, no DOM and no timers,
 * so every rule here is unit-tested (headerRotation.test.js) rather than only observable in
 * the smoke harness.
 */

/** How many recently shown apps we remember when choosing the next one. */
export const RECENT_HISTORY_LIMIT = 200;

/**
 * "Now playing" (issue #283): the next deployed app to show, from the whole 24h list.
 *
 * The header used to keep only the newest deployment, so it played the same app -- and,
 * with Dragonwilds at ~62% of deployments, the same dragon -- for up to twenty minutes while
 * the other ~120 apps of the day never appeared. This walks the list newest-first instead:
 *
 *  1. skip anything shown recently, until every app in the list has had a turn;
 *  2. among what is left, prefer the newest app whose intro differs from the last two shown,
 *     so the art alternates (dragon, longship, git merge...) rather than repeating;
 *  3. if nothing differs, take the newest remaining app anyway -- never skip an app forever.
 *
 * @param {Array<{name: string, blockAge?: number}>} apps /api/carousel/deployed stats
 * @param {Array<{name: string, key: string|null}>} recent shown so far, oldest first
 * @param {(app) => string|null} introKeyOf e.g. resolveIntroKey
 * @returns {{app, position: number, total: number}|null} position is 1 = newest
 */
export function pickNextDeployed(apps, recent = [], introKeyOf = () => null) {
  if (!Array.isArray(apps) || apps.length === 0) return null;

  const ordered = [...apps].sort((a, b) => (a.blockAge ?? Infinity) - (b.blockAge ?? Infinity));

  // Only the last (N - 1) names can block a pick, so a full round always leaves one app.
  const window = recent.slice(-Math.max(ordered.length - 1, 0));
  const shown = new Set(window.map(r => r.name));
  let pool = ordered.filter(app => !shown.has(app.name));
  if (pool.length === 0) pool = ordered;

  const lastKeys = recent.slice(-2).map(r => r.key);
  const pick = pool.find(app => !lastKeys.includes(introKeyOf(app))) || pool[0];

  return { app: pick, position: ordered.indexOf(pick) + 1, total: ordered.length };
}

/** Append to the shown-history, capped so a long-lived tab does not grow it forever. */
export function rememberShown(recent, app, key) {
  const next = [...recent, { name: app.name, key: key ?? null }];
  return next.length > RECENT_HISTORY_LIMIT ? next.slice(-RECENT_HISTORY_LIMIT) : next;
}

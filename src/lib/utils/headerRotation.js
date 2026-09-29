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
 * the other ~120 apps of the day never appeared. This walks the whole list instead:
 *
 *  1. skip anything shown recently, until every app in the list has had a turn;
 *  2. among what is left, take the intro with the MOST apps still waiting, other than the
 *     one just shown (issue #417). Preferring the newest app with a different intro, as this
 *     used to, kept deferring the dominant game until nothing else was left, so every round
 *     ended on ~20 Dragonwilds in a row. Draining the biggest group first spreads it across
 *     the round instead: dragon, longship, dragon, git merge...;
 *  3. within that intro, the newest app -- preferring one whose art variant differs from the
 *     last time that intro played, so dragon and campfire alternate;
 *  4. if only the last intro is left, show it anyway -- never skip an app forever.
 *
 * @param {Array<{name: string, blockAge?: number}>} apps /api/carousel/deployed stats
 * @param {Array<{name: string, key: string|null, variant?: number|null}>} recent shown so
 *   far, oldest first
 * @param {(app) => string|null} introKeyOf e.g. resolveIntroKey
 * @param {(app) => number|null} variantOf which art variant the app plays, if its intro has
 *   several
 * @returns {{app, position: number, total: number}|null} position is 1 = newest
 */
export function pickNextDeployed(apps, recent = [], introKeyOf = () => null, variantOf = () => null) {
  if (!Array.isArray(apps) || apps.length === 0) return null;

  const ordered = [...apps].sort((a, b) => (a.blockAge ?? Infinity) - (b.blockAge ?? Infinity));

  // Only the last (N - 1) names can block a pick, so a full round always leaves one app.
  const window = recent.slice(-Math.max(ordered.length - 1, 0));
  const shown = new Set(window.map(r => r.name));
  let pool = ordered.filter(app => !shown.has(app.name));
  if (pool.length === 0) pool = ordered;

  // Group what is left by intro, keeping newest-first order inside each group. A Map keeps
  // first-seen order, so on a tie the group holding the newest app wins.
  const groups = new Map();
  for (const app of pool) {
    const key = introKeyOf(app) ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(app);
  }

  const lastKey = recent.length ? recent.at(-1).key ?? null : undefined;
  let chosen = null;
  for (const [key, members] of groups) {
    if (key === lastKey) continue;
    if (!chosen || members.length > chosen.members.length) chosen = { key, members };
  }
  if (!chosen) chosen = { key: lastKey, members: groups.get(lastKey) };

  const lastVariant = [...recent].reverse().find(r => (r.key ?? null) === chosen.key)?.variant ?? null;
  const pick = (lastVariant !== null && chosen.members.find(app => variantOf(app) !== lastVariant))
    || chosen.members[0];

  return { app: pick, position: ordered.indexOf(pick) + 1, total: ordered.length };
}

/** Append to the shown-history, capped so a long-lived tab does not grow it forever. */
export function rememberShown(recent, app, key, variant = null) {
  const next = [...recent, { name: app.name, key: key ?? null, variant: variant ?? null }];
  return next.length > RECENT_HISTORY_LIMIT ? next.slice(-RECENT_HISTORY_LIMIT) : next;
}

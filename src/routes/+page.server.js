/**
 * Server-rendered first screen (issue #299).
 *
 * The page used to render nothing but "Loading..." skeletons on the server, then fetch every
 * card from the browser after hydration -- so first paint of real numbers waited on the JS
 * bundle, hydration and a round of client requests. The three hero cards' data (current
 * metrics and the default Daily revenue) is fetched here instead and arrives inside the HTML.
 *
 * Deliberately best-effort and bounded: `event.fetch` with a relative URL goes through
 * hooks.server.js's /api proxy exactly as a browser request would, and anything that is not
 * back within SSR_BUDGET_MS is left to the client's own fetch in onMount, as before. A slow
 * API must never make the HTML itself slow.
 */
import { fetchJson } from '$lib/utils/fetchJson.js';

const SSR_BUDGET_MS = 1500;

/** Resolve with `promise`'s value, or null if it fails or takes longer than `ms`. */
function withinBudget(promise, ms) {
  let timer;
  return Promise.race([
    promise.catch(() => null),
    new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })
  ]).finally(() => clearTimeout(timer));
}

/** @type {import('./$types').PageServerLoad} */
export async function load({ fetch }) {
  const [metrics, revenue] = await Promise.all([
    withinBudget(fetchJson('/api/metrics/current', fetch), SSR_BUDGET_MS),
    withinBudget(fetchJson('/api/revenue/daily', fetch), SSR_BUDGET_MS)
  ]);
  return { metrics, revenue, renderedAt: Date.now() };
}

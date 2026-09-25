// Median time left on running apps. Pure.
//
// Every app on Flux is paid up front for a fixed term (a week to a year), and its spec says
// when that term ends: registration/update height + expire blocks. The days left across
// every running app say how far ahead customers have committed. The MEDIAN, not the mean:
// measured 2026-09-26, 1,795 running apps had a median of 15.5 days but a mean of 46.8 -- a
// handful of 1-year apps drag an average up without saying anything about the typical app.
//
// Owner decisions (2026-09-26): every running app counts once, whatever its instance count,
// and Flux's own system apps are included (the registry has no reliable way to tell them
// apart, and a few of them barely move a median).

export const BLOCKS_PER_DAY = 2880;

/**
 * @param {object[]} specs          globalappsspecifications entries
 * @param {number}   currentHeight  the chain's current block height
 * @returns {{medianDays: number, apps: number} | null}  null when no app is running
 */
export function medianDaysLeft(specs, currentHeight) {
  if (!(currentHeight > 0)) return null;
  const days = [];
  for (const spec of specs ?? []) {
    const height = Number(spec?.height);
    const expire = Number(spec?.expire);
    // No known term: skipped, the same rule the Utilization Projection uses.
    if (!Number.isFinite(height) || !Number.isFinite(expire) || expire <= 0) continue;
    const blocksLeft = height + expire - currentHeight;
    // Past its expiry but still listed: the registry lags pruning. It is not running.
    if (blocksLeft <= 0) continue;
    days.push(blocksLeft / BLOCKS_PER_DAY);
  }
  if (days.length === 0) return null;
  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return { medianDays: Math.round(median * 10) / 10, apps: days.length };
}

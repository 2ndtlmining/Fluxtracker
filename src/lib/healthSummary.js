/**
 * One overall verdict for /api/health (issue #310). Pure, so every rule is unit-tested.
 *
 * The endpoint used to set `status` from the database ping alone and always answer 200, so a
 * monitor pointed at it saw "ok" while backups were two days stale, the snapshot had failed or
 * revenue sync had stopped. The sub-checks were all in the body; nothing looked at them.
 *
 *   down      the database is unreachable -> HTTP 503
 *   degraded  the database answers, but something else is wrong -> HTTP 200 + `problems`
 *   ok        nothing is wrong
 *
 * `degraded` stays a 200 deliberately: the dashboard is still serving, and a 503 would read to
 * a load balancer as "take this instance out", which a stale backup does not justify.
 */

/** Revenue sync counts as stalled after this many missed intervals. */
export const REVENUE_SYNC_STALE_INTERVALS = 3;

/** A services-cycle step is a problem after this many failed cycles in a row (#431). */
export const SERVICE_FAILURES_LIMIT = 3;

/**
 * @param {object} p
 * @param {boolean} p.dbReachable
 * @param {string} [p.activeInstance] 'primary' | 'failover' | 'sqlite'
 * @param {{enabled: boolean, isHealthy: boolean, partial?: boolean}} [p.backup]
 * @param {{healthy?: boolean}} [p.snapshot]
 * @param {{healthy?: boolean}} [p.priceHistory]
 * @param {{lastSyncMs: number|null, intervalMs: number, consecutiveFailures?: number}} [p.revenueSync]
 * @param {Record<string, {lastSuccess: number|null, consecutiveFailures: number, lastError?: string}>} [p.services]
 * @param {boolean} [p.livePriceLost] no live FLUX price and no usable fallback (#431)
 * @param {number} [p.now]
 * @returns {{status: 'ok'|'degraded'|'down', httpStatus: number, problems: string[]}}
 */
export function summarizeHealth({
  dbReachable,
  activeInstance,
  backup,
  snapshot,
  priceHistory,
  revenueSync,
  services,
  livePriceLost = false,
  now = Date.now()
}) {
  if (!dbReachable) {
    return { status: 'down', httpStatus: 503, problems: ['database unreachable'] };
  }

  const problems = [];
  if (activeInstance === 'failover') problems.push('running on the failover database');
  if (backup?.enabled && !backup.isHealthy) problems.push('backup is stale or has never run');
  if (backup?.enabled && backup.partial) problems.push('last backup was missing tables');
  if (snapshot && snapshot.healthy === false) problems.push('daily snapshot is failing or overdue');
  if (priceHistory && priceHistory.healthy === false) problems.push('price history is stale');

  if (revenueSync) {
    const { lastSyncMs, intervalMs, consecutiveFailures = 0 } = revenueSync;
    const staleAfter = intervalMs * REVENUE_SYNC_STALE_INTERVALS;
    if (!Number.isFinite(lastSyncMs)) {
      problems.push('revenue sync has never completed');
    } else if (now - lastSyncMs > staleAfter) {
      problems.push(`revenue sync last completed ${Math.round((now - lastSyncMs) / 60000)} min ago`);
    }
    if (consecutiveFailures >= 3) problems.push(`revenue sync failed ${consecutiveFailures} times in a row`);
  }

  // #431: a services-cycle step that keeps failing leaves its numbers frozen on the cards and
  // in that night's snapshot. Name it.
  for (const [name, s] of Object.entries(services ?? {})) {
    if ((s?.consecutiveFailures ?? 0) < SERVICE_FAILURES_LIMIT) continue;
    const since = Number.isFinite(s.lastSuccess)
      ? `last success ${Math.round((now - s.lastSuccess) / 60000)} min ago`
      : 'no success since restart';
    problems.push(`${name} refresh failed ${s.consecutiveFailures} cycles in a row (${since})`);
  }

  if (livePriceLost) problems.push('no live FLUX price and no usable fallback');

  return problems.length > 0
    ? { status: 'degraded', httpStatus: 200, problems }
    : { status: 'ok', httpStatus: 200, problems };
}

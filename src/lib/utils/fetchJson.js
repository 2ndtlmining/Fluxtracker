/**
 * fetch + JSON with an honest failure (issue #319).
 *
 * The dashboard's card fetches used to `await response.json()` and treat whatever came back as
 * data -- including `{ error: 'Service unavailable' }` from a 503. The cards then fell back to
 * `|| 0` and showed a failed load as $0.00, 0 nodes and a "Poor Demand" badge, with nothing to
 * say it was a failure.
 *
 * Resolves with the body when it is real data. A 503 that still carries withDbFallback's stale
 * cache (`_stale: true`) counts as data -- it is the last good reading, and the caller can mark
 * it as old. Everything else rejects: a non-2xx status, an unparseable body, or `{ error }`.
 *
 * @param {string} url
 * @param {typeof fetch} [fetchImpl] injectable for tests
 * @returns {Promise<object>}
 */
export async function fetchJson(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const staleButUsable = body && body._stale === true && !body.error;
  if ((!response.ok && !staleButUsable) || !body || body.error) {
    const error = new Error(body?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/** "14:05" in the viewer's local time, for "showing data from ..." notes. */
export function formatClockTime(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

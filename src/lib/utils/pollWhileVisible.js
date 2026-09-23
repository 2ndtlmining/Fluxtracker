/**
 * `setInterval`, but idle while the tab is hidden (issue #298).
 *
 * Every card polled on its own timer whether or not anyone could see it -- a dashboard left
 * open in a background tab kept making ~360 header requests an hour plus the page, carousel,
 * busiest-node and decentralization polls. Ticks that land while the tab is hidden are
 * skipped; if any were skipped, `fn` runs once as soon as the tab is visible again, so a
 * returning viewer sees current data straight away instead of waiting out the interval.
 *
 * @param {() => unknown} fn
 * @param {number} intervalMs
 * @param {{doc?: Document}} [opts] injectable for tests
 * @returns {() => void} stop
 */
export function pollWhileVisible(fn, intervalMs, { doc = typeof document !== 'undefined' ? document : null } = {}) {
  let missed = false;

  const tick = () => {
    if (doc?.hidden) {
      missed = true;
      return;
    }
    fn();
  };

  const onVisibility = () => {
    if (!doc.hidden && missed) {
      missed = false;
      fn();
    }
  };

  const id = setInterval(tick, intervalMs);
  doc?.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(id);
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}

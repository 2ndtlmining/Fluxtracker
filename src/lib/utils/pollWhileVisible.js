/**
 * `setInterval`, but idle while the tab is hidden (issue #298).
 *
 * Every card polled on its own timer whether or not anyone could see it -- a dashboard left
 * open in a background tab kept making ~360 header requests an hour plus the page, carousel,
 * busiest-node and decentralization polls. Ticks that land while the tab is hidden are
 * skipped; if any were skipped, `fn` runs once as soon as the tab is visible again, so a
 * returning viewer sees current data straight away instead of waiting out the interval.
 *
 * A call is never started while the previous one is still running: if `fn` returns a promise
 * that outlives the interval (a slow API), the ticks in between are skipped rather than
 * stacking up a second, third... refresh behind it.
 *
 * @param {() => unknown} fn
 * @param {number} intervalMs
 * @param {{doc?: Document}} [opts] injectable for tests
 * @returns {() => void} stop
 */
export function pollWhileVisible(fn, intervalMs, { doc = typeof document !== 'undefined' ? document : null } = {}) {
  let missed = false;
  let running = false;

  const run = () => {
    if (running) return;
    const result = fn();
    if (typeof result?.then === 'function') {
      running = true;
      const done = () => { running = false; };
      result.then(done, done);
    }
  };

  const tick = () => {
    if (doc?.hidden) {
      missed = true;
      return;
    }
    run();
  };

  const onVisibility = () => {
    if (!doc.hidden && missed) {
      missed = false;
      run();
    }
  };

  const id = setInterval(tick, intervalMs);
  doc?.addEventListener('visibilitychange', onVisibility);

  return () => {
    clearInterval(id);
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}

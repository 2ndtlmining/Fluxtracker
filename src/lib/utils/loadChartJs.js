/**
 * Chart.js, loaded on demand and registered with only what the dashboard draws (issue #297).
 *
 * `import Chart from 'chart.js/auto'` put every controller, scale and plugin into the one page
 * chunk -- ~59% of it -- on the critical path of first paint, for a chart that sits below the
 * fold. The dynamic import splits it into its own chunk that downloads after hydration, and
 * the explicit registration drops the controllers the dashboard never uses (bar, pie,
 * radar, ...). Everything Chart.svelte asks for: a filled line on category/linear axes, with
 * tooltip and legend.
 *
 * One promise for the page's lifetime, so remounting the chart does not re-register.
 */
let loading = null;

export function loadChartJs() {
  if (!loading) {
    loading = import('chart.js').then(m => {
      m.Chart.register(
        m.LineController,
        m.LineElement,
        m.PointElement,
        m.LinearScale,
        m.CategoryScale,
        m.Filler,
        m.Tooltip,
        m.Legend
      );
      return m.Chart;
    });
    // A failed load (a flaky connection) must not be cached for the page's lifetime.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * Apply dynamic styles through the CSSOM rather than a style="" attribute.
 *
 * ── Why this exists ──
 * This app's CSP (src/lib/security/contentSecurityPolicy.js) sets
 * `style-src 'self'` with no 'unsafe-inline'. That directive
 * governs inline style ATTRIBUTES as well as <style> blocks, so the browser refuses to parse
 * `style="height: 1050px"` at all: the attribute stays visible in the DOM while
 * `element.style.height` reads back empty and the declaration never applies.
 *
 * The CSP comment claimed the app had "no inline <style>" -- true, but it overlooked inline
 * style attributes, which is what every dynamic style in this app was using. The chart's
 * height was silently dropped and it sat at Chart.js's 150px default no matter what was
 * passed, through several rounds of "make the chart taller" that changed nothing.
 *
 * Svelte's `style:` directive is NOT a reliable fix on its own. It compiles to
 * element.style.setProperty() -- a CSSOM write, which CSP permits -- but only runs on CHANGE.
 * Server-rendered markup already carries the (blocked) attribute, so a value that never
 * changes after hydration is never re-set, and stays broken. That is exactly why the carousel
 * scroll duration worked (it changes once slides load) while the chart height did not.
 *
 * This action always writes on mount, so it works for static and changing values alike.
 *
 * @example
 *   <div use:cssomStyle={{ height: `${height}px` }}>
 *   <div use:cssomStyle={{ '--box-rows': rowCount }}>
 *
 * @param {HTMLElement} node
 * @param {Record<string, string|number>} styles property name -> value; names starting with
 *   `--` are set as custom properties, anything else as a standard CSS property.
 */
export function cssomStyle(node, styles) {
    apply(node, styles);
    return {
        update(next) {
            apply(node, next);
        }
    };
}

function apply(node, styles) {
    if (!styles) return;
    for (const [property, value] of Object.entries(styles)) {
        if (value === null || value === undefined) continue;
        // setProperty handles both custom properties and standard ones, and is a CSSOM write
        // in either case -- which is the whole point.
        node.style.setProperty(property, String(value));
    }
}

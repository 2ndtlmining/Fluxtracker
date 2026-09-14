// Serialisation for the TEAM/FIAT payer filter (issues #159, #173).
//
// Extracted from RevenueTransactionsTable so it can be tested directly, and -- more
// importantly -- so callers get the value by CALLING it rather than by reading a Svelte
// reactive variable.
//
// That distinction is the whole bug behind #173. The component previously held the value in
// `$: sourceParam = [...activeSources].sort().join(',')` and read it inside a click handler
// that had just reassigned `activeSources`. Svelte 4 batches reactive statements until the
// next update cycle, so the handler read the PREVIOUS value: the badges rendered the new
// selection while the request carried the old one, and the table lagged the buttons by
// exactly one click. Clearing Team still sent `team`; selecting Team sent nothing.

/**
 * Serialise the active payer sources for the API and the export filename.
 *
 * Sorted so the same selection always produces the same string regardless of the order the
 * badges were clicked -- which keeps cache keys and export filenames stable.
 *
 * @param {Set<string>|Iterable<string>} sources active source names, e.g. a Set of "team"/"fiat"
 * @returns {string} e.g. "fiat,team", or "" for no filter
 */
export function serialiseSources(sources) {
    if (!sources) return '';
    return [...sources].sort().join(',');
}

/**
 * The set that results from clicking one badge: present sources toggle off, absent ones on.
 *
 * Returns a NEW Set rather than mutating -- Svelte 4 does not track Set mutation, so an
 * in-place add/delete would leave the UI showing the old selection.
 *
 * @param {Set<string>} sources current selection
 * @param {string} source the badge that was clicked
 * @returns {Set<string>} the new selection
 */
export function toggleSource(sources, source) {
    const next = new Set(sources);
    if (next.has(source)) {
        next.delete(source);
    } else {
        next.add(source);
    }
    return next;
}

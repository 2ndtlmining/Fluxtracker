/**
 * Column-oriented JSON for wide row sets (issue #389).
 *
 * /api/history/snapshots/full returns ~840 daily snapshots of 64 columns. As an array of
 * objects every row repeats all 64 key names, which is most of the ~1.3 MB the chart parsed
 * at "All". `{ columns, rows }` names each key once; the chart expands it back to the row
 * objects it always used, so nothing downstream changes.
 */

export function toColumnar(objects) {
    if (!objects?.length) return { columns: [], rows: [] };
    const columns = Object.keys(objects[0]);
    return { columns, rows: objects.map(o => columns.map(c => o[c] ?? null)) };
}

export function fromColumnar({ columns, rows }) {
    return (rows ?? []).map(r => {
        const o = {};
        for (let i = 0; i < columns.length; i++) o[columns[i]] = r[i];
        return o;
    });
}

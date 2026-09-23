/**
 * Every table the R2 backup carries, in one list (issue #311).
 *
 * Backup, restore and the SQLite bootstrap each used to name their tables by hand, and they
 * drifted: game_snapshots reached backup and restore but never bootstrap, and the
 * decentralization history -- which cannot be re-derived from the chain -- reached none of
 * them. Adding a table is now one entry here, and all three paths pick it up.
 *
 * Each entry: `table` (also the object name, `<table>.json`), `required` (a backup or restore
 * without it is a failure, not a partial), `exportRows()` and `importRows(rows)`.
 */
import {
    exportAllDailySnapshots,
    exportAllRepoSnapshots,
    exportAllGameSnapshots,
    exportAllPriceHistory,
    upsertDailySnapshots,
    upsertRepoSnapshots,
    upsertGameSnapshots,
    upsertPriceHistory,
    getAllNodeIpClassifications,
    upsertNodeIpClassifications,
    getDecentralizationDimensionSnapshotHistory,
    createDecentralizationDimensionSnapshots
} from '../db/database.js';
import { BREAKDOWN_DIMENSIONS } from '../decentralizationDimensions.js';

// The history reads take a date range; this one spans every row a table can hold.
const ALL_DATES = ['0000-01-01', '9999-12-31'];

/**
 * Write exported dimension rows back through the existing per-date snapshot writer, so no new
 * adapter function is needed. Rows come out as table columns (`org`, `country_code`,
 * `node_count`...) and the writer takes breakdown items (`org`, `countryCode`, `count`...);
 * the dimension entry says which is which.
 */
export async function importDimensionRows(dimensionKey, rows) {
    const dimension = BREAKDOWN_DIMENSIONS[dimensionKey];
    const byDate = new Map();
    for (const row of rows || []) {
        const item = { [dimension.nameField]: row[dimension.nameColumn], count: row.node_count };
        if (dimension.codeColumn) item[dimension.codeField] = row[dimension.codeColumn] ?? null;
        if (!byDate.has(row.snapshot_date)) byDate.set(row.snapshot_date, []);
        byDate.get(row.snapshot_date).push(item);
    }
    let written = 0;
    for (const [date, items] of byDate) {
        written += await createDecentralizationDimensionSnapshots(dimensionKey, date, items);
    }
    return written;
}

const dimensionTable = (key) => ({
    table: BREAKDOWN_DIMENSIONS[key].table,
    required: false,
    exportRows: () => getDecentralizationDimensionSnapshotHistory(key, ...ALL_DATES),
    importRows: (rows) => importDimensionRows(key, rows)
});

export const BACKUP_TABLES = [
    { table: 'daily_snapshots', required: true, exportRows: exportAllDailySnapshots, importRows: upsertDailySnapshots },
    { table: 'repo_snapshots', required: true, exportRows: exportAllRepoSnapshots, importRows: upsertRepoSnapshots },
    { table: 'game_snapshots', required: false, exportRows: exportAllGameSnapshots, importRows: upsertGameSnapshots },
    { table: 'flux_price_history', required: false, exportRows: exportAllPriceHistory, importRows: upsertPriceHistory },
    // Where each node IP is (provider, country, continent). Re-derivable only by looking every
    // IP up again against rate-limited geo APIs, so it is worth carrying.
    { table: 'node_ip_classification', required: false, exportRows: getAllNodeIpClassifications, importRows: upsertNodeIpClassifications },
    dimensionTable('datacenter'),
    dimensionTable('country'),
    dimensionTable('continent')
];

export const BACKUP_TABLE_NAMES = BACKUP_TABLES.map(t => t.table);

// src/lib/decentralizationDimensions.js
//
// The one place a decentralization breakdown dimension is described (issue #151).
//
// Country and continent arrived in #138 as near-identical copies of the datacenter
// breakdown, duplicated across four modules: decentralizationService's getFull*Breakdown()
// twins, the create/read pair in each adapter, and snapshotManager's per-dimension blocks.
// Adding a third dimension meant editing all four, and every bugfix had to be applied twice.
//
// Everything a dimension needs now lives in one entry here: which field on a classification
// row it groups by, what an unclassified row groups under, and which table and columns it is
// stored in. Adding a dimension is one entry plus a migration for its table.
//
// Deliberately dependency-free so both the service layer and the DB adapters can import it
// without a cycle.

/**
 * @typedef {object} BreakdownDimension
 * @property {string} key          identifier used by the adapters' generic functions
 * @property {string} nameField    property on a classification row holding the display name
 * @property {string|null} codeField  property holding the short code, if the dimension has one
 * @property {string|null} sentinel   group for rows with no value, or null to drop them
 * @property {string} table        snapshot table
 * @property {string} nameColumn   column holding the name
 * @property {string|null} codeColumn column holding the code, if any
 * @property {string} conflict     the table's unique key, for upserts
 */

/** @type {Record<string, BreakdownDimension>} */
export const BREAKDOWN_DIMENSIONS = {
    // The datacenter dimension is not a plain group-by: rows split on isDatacenter first, and
    // the non-datacenter side collapses into one '(independent)' bucket. Its entry carries
    // only the storage half, which IS shared; the grouping stays in its own function.
    datacenter: {
        key: 'datacenter',
        nameField: 'org',
        codeField: null,
        sentinel: 'Unknown',
        table: 'decentralization_snapshots',
        nameColumn: 'org',
        codeColumn: null,
        conflict: 'snapshot_date,org'
    },
    country: {
        key: 'country',
        nameField: 'country',
        codeField: 'countryCode',
        // A missing country (classification pending, or both providers omitted it) groups
        // here rather than being dropped, so the node count still adds up.
        sentinel: '(unknown)',
        table: 'decentralization_country_snapshots',
        nameColumn: 'country',
        codeColumn: 'country_code',
        conflict: 'snapshot_date,country'
    },
    continent: {
        key: 'continent',
        nameField: 'continent',
        codeField: 'continentCode',
        sentinel: '(unknown)',
        table: 'decentralization_continent_snapshots',
        nameColumn: 'continent',
        codeColumn: 'continent_code',
        conflict: 'snapshot_date,continent'
    }
};

/** Dimensions that are a plain group-by over a name (and optional code) field. */
export const NAMED_DIMENSION_KEYS = ['country', 'continent'];

/**
 * Look a dimension up by key.
 *
 * This is a whitelist, and it is the security control for the adapters: SQL identifiers
 * cannot be bound as parameters, so a table or column name reaching a query string has to
 * come from here and never from a caller's string. An unknown key throws rather than
 * building a query.
 *
 * @param {string} key
 * @returns {BreakdownDimension}
 */
export function resolveDimension(key) {
    const dimension = BREAKDOWN_DIMENSIONS[key];
    if (!dimension) {
        throw new Error(`Unknown decentralization dimension: ${key}`);
    }
    return dimension;
}

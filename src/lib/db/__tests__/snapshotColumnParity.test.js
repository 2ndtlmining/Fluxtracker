import { describe, it, expect } from 'vitest';
import { METRIC_COLUMNS, GAMING_REPOS, CRYPTO_REPOS } from '../../config.js';
import { buildSnapshotData } from '../snapshotManager.js';

/**
 * Issue #229 — every METRIC_COLUMNS entry must reach daily_snapshots at CREATION.
 *
 * The bug this pins: snapshotManager named the gaming columns literally and never gained
 * the games added to GAMING_REPOS later. Because schemaMigrator creates game columns as
 * `INTEGER DEFAULT 0`, an unwritten column lands as 0 rather than NULL — and the NULL
 * top-up (which fills only NULLs) can therefore never repair it. The result was
 * gaming_rust/terraria/ark/windrose recording a fabricated 0 every single day while
 * current_metrics held the real count.
 *
 * The lesson is that the correspondence between the config list and the snapshot writer was
 * never asserted anywhere, so this test asserts exactly that and nothing cleverer.
 */

/** A current_metrics row with a DISTINCT non-zero value per column, so a dropped or
 *  crossed-over column shows up as a wrong number rather than coincidentally matching. */
function metricsFixture() {
    const row = {};
    METRIC_COLUMNS.forEach((col, i) => { row[col] = i + 1; });
    return row;
}

function build(overrides = {}) {
    return buildSnapshotData({
        snapshotDate: '2026-09-21',
        now: new Date('2026-09-21T00:00:00Z'),
        actualRevenue: 123,
        currentMetrics: metricsFixture(),
        decentralization: null,
        hasDecentralizationClassifications: false,
        fluxCloudActivity: null,
        ...overrides
    });
}

describe('buildSnapshotData column parity (issue #229)', () => {
    it('writes every METRIC_COLUMNS entry that belongs on daily_snapshots', () => {
        // `current_revenue` is a current_metrics-only column -- daily_snapshots stores the
        // day's figure as daily_revenue, and fillSnapshotNullColumns already skips any
        // column that does not exist on the row.
        const expected = METRIC_COLUMNS.filter(c => c !== 'current_revenue');
        const written = Object.keys(build());

        expect(expected.filter(c => !written.includes(c))).toEqual([]);
    });

    it('writes every configured game, not a hardcoded subset', () => {
        // The exact regression: adding a game to GAMING_REPOS must reach the snapshot.
        const data = build();
        for (const repo of GAMING_REPOS) {
            expect(data, `missing ${repo.dbKey} (${repo.name})`).toHaveProperty(repo.dbKey);
        }
    });

    it('writes every configured crypto node', () => {
        const data = build();
        for (const repo of CRYPTO_REPOS) {
            expect(data, `missing ${repo.dbKey} (${repo.name})`).toHaveProperty(repo.dbKey);
        }
    });

    it('carries the real value through rather than a placeholder zero', () => {
        // The failure mode was a 0 written over a real reading, so assert the VALUE, not
        // merely the key's presence.
        const metrics = metricsFixture();
        const data = build({ currentMetrics: metrics });

        for (const repo of GAMING_REPOS) {
            expect(data[repo.dbKey], `${repo.dbKey} lost its value`).toBe(metrics[repo.dbKey]);
        }
    });

    it('keeps the nullable columns null when the reading is absent, never 0', () => {
        // These six have no DEFAULT precisely so absent reads back as "not collected".
        // A fabricated 0 would be averaged into KPI reports as a real reading.
        const data = build({ currentMetrics: {} });

        for (const col of [
            'unique_wallets', 'unique_app_owners', 'locked_collateral',
            'locked_collateral_cumulus', 'locked_collateral_nimbus', 'locked_collateral_stratus'
        ]) {
            expect(data[col], `${col} should be null when unread`).toBeNull();
        }
    });

    it('keeps the DEFAULT 0 columns at 0 when absent, preserving existing history semantics', () => {
        // Counter-part to the above: these columns have years of history written with
        // `|| 0`, and flipping them to null would put gaps in existing trend lines.
        const data = build({ currentMetrics: {} });

        expect(data.total_apps).toBe(0);
        expect(data.node_total).toBe(0);
        expect(data.gaming_palworld).toBe(0);
    });

    it('still records the fields that do not come from current_metrics', () => {
        const data = build();

        expect(data.snapshot_date).toBe('2026-09-21');
        expect(data.daily_revenue).toBe(123);
        expect(data.sync_status).toBe('completed');
        expect(typeof data.timestamp).toBe('number');
    });
});

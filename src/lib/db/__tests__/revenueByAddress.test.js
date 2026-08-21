import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { isFluxFiatAddress, isFluxTeamAddress, FLUX_FIAT_ADDRESSES, FLUX_TEAM_ADDRESSES } from '../../config.js';

/**
 * Revenue attribution by sender address, against a real SQLite DB.
 *
 * The point of these tests is that the address *lists* work with any number of entries —
 * gateways get rotated and added, and adding one to config.js must be the only change
 * required for the badge, the CSV and the KPI figure to pick it up.
 */

let db;

const A = 't1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = 't1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const OTHER = 't1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

/** Same SQL shape the adapter uses. */
function getRevenueFromAddresses(db, startDate, endDate, addresses) {
    if (!addresses || addresses.length === 0) return { revenue: 0, payments: 0 };
    const placeholders = addresses.map(() => '?').join(',');
    const row = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS payments
        FROM revenue_transactions
        WHERE date >= ? AND date <= ? AND from_address IN (${placeholders})
    `).get(startDate, endDate, ...addresses);
    return { revenue: row.revenue || 0, payments: row.payments || 0 };
}

function insert(db, rows) {
    const stmt = db.prepare(`
        INSERT INTO revenue_transactions (txid, address, from_address, amount, block_height, timestamp, date)
        VALUES (@txid, 'dest', @from_address, @amount, @block_height, 0, @date)
    `);
    rows.forEach((r, i) => stmt.run({ block_height: 1000 + i, txid: `tx-${i}`, ...r }));
}

beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
        CREATE TABLE revenue_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            from_address TEXT DEFAULT 'Unknown',
            amount REAL NOT NULL,
            amount_usd REAL,
            block_height INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            date DATE NOT NULL
        );
    `);

    insert(db, [
        { from_address: A, amount: 100, date: '2026-08-10' },
        { from_address: A, amount: 50, date: '2026-08-12' },
        { from_address: B, amount: 25, date: '2026-08-11' },
        { from_address: OTHER, amount: 900, date: '2026-08-11' },
        { from_address: A, amount: 999, date: '2026-08-20' }   // outside the range
    ]);
});

describe('revenue attribution by address list', () => {
    it('sums a single configured address', () => {
        const r = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A]);
        expect(r).toEqual({ revenue: 150, payments: 2 });
    });

    it('sums across several addresses — the case that matters when a gateway is added', () => {
        const r = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A, B]);
        expect(r).toEqual({ revenue: 175, payments: 3 });
    });

    it('adding an address only ever increases the figure', () => {
        const one = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A]);
        const two = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A, B]);
        expect(two.revenue).toBeGreaterThan(one.revenue);
    });

    it('ignores addresses with no transactions rather than failing', () => {
        const r = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A, 't1UNUSED']);
        expect(r).toEqual({ revenue: 150, payments: 2 });
    });

    it('excludes senders that are not in the list', () => {
        const r = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A, B]);
        expect(r.revenue).not.toBe(1075); // would include OTHER
    });

    it('respects the date range', () => {
        const r = getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [A]);
        expect(r.revenue).toBe(150); // the 999 on 2026-08-20 is outside
    });

    it('returns zero for an empty address list instead of matching everything', () => {
        // A bare `IN ()` would be a syntax error, and treating empty as "all" would report
        // total revenue as fiat revenue
        expect(getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', [])).toEqual({ revenue: 0, payments: 0 });
        expect(getRevenueFromAddresses(db, '2026-08-10', '2026-08-16', null)).toEqual({ revenue: 0, payments: 0 });
    });
});

describe('address list helpers', () => {
    it('recognises every configured fiat address', () => {
        expect(FLUX_FIAT_ADDRESSES.length).toBeGreaterThan(0);
        for (const address of FLUX_FIAT_ADDRESSES) {
            expect(isFluxFiatAddress(address), address).toBe(true);
        }
    });

    it('recognises every configured team address', () => {
        for (const address of FLUX_TEAM_ADDRESSES) {
            expect(isFluxTeamAddress(address), address).toBe(true);
        }
    });

    it('does not confuse the two lists', () => {
        for (const address of FLUX_FIAT_ADDRESSES) {
            expect(isFluxTeamAddress(address), address).toBe(false);
        }
        for (const address of FLUX_TEAM_ADDRESSES) {
            expect(isFluxFiatAddress(address), address).toBe(false);
        }
    });

    it('rejects unrelated and malformed addresses', () => {
        expect(isFluxFiatAddress(OTHER)).toBe(false);
        expect(isFluxFiatAddress('')).toBe(false);
        expect(isFluxFiatAddress(null)).toBe(false);
        expect(isFluxFiatAddress(undefined)).toBe(false);
    });

    it('matches on the exact address, not a prefix', () => {
        const configured = FLUX_FIAT_ADDRESSES[0];
        expect(isFluxFiatAddress(configured.slice(0, -1))).toBe(false);
        expect(isFluxFiatAddress(configured + 'X')).toBe(false);
    });
});

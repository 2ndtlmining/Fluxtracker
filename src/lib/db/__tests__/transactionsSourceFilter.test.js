import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Issue #159: clicking the TEAM / FIAT badges filters the transaction history to those
 * payers. The filter is an address-set match (FLUX_TEAM_ADDRESSES / FLUX_FIAT_ADDRESSES
 * are lists that grow), so it cannot ride on the existing free-text search -- it needs a
 * real server-side predicate, AND-ed with whatever search/app filter is already active.
 *
 * Runs the REAL sqliteAdapter against a temp-file database, same pattern as
 * decentralizationSnapshots.test.js.
 */

const tmpPath = path.join(os.tmpdir(), `transactions-source-${process.pid}-${Date.now()}.sqlite3`);
process.env.DB_PATH = tmpPath;
process.env.DB_TYPE = 'sqlite';

const adapter = await import('../adapters/sqliteAdapter.js');

const TEAM = 't1gjUUxBpBeVC1sWwAFrtSsVCbSaFdZx8UY';
const FIAT = 't1XktDZ9Z1QiefMYE5nMFohe8VG2c2BD5A5';
const RANDO = 't1SomeoneElsePaidThisOneThemselves99';

beforeAll(async () => {
    await adapter.initDatabase();
    await adapter.insertTransactionsBatch([
        { txid: 'tx-team-1', address: 'addr', from_address: TEAM, amount: 10, amount_usd: 1, block_height: 100, timestamp: 1000, date: '2026-09-01', app_name: 'alpha', app_type: 'docker' },
        { txid: 'tx-team-2', address: 'addr', from_address: TEAM, amount: 20, amount_usd: 2, block_height: 101, timestamp: 1001, date: '2026-09-02', app_name: 'beta', app_type: 'docker' },
        { txid: 'tx-fiat-1', address: 'addr', from_address: FIAT, amount: 30, amount_usd: 3, block_height: 102, timestamp: 1002, date: '2026-09-03', app_name: 'alpha', app_type: 'git' },
        { txid: 'tx-other-1', address: 'addr', from_address: RANDO, amount: 40, amount_usd: 4, block_height: 103, timestamp: 1003, date: '2026-09-04', app_name: 'gamma', app_type: 'git' },
        { txid: 'tx-other-2', address: 'addr', from_address: RANDO, amount: 50, amount_usd: 5, block_height: 104, timestamp: 1004, date: '2026-09-05', app_name: 'alpha', app_type: 'git' }
    ]);
});

afterAll(() => {
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
});

const txids = r => r.transactions.map(t => t.txid).sort();

describe('getTransactionsPaginated address-set filter (issue #159)', () => {
    it('returns everything when no address filter is given (unchanged behaviour)', async () => {
        const r = await adapter.getTransactionsPaginated(1, 50, '', null);
        expect(r.total).toBe(5);
    });

    it('filters to a single payer set', async () => {
        const r = await adapter.getTransactionsPaginated(1, 50, '', null, [TEAM]);
        expect(txids(r)).toEqual(['tx-team-1', 'tx-team-2']);
        expect(r.total).toBe(2);
    });

    it('treats multiple sets as OR -- TEAM and FIAT together show both', async () => {
        const r = await adapter.getTransactionsPaginated(1, 50, '', null, [TEAM, FIAT]);
        expect(txids(r)).toEqual(['tx-fiat-1', 'tx-team-1', 'tx-team-2']);
    });

    it('ANDs with the free-text search rather than replacing it', async () => {
        // 'alpha' alone matches 3 rows across all three payers; with the team filter, 1.
        const unfiltered = await adapter.getTransactionsPaginated(1, 50, 'alpha', null);
        expect(unfiltered.total).toBe(3);

        const filtered = await adapter.getTransactionsPaginated(1, 50, 'alpha', null, [TEAM]);
        expect(txids(filtered)).toEqual(['tx-team-1']);
        expect(filtered.total).toBe(1);
    });

    it('ANDs with an app-name filter too', async () => {
        const r = await adapter.getTransactionsPaginated(1, 50, '', 'alpha', [FIAT]);
        expect(txids(r)).toEqual(['tx-fiat-1']);
    });

    it('reports a total consistent with the filter, so pagination is not wrong', async () => {
        const r = await adapter.getTransactionsPaginated(1, 1, '', null, [TEAM, FIAT]);
        expect(r.transactions).toHaveLength(1);
        expect(r.total).toBe(3); // total counts the filtered set, not the page
    });

    it('an empty address list is treated as no filter, not as "match nothing"', async () => {
        const r = await adapter.getTransactionsPaginated(1, 50, '', null, []);
        expect(r.total).toBe(5);
    });
});

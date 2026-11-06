import { describe, it, expect, vi } from 'vitest';

/**
 * Issue #567: a spec-only update costs a few hundredths of a FLUX and buys nothing, so it is
 * not a deployment. The old rule only knew one wallet paying exactly 0.02, and 1,070 updates
 * at 0.03 from a new wallet were stored and counted as deployments in a single day. The rule
 * is now the amount alone: whoever sends it, under 0.1 FLUX is not a payment we store.
 */

vi.mock('../../../db/database.js', () => ({}));

import { processTransaction } from '../transactionSync.js';

const TRACKED = 't3tracked';
const TEAM_WALLET = 't1Mzja9iJcEYeW5B4m4s1tJG8M42odFZ16A';
const NEW_WALLET = 't1McMzkjKyJWJZVhsBYr1rrzMx2J28cmHWK';

function tx(from, value) {
    return {
        txid: `tx-${from}-${value}`,
        blocktime: 1793978374,
        height: 3102743,
        vin: [{ addresses: [from] }],
        vout: [{ value: String(value), scriptPubKey: { addresses: [TRACKED] } }]
    };
}

const stored = (from, value) => processTransaction(tx(from, value), [TRACKED], null, 'someapp', 'docker');

describe('minimum stored payment (#567)', () => {
    it('drops the 0.03 FLUX updates from the wallet in the issue', () => {
        expect(stored(NEW_WALLET, '0.03000000')).toEqual([]);
    });

    it('still drops the 0.02 FLUX fees from the Flux team wallet', () => {
        expect(stored(TEAM_WALLET, '0.02000000')).toEqual([]);
    });

    it('drops the largest fee under the cutoff, from any wallet', () => {
        expect(stored(NEW_WALLET, '0.09999999')).toEqual([]);
    });

    it('keeps a payment of exactly 0.1 FLUX', () => {
        expect(stored(NEW_WALLET, '0.10000000')).toHaveLength(1);
    });

    it('keeps real payments, including from the wallets above', () => {
        expect(stored(NEW_WALLET, '25.22000000')).toHaveLength(1);
        expect(stored(TEAM_WALLET, '42.04000000')).toHaveLength(1);
    });
});

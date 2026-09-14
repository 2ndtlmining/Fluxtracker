import { describe, it, expect, vi } from 'vitest';

/**
 * OP_RETURN classification (issue #188).
 *
 * Two kinds of payment reach the same Flux address with an OP_RETURN attached: an app
 * registration, whose 64-hex spec hash resolves to an app name, and a FluxDrive storage
 * payment, whose reference resolves to nothing anywhere in the Flux APIs. The second used to
 * be indistinguishable from a failed name lookup -- a blank cell either way.
 *
 * The FluxDrive pattern is matched EXACTLY rather than by prefix, because the classification
 * is inferred from on-chain behaviour rather than any documented convention: label only what
 * we are sure about, and leave anything differently shaped unclassified.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn(),
    getAppNameByHash: vi.fn(() => null),
    getAppTypeByName: vi.fn(() => null),
    determineAppType: vi.fn(() => 'docker')
}));
vi.mock('../../db/database.js', () => ({
    updateSyncStatus: vi.fn(),
    getSyncStatus: vi.fn(),
    insertTransactionsBatch: vi.fn(),
    getTxidCount: vi.fn(),
    upsertFailedTxid: vi.fn(),
    getUnresolvedFailedTxids: vi.fn(),
    resolveFailedTxid: vi.fn()
}));
vi.mock('../priceHistoryService.js', () => ({
    syncPriceHistory: vi.fn(),
    buildFullPriceMap: vi.fn(),
    repairTodaysNullUsd: vi.fn()
}));
vi.mock('../fluxNetworkData.js', () => ({
    fetchFluxPrice: vi.fn(),
    fetchCurrentBlockHeight: vi.fn()
}));

const { classifyOpReturn, extractAppHashFromTx, FLUXDRIVE_APP_TYPE } =
    await import('../revenue/transactionSync.js');

const APP_HASH = 'e673ea42efe10246f898cde7e94b2eadb743d19d7bbaa59b36152575e9d2345a';
// The real string from txid ac5a3fa2... on mainnet.
const FLUXDRIVE_REF = 'FLUXDRIVEqv8myqxipfe6dwiyky9y3nli';

/** A transaction whose OP_RETURN carries `text` as ASCII, the way the chain stores it. */
function txWithOpReturn(text) {
    const dataHex = Buffer.from(text, 'utf8').toString('hex');
    const pushLength = (dataHex.length / 2).toString(16).padStart(2, '0');
    return {
        vout: [
            { scriptPubKey: { type: 'pubkeyhash', hex: '76a914aa' } },
            { scriptPubKey: { type: 'nulldata', hex: `6a${pushLength}${dataHex}` } }
        ]
    };
}

describe('classifyOpReturn', () => {
    it('reads an app registration as a spec hash', () => {
        expect(classifyOpReturn(txWithOpReturn(APP_HASH))).toEqual({ kind: 'hash', value: APP_HASH });
    });

    it('lower-cases an upper-case hash, so cache lookups match', () => {
        expect(classifyOpReturn(txWithOpReturn(APP_HASH.toUpperCase())).value).toBe(APP_HASH);
    });

    it('reads a real FluxDrive payment as fluxdrive, keeping the order reference', () => {
        expect(classifyOpReturn(txWithOpReturn(FLUXDRIVE_REF))).toEqual({
            kind: 'fluxdrive',
            value: FLUXDRIVE_REF
        });
    });

    it('tolerates surrounding whitespace', () => {
        expect(classifyOpReturn(txWithOpReturn(`  ${FLUXDRIVE_REF}  `)).kind).toBe('fluxdrive');
        expect(classifyOpReturn(txWithOpReturn(` ${APP_HASH} `)).kind).toBe('hash');
    });

    // "Only where we are sure": a differently shaped string that merely starts with the tag
    // is NOT labelled. Every one of the payments observed on chain is the tag plus exactly
    // 24 lowercase base36 characters.
    it('refuses to label anything that only resembles the FluxDrive tag', () => {
        const notSure = [
            'FLUXDRIVE',                              // tag alone
            'FLUXDRIVEshort',                         // suffix too short
            `FLUXDRIVE${'a'.repeat(23)}`,             // one char short
            `FLUXDRIVE${'a'.repeat(25)}`,             // one char long
            'FLUXDRIVEQV8MYQXIPFE6DWIYKY9Y3NLI',      // upper-case suffix
            'FLUXDRIVE-qv8myqxipfe6dwiyky9y3nl',      // punctuation in the suffix
            'fluxdriveqv8myqxipfe6dwiyky9y3nli',      // lower-case tag
            `prefixFLUXDRIVE${'a'.repeat(24)}`        // tag not at the start
        ];
        for (const text of notSure) {
            expect(classifyOpReturn(txWithOpReturn(text)).kind).toBe('none');
        }
    });

    it('returns none for a transaction with no OP_RETURN at all', () => {
        expect(classifyOpReturn({ vout: [{ scriptPubKey: { type: 'pubkeyhash', hex: '76a914aa' } }] }))
            .toEqual({ kind: 'none', value: null });
    });

    it('returns none for a raw-bytes OP_RETURN that decodes to binary', () => {
        // 6a20 + 32 raw bytes -- a real shape on chain, and not resolvable to anything.
        const tx = { vout: [{ scriptPubKey: { type: 'nulldata', hex: '6a200e7132929602b81a81b78d36284a18341ac4f5353a2936b0fb1d0113470edb16' } }] };
        expect(classifyOpReturn(tx).kind).toBe('none');
    });

    it('is safe on a missing or empty transaction', () => {
        expect(classifyOpReturn(null).kind).toBe('none');
        expect(classifyOpReturn({}).kind).toBe('none');
        expect(classifyOpReturn({ vout: [] }).kind).toBe('none');
    });
});

describe('extractAppHashFromTx still answers only about app hashes', () => {
    it('returns the hash for an app registration', () => {
        expect(extractAppHashFromTx(txWithOpReturn(APP_HASH))).toBe(APP_HASH);
    });

    it('returns null for a FluxDrive payment -- it is not an app hash', () => {
        expect(extractAppHashFromTx(txWithOpReturn(FLUXDRIVE_REF))).toBeNull();
    });
});

describe('FLUXDRIVE_APP_TYPE', () => {
    it('is the value written to app_type, alongside git and docker', () => {
        expect(FLUXDRIVE_APP_TYPE).toBe('fluxdrive');
    });
});

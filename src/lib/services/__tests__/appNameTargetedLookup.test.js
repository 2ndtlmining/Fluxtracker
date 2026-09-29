import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Targeted app-name lookup.
 *
 * The permanentmessages map is cached with a 1h TTL, so an app registered minutes ago was
 * not in it and its transaction was stored with app_name = NULL until the cache next
 * refreshed -- up to an hour of a row reading as an unnamed payment. The API answers a
 * single-hash query directly, so a cache miss on a RECENT transaction now costs one small
 * request instead of an hour's wait.
 *
 * The two bounds matter as much as the lookup: backfillAppNames retries every unnamed
 * transaction of the last 30 days on every 5-minute pass, so without an age guard and a
 * negative cache this would turn one unresolvable payment into a request every pass forever.
 */

vi.mock('../resilientFetch.js', () => ({ resilientFetch: vi.fn() }));
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn().mockResolvedValue(undefined),
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

import { resilientFetch } from '../resilientFetch.js';
import { getAppNameByHash } from '../appSpecsCache.js';

const HASH = 'e673ea42efe10246f898cde7e94b2eadb743d19d7bbaa59b36152575e9d2345a';
const NOW = Date.parse('2026-09-14T21:00:00Z');
const nowSeconds = () => Math.floor(NOW / 1000);

/** Fresh module instance -- the caches live in module scope. */
async function loadSync() {
    vi.resetModules();
    return await import('../revenue/transactionSync.js');
}

const messageFor = name => ({
    status: 'success',
    data: [{ hash: HASH, appSpecifications: { name, compose: [] } }]
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    getAppNameByHash.mockReturnValue(null);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('resolveAppName', () => {
    it('resolves a just-registered app the cached map has never seen', async () => {
        resilientFetch.mockResolvedValue(messageFor('valheim1789417568150'));
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBe('valheim1789417568150');
        expect(resilientFetch).toHaveBeenCalledTimes(1);
        expect(String(resilientFetch.mock.calls[0][0])).toContain(`permanentmessages?hash=${HASH}`);
    });

    it('caches the answer, so a second transaction for the same app costs no request', async () => {
        resilientFetch.mockResolvedValue(messageFor('valheim1789417568150'));
        const { resolveAppName } = await loadSync();

        await resolveAppName(HASH, nowSeconds());
        await resolveAppName(HASH, nowSeconds());

        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('also records the app type, so the git/docker column fills in too', async () => {
        resilientFetch.mockResolvedValue(messageFor('valheim1789417568150'));
        const { resolveAppName, lookupAppType } = await loadSync();

        await resolveAppName(HASH, nowSeconds());

        expect(lookupAppType('valheim1789417568150')).toBe('docker');
    });

    it('does not call the API at all when the hash is already cached', async () => {
        getAppNameByHash.mockReturnValue('already-known');
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBe('already-known');
        expect(resilientFetch).not.toHaveBeenCalled();
    });

    it('skips the targeted call for an old transaction -- a fresh map already failed on it', async () => {
        const { resolveAppName } = await loadSync();
        const twoDaysAgo = nowSeconds() - 2 * 86400;

        await expect(resolveAppName(HASH, twoDaysAgo)).resolves.toBeNull();
        expect(resilientFetch).not.toHaveBeenCalled();
    });

    it('skips the targeted call when the age is unknown', async () => {
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, null)).resolves.toBeNull();
        expect(resilientFetch).not.toHaveBeenCalled();
    });

    it('asks once for an unknown hash, then not again for half an hour', async () => {
        resilientFetch.mockResolvedValue({ status: 'success', data: [] });
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBeNull();
        expect(resilientFetch).toHaveBeenCalledTimes(1);

        // Five minutes later -- the next sync pass retries the same unnamed transaction.
        vi.setSystemTime(NOW + 5 * 60_000);
        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBeNull();
        expect(resilientFetch).toHaveBeenCalledTimes(1);
    });

    it('retries an unknown hash once the negative cache expires', async () => {
        resilientFetch.mockResolvedValue({ status: 'success', data: [] });
        const { resolveAppName } = await loadSync();
        await resolveAppName(HASH, nowSeconds());

        vi.setSystemTime(NOW + 31 * 60_000);
        resilientFetch.mockResolvedValue(messageFor('valheim1789417568150'));

        await expect(resolveAppName(HASH, Math.floor((NOW + 31 * 60_000) / 1000))).resolves.toBe('valheim1789417568150');
        expect(resilientFetch).toHaveBeenCalledTimes(2);
    });

    it('survives an API failure without throwing -- the row just stays unnamed for now', async () => {
        resilientFetch.mockRejectedValue(new Error('502 bad gateway'));
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBeNull();
    });

    it('refuses a hash that is not a 64-char hex string -- it goes into a URL', async () => {
        const { fetchPermanentMessageByHash } = await loadSync();

        for (const bad of ['FLUXDRIVEqv8myqxipfe6dwiyky9y3nli', '../../etc/passwd', '', null, HASH + 'extra']) {
            await expect(fetchPermanentMessageByHash(bad)).resolves.toBeNull();
        }
        expect(resilientFetch).not.toHaveBeenCalled();
    });

    it('returns null for a message with no app name rather than inventing one', async () => {
        resilientFetch.mockResolvedValue({ status: 'success', data: [{ hash: HASH, appSpecifications: {} }] });
        const { resolveAppName } = await loadSync();

        await expect(resolveAppName(HASH, nowSeconds())).resolves.toBeNull();
    });
});

/**
 * "Unregistered spec" (owner-approved 2026-09-26): a payment whose spec hash Flux has no
 * message for. The label must never land on a row that is merely not resolved YET.
 */
describe('isUnregisteredSpec', () => {
    const OTHER = 'a'.repeat(64);
    const dumpWith = hash => ({ status: 'success', data: [{ hash, appSpecifications: { name: 'someapp', compose: [] } }] });
    const twoDaysAgo = () => nowSeconds() - 2 * 86400;

    it('labels a day-old hash that a freshly loaded dump does not contain', async () => {
        resilientFetch.mockResolvedValue(dumpWith(OTHER));
        const { fetchPermanentMessages, isUnregisteredSpec } = await loadSync();
        await fetchPermanentMessages();

        expect(isUnregisteredSpec(HASH, twoDaysAgo())).toBe(true);
    });

    it('never labels a hash the dump or globalappsspecifications knows', async () => {
        resilientFetch.mockResolvedValue(dumpWith(HASH));
        const { fetchPermanentMessages, isUnregisteredSpec } = await loadSync();
        await fetchPermanentMessages();
        expect(isUnregisteredSpec(HASH, twoDaysAgo())).toBe(false);

        getAppNameByHash.mockReturnValue('from-specs');
        expect(isUnregisteredSpec(OTHER, twoDaysAgo())).toBe(false);
    });

    it('leaves a transaction under a day old unlabelled -- it may still be registering', async () => {
        resilientFetch.mockResolvedValue(dumpWith(OTHER));
        const { fetchPermanentMessages, isUnregisteredSpec } = await loadSync();
        await fetchPermanentMessages();

        expect(isUnregisteredSpec(HASH, nowSeconds() - 3600)).toBe(false);
        expect(isUnregisteredSpec(HASH, null)).toBe(false);
    });

    it('labels nothing when the dump never loaded -- an outage is not an answer', async () => {
        resilientFetch.mockRejectedValue(new Error('502 bad gateway'));
        const { fetchPermanentMessages, isUnregisteredSpec } = await loadSync();
        await fetchPermanentMessages();

        expect(isUnregisteredSpec(HASH, twoDaysAgo())).toBe(false);
    });

    it('only a dump loaded at least a day after the payment can label it (#414)', async () => {
        resilientFetch.mockResolvedValue(dumpWith(OTHER));
        const { fetchPermanentMessages, isUnregisteredSpec } = await loadSync();
        await fetchPermanentMessages();                          // dump loaded at NOW

        // 30 hours on, with no newer successful dump: a payment made 10 hours before that
        // dump is now over a day old, but the dump was taken too soon after it to prove
        // anything -- its message could have landed after the dump.
        vi.setSystemTime(NOW + 30 * 60 * 60_000);
        resilientFetch.mockRejectedValue(new Error('timeout'));
        await fetchPermanentMessages();

        expect(isUnregisteredSpec(HASH, nowSeconds() - 10 * 3600)).toBe(false);
        // A payment made two days before the dump is proven either way
        expect(isUnregisteredSpec(HASH, nowSeconds() - 2 * 86400)).toBe(true);
    });

    it('refreshes the full dump at most daily, not hourly (#414)', async () => {
        resilientFetch.mockResolvedValue(dumpWith(OTHER));
        const { ensurePermanentMessagesCache } = await loadSync();
        await ensurePermanentMessagesCache();
        vi.setSystemTime(NOW + 23 * 60 * 60_000);
        await ensurePermanentMessagesCache();
        const fullLoads = () => resilientFetch.mock.calls.filter(([url]) => String(url).endsWith('/permanentmessages')).length;
        expect(fullLoads()).toBe(1);

        vi.setSystemTime(NOW + 25 * 60 * 60_000);
        await ensurePermanentMessagesCache();
        expect(fullLoads()).toBe(2);
    });
});

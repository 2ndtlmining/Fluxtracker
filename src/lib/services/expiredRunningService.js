/**
 * Expired running apps (spec docs/superpowers/specs/2026-10-06-expired-running-apps-design.md).
 *
 * An app still running on Flux nodes a full day after its subscription ended. Measured
 * 2026-10-06: 18 such apps, the oldest 50 days past expiry, Flux's own `web` on 4 nodes 18
 * days after cancellation. Fluxtracker counts running containers, so these silently inflate
 * its figures; this names and counts them.
 *
 * End block = latest register/update height + `expire`. Read from the spec when Flux still
 * lists it (it keeps some for a while after expiry), else from the app's last permanent
 * message. A running app with neither is a local container that never had a subscription.
 */
import {
    API_ENDPOINTS, BLOCKS_PER_DAY, EXPIRED_RUNNING_GRACE_BLOCKS, FLUX_PON_FORK_HEIGHT,
    DEFAULT_EXPIRE_BLOCKS_PRE_FORK, DEFAULT_EXPIRE_BLOCKS_POST_FORK,
    EXPIRED_RUNNING_TOP_N, EXPIRED_RUNNING_MAX_LOOKUPS
} from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { getRunningApps } from './runningAppsProvider.js';
import { getAllAppSpecs } from './appSpecsCache.js';
import { fetchCurrentBlockHeight } from './fluxNetworkData.js';
import { createLogger } from '../logger.js';

const log = createLogger('expiredRunningService');
const NONE_TTL_MS = 24 * 60 * 60 * 1000;
// Lookups run inside the cloud step of a sequential services cycle. A slow-but-answering
// permanentmessages API (15 s timeout + a retry per call) must not hold every later service
// for minutes: once this budget is spent the remaining apps wait for the next cycle.
const LOOKUP_BUDGET_MS = 30 * 1000;

// lowercase app name -> { endBlock } (kept until the app has a spec again) | { none, at }
const lookupCache = new Map();
let lastResult = null;   // { value, at }
let inFlight = null;     // one run shared by concurrent callers (cycle + endpoint)

/**
 * The block an app's subscription ends at, by FluxOS's own rule (registryManager.js): a
 * missing or 0 `expire` takes the default for the era the app was registered in, and a
 * pre-fork spec that was due to run past the Proof of Node fork has its post-fork blocks
 * multiplied by 4, because blocks became 4x faster there.
 */
export function specEndBlock(spec) {
    const height = Number(spec?.height);
    if (!Number.isFinite(height) || height <= 0) return null;
    const preFork = height < FLUX_PON_FORK_HEIGHT;
    const expire = Number(spec.expire) || (preFork ? DEFAULT_EXPIRE_BLOCKS_PRE_FORK : DEFAULT_EXPIRE_BLOCKS_POST_FORK);
    const end = height + expire;
    if (preFork && end > FLUX_PON_FORK_HEIGHT) {
        return FLUX_PON_FORK_HEIGHT + (end - FLUX_PON_FORK_HEIGHT) * 4;
    }
    return end;
}

/**
 * Pure: which running apps are a grace period or more past their end block.
 *
 * @param {object} p
 * @param {Map<string, number>} p.deploymentCounts  lowercase app name -> distinct nodes running it
 * @param {Map<string, string>} p.deploymentNames   lowercase app name -> name as the container spelled it
 * @param {object[]} p.specs                        globalappsspecifications entries
 * @param {number} p.currentBlock
 * @param {Map<string, {endBlock:number}|{none:true}|{failed:true}>} p.lookups
 *        permanentmessages results for spec-less apps, by lowercase name
 * @returns {{apps:number, instances:number, unresolved:number,
 *            top:Array<{name:string, instances:number, daysExpired:number, endBlock:number}>,
 *            needLookup:string[]}}  needLookup = spec-less apps with no lookup result yet
 */
export function computeExpiredRunning({ deploymentCounts, deploymentNames, specs, currentBlock, lookups }) {
    const specByKey = new Map((specs || []).map(s => [String(s.name).toLowerCase(), s]));
    const expired = [];
    const needLookup = [];
    let unresolved = 0;

    for (const [key, nodes] of deploymentCounts) {
        let endBlock = null;
        const spec = specByKey.get(key);
        if (spec) {
            endBlock = specEndBlock(spec);
        } else {
            const found = lookups?.get(key);
            if (!found) { needLookup.push(key); continue; }
            if (found.failed) { unresolved++; continue; }
            if (found.none) continue;
            endBlock = found.endBlock;
        }
        if (endBlock == null || currentBlock - endBlock < EXPIRED_RUNNING_GRACE_BLOCKS) continue;

        expired.push({
            name: deploymentNames?.get(key) || key,
            instances: nodes,
            daysExpired: Math.floor((currentBlock - endBlock) / BLOCKS_PER_DAY),
            endBlock
        });
    }

    // Whole days, then name: the card shows whole days, so a finer tie-break would only look
    // arbitrary there.
    expired.sort((a, b) => b.daysExpired - a.daysExpired || a.name.localeCompare(b.name));
    return {
        apps: expired.length,
        instances: expired.reduce((sum, e) => sum + e.instances, 0),
        unresolved,
        top: expired.slice(0, EXPIRED_RUNNING_TOP_N),
        needLookup
    };
}

/**
 * End block from the app's last permanent message, or null when it has none. Throws on a
 * failed request so the caller can skip the app this cycle instead of caching a guess.
 * The appname query is case-sensitive: pass the name as the container spelled it.
 */
export async function lookupEndBlock(name) {
    const body = await resilientFetch(
        `${API_ENDPOINTS.APPS}/permanentmessages?appname=${encodeURIComponent(name)}`,
        { timeout: 15000, retries: 1, delayMs: 2000, breakerKey: 'permanent-messages-app' }
    );
    if (body?.status !== 'success' || !Array.isArray(body.data)) {
        throw new Error(`permanentmessages for ${name}: ${body?.data?.message || 'unexpected response'}`);
    }
    const msgs = body.data.filter(m => m?.appSpecifications && Number.isFinite(Number(m.height)));
    if (msgs.length === 0) return null;
    const last = msgs.reduce((a, b) => (Number(b.height) > Number(a.height) ? b : a));
    return specEndBlock({ height: last.height, expire: last.appSpecifications.expire });
}

async function resolveLookups(keys, deploymentNames, now) {
    const lookups = new Map();
    let made = 0;
    const started = Date.now();
    for (const key of keys) {
        const cached = lookupCache.get(key);
        if (cached && (cached.endBlock != null || now - cached.at < NONE_TTL_MS)) {
            lookups.set(key, cached.endBlock != null ? { endBlock: cached.endBlock } : { none: true });
            continue;
        }
        if (made >= EXPIRED_RUNNING_MAX_LOOKUPS || Date.now() - started >= LOOKUP_BUDGET_MS) {
            lookups.set(key, { failed: true });
            continue;
        }
        made++;
        try {
            const endBlock = await lookupEndBlock(deploymentNames.get(key) || key);
            if (endBlock == null) {
                lookupCache.set(key, { none: true, at: now });
                lookups.set(key, { none: true });
            } else {
                lookupCache.set(key, { endBlock });
                lookups.set(key, { endBlock });
            }
        } catch (err) {
            log.warn({ err, app: key }, 'Expired-running lookup failed; retrying next cycle');
            lookups.set(key, { failed: true });
        }
    }
    return lookups;
}

/**
 * The live figure. null when the census, the block height or the specs cache is unavailable
 * -- an empty specs cache would make every running app look spec-less.
 *
 * @param {{ttlMs?: number}} [options] serve the last result if it is younger than ttlMs
 */
export async function getExpiredRunning({ ttlMs = 0 } = {}) {
    if (ttlMs > 0 && lastResult && Date.now() - lastResult.at < ttlMs) return lastResult.value;
    if (inFlight) return inFlight;
    inFlight = computeLive().finally(() => { inFlight = null; });
    return inFlight;
}

async function computeLive() {
    let apps, currentBlock;
    try {
        [apps, currentBlock] = await Promise.all([
            getRunningApps(),
            fetchCurrentBlockHeight().catch(() => null)
        ]);
    } catch (err) {
        log.warn({ err }, 'Running apps unavailable -- expired running not computed');
        return null;
    }
    const specs = getAllAppSpecs();
    if (!currentBlock || !apps?.deploymentCounts || specs.length === 0) return null;

    // A renewed app is back in the specs: forget its old end block, so a later expiry is
    // looked up afresh instead of reporting the stale one.
    for (const spec of specs) lookupCache.delete(String(spec.name).toLowerCase());

    const deploymentNames = apps.deploymentNames || new Map();
    const base = { deploymentCounts: apps.deploymentCounts, deploymentNames, specs, currentBlock };
    const firstPass = computeExpiredRunning({ ...base, lookups: new Map() });
    const lookups = await resolveLookups(firstPass.needLookup, deploymentNames, Date.now());
    const { needLookup, ...result } = computeExpiredRunning({ ...base, lookups });

    const value = { ...result, currentBlock, computedAt: Date.now() };
    lastResult = { value, at: Date.now() };
    log.info({ apps: value.apps, instances: value.instances, unresolved: value.unresolved },
        'Expired running: %d apps on %d nodes (%d unresolved)', value.apps, value.instances, value.unresolved);
    return value;
}

/** Test hook. */
export function clearExpiredRunningCaches() {
    lookupCache.clear();
    lastResult = null;
    inFlight = null;
}

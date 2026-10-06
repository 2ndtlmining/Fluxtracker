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
    BLOCKS_PER_DAY, EXPIRED_RUNNING_GRACE_BLOCKS, DEFAULT_EXPIRE_BLOCKS, EXPIRED_RUNNING_TOP_N
} from '../config.js';

export function specEndBlock(spec) {
    const height = Number(spec?.height);
    if (!Number.isFinite(height) || height <= 0) return null;
    const expire = spec.expire != null && Number.isFinite(Number(spec.expire))
        ? Number(spec.expire)
        : DEFAULT_EXPIRE_BLOCKS;
    return height + expire;
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

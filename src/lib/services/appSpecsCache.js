// src/lib/services/appSpecsCache.js
//
// Shared cache of current app specs from `globalappsspecifications`, indexed for two
// lookups: hash -> name (used by revenueService for historical tx app-name lookup) and
// container-name -> repotag (used by runningAppsProvider to recover categorization after
// FluxOS v8.18 dropped `Image` from the running-apps census). See
// docs/superpowers/specs/2026-09-09-running-apps-name-resolution-design.md.
//
// Deliberately does NOT touch `permanentmessages` — that payload is ~80MB vs this one's
// ~1.5MB, and only adds coverage for apps no longer in globalappsspecifications (revenueService
// already handles that case separately for historical transactions).

import { API_ENDPOINTS } from '../config.js';
import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';

const log = createLogger('appSpecsCache');

const globalSpecsCache = {
    map: new Map(),            // hash -> name
    typeMap: new Map(),        // name (lowercase) -> 'git' | 'docker'
    specByName: new Map(),     // name (lowercase) -> full spec object
    componentIndex: new Map(), // "componentName_appName" (lowercase) -> repotag
    lastFetched: 0,
    TTL: 60 * 60 * 1000 // 1 hour
};

/**
 * Determine if an app is git-based (runonflux/Orbit) or docker-based.
 * Works with both old single-component and new compose-array spec formats.
 */
export function determineAppType(appSpec) {
    if (!appSpec) return 'docker';

    if (Array.isArray(appSpec.compose)) {
        const isGit = appSpec.compose.some(
            c => c.repotag && c.repotag.toLowerCase().includes('runonflux/orbit')
        );
        return isGit ? 'git' : 'docker';
    }

    if (appSpec.repotag && appSpec.repotag.toLowerCase().includes('runonflux/orbit')) {
        return 'git';
    }

    return 'docker';
}

async function fetchGlobalSpecs() {
    try {
        const body = await resilientFetch(`${API_ENDPOINTS.APPS}/globalappsspecifications`, {
            timeout: 30000,
            breakerKey: 'global-apps-specs'
        });

        if (body && body.status === 'success' && Array.isArray(body.data)) {
            globalSpecsCache.map.clear();
            globalSpecsCache.typeMap.clear();
            globalSpecsCache.specByName.clear();
            globalSpecsCache.componentIndex.clear();

            for (const appSpec of body.data) {
                const name = appSpec.name;
                if (!name) continue;
                const lowerName = name.toLowerCase();

                globalSpecsCache.specByName.set(lowerName, appSpec);
                globalSpecsCache.typeMap.set(lowerName, determineAppType(appSpec));
                if (appSpec.hash) globalSpecsCache.map.set(appSpec.hash, name);

                if (Array.isArray(appSpec.compose)) {
                    for (const component of appSpec.compose) {
                        if (component.name && component.repotag) {
                            globalSpecsCache.componentIndex.set(
                                `${component.name.toLowerCase()}_${lowerName}`,
                                component.repotag
                            );
                        }
                    }
                }
            }

            globalSpecsCache.lastFetched = Date.now();
            log.info({ count: globalSpecsCache.specByName.size }, 'Loaded %d app specs', globalSpecsCache.specByName.size);
        }
    } catch (error) {
        log.warn({ err: error }, 'Failed to fetch global specs');
    }
}

/** Refreshes the cache if stale or empty. No-op otherwise. */
export async function ensureGlobalSpecsCache() {
    const age = Date.now() - globalSpecsCache.lastFetched;
    if (age > globalSpecsCache.TTL || globalSpecsCache.specByName.size === 0) {
        await fetchGlobalSpecs();
    }
}

export function getAppSpecByName(name) {
    if (!name) return null;
    return globalSpecsCache.specByName.get(name.toLowerCase()) || null;
}

export function getAppNameByHash(hash) {
    if (!hash) return null;
    return globalSpecsCache.map.get(hash) || null;
}

export function getAppTypeByName(name) {
    if (!name) return null;
    return globalSpecsCache.typeMap.get(name.toLowerCase()) || null;
}

/**
 * Resolve a running container's Docker name (e.g. "/fluxFoldingAtHome_FoldingAtRunOnFlux2",
 * or "/fluxEthereumNodeLight" for a legacy flat-spec app with no component) to the repotag
 * of the specific app+component it belongs to.
 *
 * Returns null when the app's spec isn't in globalappsspecifications (private/enterprise
 * apps, or a spec that's since expired) — callers should still count the instance toward
 * their totals, just not toward a per-image bucket.
 */
export function resolveRunningAppName(containerName) {
    if (!containerName) return null;
    const stripped = containerName.replace(/^\//, '').replace(/^flux/, '');
    if (!stripped) return null;

    // Legacy flat-spec app: container name is the bare app name, no component prefix.
    const directSpec = getAppSpecByName(stripped);
    if (directSpec) {
        const repotag = Array.isArray(directSpec.compose)
            ? directSpec.compose[0]?.repotag
            : directSpec.repotag;
        if (repotag) return { appName: directSpec.name, repotag };
    }

    // Compose app: "<componentName>_<appName>" — split at the FIRST underscore, since
    // componentName always comes first and appName may itself contain underscores.
    const underscoreIndex = stripped.indexOf('_');
    if (underscoreIndex > 0) {
        const componentName = stripped.slice(0, underscoreIndex);
        const appName = stripped.slice(underscoreIndex + 1);
        const spec = getAppSpecByName(appName);
        if (spec) {
            const repotag = globalSpecsCache.componentIndex.get(
                `${componentName.toLowerCase()}_${appName.toLowerCase()}`
            );
            if (repotag) return { appName: spec.name, repotag };
        }
    }

    return null;
}

/** Test hook — drops the cached payload. */
export function clearGlobalSpecsCache() {
    globalSpecsCache.map.clear();
    globalSpecsCache.typeMap.clear();
    globalSpecsCache.specByName.clear();
    globalSpecsCache.componentIndex.clear();
    globalSpecsCache.lastFetched = 0;
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getFluxCloudSnapshot — the live Flux Cloud readings behind the daily KPI.
 * "Apps deployed" must count unique ACTIVE apps (never expired registrations, never
 * duplicate specs from re-deployments, never instances) so it stays comparable with
 * the Deployments/Expiring 24h lists that read the same registry.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import { getFluxCloudSnapshot } from '../carouselService.js';

const BLOCK_HEIGHT = 294918;

/** Registry entries keyed by what they should teach the count. */
const REGISTRY = [
    // Active app; a later re-deployment of the same name appears further down
    { name: 'app-active', height: 294000, expire: 5000, instances: 1, cpu: 1, ram: 1024, hdd: 10 },
    // Expired registration (expiry block already passed) — must NOT count
    { name: 'app-expired', height: 290000, expire: 1000, instances: 1 },
    // Re-deployment of app-active: newer spec, same name — must NOT double-count
    { name: 'app-active', height: 294900, expire: 5000, instances: 2, cpu: 2, ram: 2048, hdd: 20 },
    // No expire field: cannot be judged expired, counts as active
    { name: 'app-noexpire', height: 294800, instances: 1, cpu: 1, ram: 512, hdd: 5 },
    // Active and expiring within the day
    { name: 'app-expiring', height: 294700, expire: 300, instances: 1 },
    // No name: unusable, ignored
    { height: 294000, expire: 2000, instances: 1 }
];

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockImplementation(async url => {
        if (String(url).includes('getblockcount')) {
            return { data: { data: BLOCK_HEIGHT } };
        }
        if (String(url).includes('globalappsspecifications')) {
            return { data: { data: REGISTRY } };
        }
        throw new Error(`unexpected axios call: ${url}`);
    });
});

describe('getFluxCloudSnapshot', () => {
    it('reports no count when the shared Flux API fetch fails', async () => {
        // Runs FIRST: the module-level shared API cache is cold, so the rejection
        // actually reaches the snapshot instead of being served from cache.
        axios.get.mockRejectedValue(new Error('down'));

        const snapshot = await getFluxCloudSnapshot();
        expect(snapshot.totalAppsDeployed).toBeNull();
    });

    it('counts unique ACTIVE apps — no expired registrations, no duplicate specs, no instances', async () => {
        const snapshot = await getFluxCloudSnapshot();

        // app-active (deduped), app-noexpire, app-expiring — app-expired excluded
        expect(snapshot.totalAppsDeployed).toBe(3);
    });

    it('exposes the raw 24h lists with their cache flags', async () => {
        const snapshot = await getFluxCloudSnapshot();

        expect(snapshot.appsDeployedToday.cached).toBe(true);
        // Registry entries registered within 2880 blocks, sorted by name (the nameless
        // spec sorts first): app-active x2 (both specs), app-noexpire, app-expiring.
        // Raw entries — deduping happens in the KPI layer.
        expect(snapshot.appsDeployedToday.apps.map(a => a.name)).toEqual([
            undefined, 'app-active', 'app-active', 'app-expiring', 'app-noexpire'
        ]);
        expect(snapshot.appsExpiring24h.cached).toBe(true);
        // The nameless spec is expiring too — raw registry behaviour; the KPI layer's
        // dedupe drops nameless entries so the activity table never shows them.
        expect(snapshot.appsExpiring24h.apps.map(a => a.name)).toEqual(['app-expiring', undefined]);
    });
});

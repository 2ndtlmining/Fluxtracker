import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #200 — deployment fill: how many of the deployments app owners ordered are running.
 *
 * Every rule here produced a wrong-but-plausible number when it was got wrong, which is why
 * each one has its own test rather than being folded into a single happy path.
 */

vi.mock('../appSpecsCache.js', () => ({
    getAllAppSpecs: vi.fn(),
    ensureGlobalSpecsCache: vi.fn(),
    resolveRunningAppName: vi.fn(() => null),
    getAppSpecByName: vi.fn(() => null)
}));

import { getAllAppSpecs } from '../appSpecsCache.js';
import { computeDeploymentFill } from '../runningAppsProvider.js';

const specs = (...entries) => entries.map(([name, instances]) => ({ name, instances }));

beforeEach(() => vi.clearAllMocks());

describe('computeDeploymentFill', () => {
    it('divides deployments by ordered instances', () => {
        getAllAppSpecs.mockReturnValue(specs(['alpha', 4], ['beta', 2]));
        const deploymentCounts = new Map([['alpha', 3], ['beta', 2]]);

        const fill = computeDeploymentFill(deploymentCounts);

        expect(fill.ordered).toBe(6);
        expect(fill.running).toBe(5);
        expect(fill.missing).toBe(1);
        expect(fill.fillPct).toBeCloseTo(83.33, 1);
    });

    it('caps each app at what it ordered, so one over-deployed app cannot hide another shortfall', () => {
        // Without the cap, alpha's 4-against-3 would paper over beta's 0-against-3 and the
        // network would report 100% while half of beta was missing.
        getAllAppSpecs.mockReturnValue(specs(['alpha', 3], ['beta', 3]));
        const deploymentCounts = new Map([['alpha', 4], ['beta', 0]]);

        const fill = computeDeploymentFill(deploymentCounts);

        expect(fill.running).toBe(3);        // alpha capped at 3, not 4
        expect(fill.fillPct).toBeCloseTo(50, 5);
        expect(fill.missing).toBe(3);
    });

    it('cannot exceed 100% when every app is over-deployed', () => {
        getAllAppSpecs.mockReturnValue(specs(['alpha', 2], ['beta', 2]));
        const deploymentCounts = new Map([['alpha', 9], ['beta', 9]]);

        expect(computeDeploymentFill(deploymentCounts).fillPct).toBe(100);
    });

    it('ignores running apps that have no spec', () => {
        // A lapsed registration keeps running but nobody ordered it, so counting it would
        // inflate the numerator against a denominator it never contributed to.
        getAllAppSpecs.mockReturnValue(specs(['alpha', 2]));
        const deploymentCounts = new Map([['alpha', 2], ['ghost', 5]]);

        const fill = computeDeploymentFill(deploymentCounts);

        expect(fill.ordered).toBe(2);
        expect(fill.running).toBe(2);
        expect(fill.fillPct).toBe(100);
    });

    it('matches app names case-insensitively', () => {
        // Container names do not preserve the spec's casing.
        getAllAppSpecs.mockReturnValue(specs(['MyApp', 2]));
        const deploymentCounts = new Map([['myapp', 2]]);

        expect(computeDeploymentFill(deploymentCounts).running).toBe(2);
    });

    it('missing equals the sum of the per-app shortfalls', () => {
        // This is what lets a breakdown list reconcile with the headline figure.
        getAllAppSpecs.mockReturnValue(specs(['a', 10], ['b', 5], ['c', 3]));
        const deploymentCounts = new Map([['a', 4], ['b', 5], ['c', 0]]);

        const fill = computeDeploymentFill(deploymentCounts);
        const shortfallSum = fill.shortfalls.reduce((sum, app) => sum + app.short, 0);

        expect(fill.missing).toBe(shortfallSum);
        expect(fill.missing).toBe(9);           // 6 + 0 + 3
        expect(fill.shortfalls).toHaveLength(2); // b is fully filled
    });

    it('orders shortfalls worst-first so a breakdown leads with what matters', () => {
        getAllAppSpecs.mockReturnValue(specs(['small', 2], ['huge', 100]));
        const deploymentCounts = new Map([['small', 1], ['huge', 0]]);

        const fill = computeDeploymentFill(deploymentCounts);

        expect(fill.shortfalls[0].name).toBe('huge');
        expect(fill.shortfalls[0].short).toBe(100);
    });

    it('returns null rather than a fake 0% when no specs are loaded', () => {
        // An empty specs cache is a failed fetch, not a network that ordered nothing.
        // 0% would render as a catastrophic outage on the card.
        getAllAppSpecs.mockReturnValue([]);

        expect(computeDeploymentFill(new Map([['alpha', 3]]))).toBeNull();
    });

    it('skips specs with no instances count instead of treating them as zero ordered', () => {
        getAllAppSpecs.mockReturnValue([{ name: 'alpha', instances: 3 }, { name: 'beta' }]);
        const deploymentCounts = new Map([['alpha', 3], ['beta', 2]]);

        const fill = computeDeploymentFill(deploymentCounts);

        expect(fill.ordered).toBe(3);
        expect(fill.running).toBe(3);
    });
});

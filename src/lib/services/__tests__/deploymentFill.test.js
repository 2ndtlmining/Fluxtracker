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

/**
 * Issue #213 — the Missing Deployments carousel reads the same shortfall list the Apps card
 * fill % comes from, so the two can never disagree. These cover what that tab needs on top
 * of what the card already used.
 */
describe('computeDeploymentFill — expired specs (issue #213)', () => {
    const CURRENT_BLOCK = 3_000_000;
    const live = (name, instances) =>
        ({ name, instances, height: CURRENT_BLOCK - 100, expire: 5000 });
    const lapsed = (name, instances) =>
        ({ name, instances, height: CURRENT_BLOCK - 9000, expire: 5000 });

    it('excludes lapsed registrations when a current block is supplied', () => {
        // A deployment nobody ordered any more is not missing. Measured against the live
        // network 2026-09-21: 50 expired specs still in the registry ordering 176 instances,
        // 2.1% of everything ordered -- and EthereumNodeLight alone orders 30, which would
        // land near the top of a "most missing first" ranking.
        getAllAppSpecs.mockReturnValue([live('alpha', 3), lapsed('ghost', 30)]);

        const fill = computeDeploymentFill(new Map(), { currentBlock: CURRENT_BLOCK });

        expect(fill.ordered).toBe(3);
        expect(fill.shortfalls.map(s => s.name)).toEqual(['alpha']);
    });

    it('treats a spec expiring on exactly the current block as lapsed', () => {
        getAllAppSpecs.mockReturnValue([
            { name: 'edge', instances: 2, height: CURRENT_BLOCK - 5000, expire: 5000 }
        ]);

        expect(computeDeploymentFill(new Map(), { currentBlock: CURRENT_BLOCK })).toBeNull();
    });

    it('keeps counting every spec when no current block is supplied', () => {
        // Back-compat: the Apps card called this with one argument before #213, and an
        // omitted block must not silently change the figure it has been reporting.
        getAllAppSpecs.mockReturnValue([live('alpha', 3), lapsed('ghost', 30)]);

        expect(computeDeploymentFill(new Map()).ordered).toBe(33);
    });

    it('ignores a nonsense block height rather than expiring everything', () => {
        // carouselService coerces a failed block-height fetch to 0. A 0 reaching the filter
        // would mark every spec as lapsed and empty the tab, which reads as "nothing is
        // short" -- the opposite of the truth.
        getAllAppSpecs.mockReturnValue([live('alpha', 3), lapsed('ghost', 30)]);

        expect(computeDeploymentFill(new Map(), { currentBlock: 0 }).ordered).toBe(33);
    });
});

describe('computeDeploymentFill — shortfall detail for the carousel (issue #213)', () => {
    it('ranks most-missing first, then by name so ties are stable', () => {
        // Rank order is user-specified for this tab, so it is exactly the thing to pin.
        getAllAppSpecs.mockReturnValue([
            { name: 'zebra', instances: 2 },
            { name: 'apple', instances: 2 },
            { name: 'most', instances: 9 }
        ]);

        const fill = computeDeploymentFill(new Map());

        expect(fill.shortfalls.map(s => s.name)).toEqual(['most', 'apple', 'zebra']);
    });

    it('carries per-deployment resources summed across compose components', () => {
        // Per deployment, matching Latest Deployed Apps, so cpu/ram/hdd mean the same thing
        // on every carousel tab.
        getAllAppSpecs.mockReturnValue([{
            name: 'multi',
            instances: 3,
            compose: [
                { cpu: 1, ram: 1024, hdd: 10 },
                { cpu: 0.5, ram: 512, hdd: 5 }
            ]
        }]);

        const [row] = computeDeploymentFill(new Map()).shortfalls;

        expect(row.cpu).toBe(1.5);
        expect(row.ram).toBe(1536);
        expect(row.hdd).toBe(15);
    });

    it('falls back to top-level resources when there is no compose array', () => {
        getAllAppSpecs.mockReturnValue([
            { name: 'flat', instances: 2, cpu: 2, ram: 2048, hdd: 20 }
        ]);

        const [row] = computeDeploymentFill(new Map()).shortfalls;

        expect(row).toMatchObject({ cpu: 2, ram: 2048, hdd: 20 });
    });

    it('keeps an enterprise app in the ranking and flags it', () => {
        // Only `compose` is encrypted -- the instances count is known, so the MISSING count
        // is known too. Dropping enterprise apps would hide real shortfalls.
        getAllAppSpecs.mockReturnValue([
            { name: 'secret', instances: 5, enterprise: 'encrypted-blob' },
            { name: 'plain', instances: 2 }
        ]);

        const fill = computeDeploymentFill(new Map());

        expect(fill.shortfalls.map(s => s.name)).toEqual(['secret', 'plain']);
        expect(fill.shortfalls[0].isEnterprise).toBe(true);
        expect(fill.shortfalls[1].isEnterprise).toBe(false);
    });

    it('reports what is MISSING, never what was ordered', () => {
        // The whole point of the tab: ordered 100 running 99 is a smaller problem than
        // ordered 3 running 0, and printing `100` would say the opposite.
        getAllAppSpecs.mockReturnValue([
            { name: 'nearly', instances: 100 },
            { name: 'none', instances: 3 }
        ]);

        const fill = computeDeploymentFill(new Map([['nearly', 99]]));

        expect(fill.shortfalls.map(s => [s.name, s.short])).toEqual([['none', 3], ['nearly', 1]]);
    });

    it('leaves out an app that is fully deployed', () => {
        getAllAppSpecs.mockReturnValue([{ name: 'full', instances: 2 }]);

        expect(computeDeploymentFill(new Map([['full', 2]])).shortfalls).toEqual([]);
    });

    it('leaves out an over-deployed app rather than ranking it as negative', () => {
        // A redeploy briefly doubles a deployment up. 4 against 3 ordered is filled.
        getAllAppSpecs.mockReturnValue([{ name: 'over', instances: 3 }]);

        const fill = computeDeploymentFill(new Map([['over', 4]]));

        expect(fill.shortfalls).toEqual([]);
        expect(fill.running).toBe(3);
    });
});

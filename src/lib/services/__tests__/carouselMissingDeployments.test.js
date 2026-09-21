import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #213 — the Missing Deployments carousel tab.
 *
 * The figure itself is NOT computed here. `computeDeploymentFill()` already produces the
 * shortfall list for the Apps card, and the issue is explicit that a second implementation
 * of the same number is the trap to avoid: the sibling project found two calculations
 * disagreeing by 62 deployments. This layer only formats that list for the carousel, so
 * these tests cover the formatting and the ordering the tab promises — the counting rules
 * are pinned in deploymentFill.test.js.
 */

vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: vi.fn(),
    computeDeploymentFill: vi.fn()
}));

import { getRunningApps, computeDeploymentFill } from '../runningAppsProvider.js';
import { fetchMissingDeployments, __resetMissingCacheForTests, MISSING_DEPLOYMENTS_LIMIT } from '../carouselService.js';

const shortfall = (name, short, extra = {}) => ({
    name, short, ordered: short, running: 0,
    cpu: 1, ram: 1024, hdd: 10, isEnterprise: false, ...extra
});

beforeEach(() => {
    vi.clearAllMocks();
    __resetMissingCacheForTests();
    getRunningApps.mockResolvedValue({ deploymentCounts: new Map() });
});

describe('fetchMissingDeployments', () => {
    it('prints what is MISSING as the instance count, never what was ordered', async () => {
        // The whole point of the tab. An app that ordered 100 and runs 99 is a smaller
        // problem than one that ordered 3 and runs none; showing `100 instances` would
        // rank and read as the exact opposite.
        computeDeploymentFill.mockReturnValue({
            shortfalls: [shortfall('nearly', 1, { ordered: 100, running: 99 })]
        });

        const [item] = await fetchMissingDeployments();

        expect(item.instances).toBe(1);
        expect(item.name).toBe('nearly');
    });

    it('preserves the most-missing-first order it is given', async () => {
        computeDeploymentFill.mockReturnValue({
            shortfalls: [shortfall('worst', 9), shortfall('mid', 4), shortfall('least', 1)]
        });

        const items = await fetchMissingDeployments();

        expect(items.map(i => i.name)).toEqual(['worst', 'mid', 'least']);
        expect(items.map(i => i.rank)).toEqual([1, 2, 3]);
    });

    it('marks every item as the missing type so the tab renders them', async () => {
        computeDeploymentFill.mockReturnValue({ shortfalls: [shortfall('alpha', 2)] });

        const [item] = await fetchMissingDeployments();

        expect(item.type).toBe('missing');
    });

    it('carries per-deployment resources through unchanged', async () => {
        computeDeploymentFill.mockReturnValue({
            shortfalls: [shortfall('multi', 3, { cpu: 1.5, ram: 1536, hdd: 15 })]
        });

        const [item] = await fetchMissingDeployments();

        expect(item).toMatchObject({ cpu: 1.5, ram: 1536, hdd: 15 });
    });

    it('keeps an enterprise app ranked and flagged rather than dropping it', async () => {
        computeDeploymentFill.mockReturnValue({
            shortfalls: [shortfall('secret', 5, { isEnterprise: true }), shortfall('plain', 2)]
        });

        const items = await fetchMissingDeployments();

        expect(items.map(i => i.name)).toEqual(['secret', 'plain']);
        expect(items[0].isEnterprise).toBe(true);
    });

    it('returns an empty list when nothing is short', async () => {
        // Renders as "all deployments filled", not as a broken empty ticker -- that
        // distinction is the component's job, but it depends on getting [] and not null.
        computeDeploymentFill.mockReturnValue({ shortfalls: [] });

        await expect(fetchMissingDeployments()).resolves.toEqual([]);
    });

    it('returns an empty list rather than throwing when the fill cannot be computed', async () => {
        // computeDeploymentFill returns null when the specs cache is empty -- a failed
        // fetch. The tab must not render a fabricated "nothing is short".
        computeDeploymentFill.mockReturnValue(null);

        await expect(fetchMissingDeployments()).resolves.toEqual([]);
    });

    it('caps the list so the ticker stays watchable', async () => {
        // Measured against the live network 2026-09-21: 841 apps are short. At the
        // carousel's 5s per item that is a 70-MINUTE loop, and the track is duplicated for
        // seamless scroll, so it is also ~1,700 DOM nodes. The tab is ranked most-missing
        // first, so the head of the list IS the useful part -- the tail is apps short by one.
        const many = Array.from({ length: 200 }, (_, i) => shortfall(`app${i}`, 200 - i));
        computeDeploymentFill.mockReturnValue({ shortfalls: many });

        const items = await fetchMissingDeployments();

        expect(items.length).toBe(MISSING_DEPLOYMENTS_LIMIT);
        // The cap must keep the WORST, never an arbitrary slice.
        expect(items[0].name).toBe('app0');
        expect(items.at(-1).instances).toBeGreaterThan(items.length);
    });

    it('passes the current block through so lapsed registrations are excluded', async () => {
        computeDeploymentFill.mockReturnValue({ shortfalls: [] });

        await fetchMissingDeployments({ currentBlock: 3_000_000 });

        expect(computeDeploymentFill).toHaveBeenCalledWith(
            expect.any(Map),
            expect.objectContaining({ currentBlock: 3_000_000 })
        );
    });
});

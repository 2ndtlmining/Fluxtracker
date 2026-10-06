import { describe, it, expect } from 'vitest';
import { computeExpiredRunning, specEndBlock } from '../expiredRunningService.js';

/**
 * Expired running apps (spec 2026-10-06): still on nodes a full day (2,880 blocks) after the
 * subscription ended. End block = height + expire, from the spec while Flux lists it, else
 * from the app's last permanent message (passed in here as `lookups`).
 */

const BLOCK = 3_012_176;

function run({ running = {}, specs = [], lookups = {} } = {}) {
    const deploymentCounts = new Map(Object.entries(running).map(([n, c]) => [n.toLowerCase(), c]));
    const deploymentNames = new Map(Object.keys(running).map(n => [n.toLowerCase(), n]));
    return computeExpiredRunning({
        deploymentCounts, deploymentNames, specs, currentBlock: BLOCK,
        lookups: new Map(Object.entries(lookups))
    });
}

describe('specEndBlock', () => {
    it('is height + expire', () => {
        expect(specEndBlock({ height: 2_867_975, expire: 100 })).toBe(2_868_075);
    });
    it('uses the 22,000-block default for a spec registered before the PON fork', () => {
        expect(specEndBlock({ height: 1000 })).toBe(23_000);
    });

    // FluxOS registryManager: the Proof of Node fork at block 2,020,000 made blocks 4x
    // faster. Live check 2026-10-06 without this rule listed ten running, still-listed apps
    // (Presearch, Kaspa nodes) as ~255 days expired.
    it('uses the 88,000-block default for a spec registered at or after the fork', () => {
        expect(specEndBlock({ height: 2_020_000 })).toBe(2_108_000);
    });

    it('treats expire 0 as missing, as FluxOS does (expire || default)', () => {
        expect(specEndBlock({ height: 2_500_000, expire: 0 })).toBe(2_588_000);
    });

    it('stretches the post-fork part of a pre-fork spec 4x', () => {
        // Registered 10,000 blocks before the fork for 22,000: 12,000 blocks were due after it.
        expect(specEndBlock({ height: 2_010_000, expire: 22_000 })).toBe(2_020_000 + 12_000 * 4);
    });

    it('leaves a pre-fork spec that ended before the fork unchanged', () => {
        expect(specEndBlock({ height: 1_900_000, expire: 22_000 })).toBe(1_922_000);
    });
    it('is null without a usable height', () => {
        expect(specEndBlock({ expire: 100 })).toBeNull();
    });
});

describe('computeExpiredRunning', () => {
    it('counts an app exactly one grace period past its end block', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { endBlock: BLOCK - 2880 } } });
        expect(r.apps).toBe(1);
        expect(r.top[0]).toEqual({ name: 'a', instances: 1, daysExpired: 1, endBlock: BLOCK - 2880 });
    });

    it('does not count an app one block inside the grace period', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { endBlock: BLOCK - 2879 } } });
        expect(r.apps).toBe(0);
    });

    it('never counts an app whose spec is still live, whatever a lookup says', () => {
        const r = run({
            running: { a: 2 },
            specs: [{ name: 'a', height: BLOCK - 10, expire: 1000 }],
            lookups: { a: { endBlock: BLOCK - 100_000 } }
        });
        expect(r.apps).toBe(0);
        expect(r.needLookup).toEqual([]);
    });

    it('takes the end block from a spec that is present but expired, with no lookup', () => {
        const r = run({ running: { a: 1 }, specs: [{ name: 'a', height: BLOCK - 10_000, expire: 100 }] });
        expect(r.apps).toBe(1);
        expect(r.top[0].daysExpired).toBe(Math.floor(9_900 / 2880));
        expect(r.needLookup).toEqual([]);
    });

    it('matches specs to running apps case-insensitively', () => {
        const r = run({ running: { AbioticFactor: 1 }, specs: [{ name: 'AbioticFactor', height: BLOCK, expire: 1000 }] });
        expect(r.needLookup).toEqual([]);
        expect(r.apps).toBe(0);
    });

    it('asks for a lookup when a running app has no spec and no lookup yet', () => {
        const r = run({ running: { AbioticFactor: 1 } });
        expect(r.needLookup).toEqual(['abioticfactor']);
        expect(r.apps).toBe(0);
    });

    it('does not count an app with no permanent messages (local container, never subscribed)', () => {
        const r = run({ running: { v11: 1 }, lookups: { v11: { none: true } } });
        expect(r.apps).toBe(0);
        expect(r.unresolved).toBe(0);
    });

    it('reports a failed lookup as unresolved, never as counted', () => {
        const r = run({ running: { a: 1 }, lookups: { a: { failed: true } } });
        expect(r.apps).toBe(0);
        expect(r.unresolved).toBe(1);
    });

    it('sums instances (nodes) across apps and lists the top 3 longest expired', () => {
        const r = run({
            running: { w: 4, x: 1, y: 3, z: 1 },
            lookups: {
                w: { endBlock: BLOCK - 2880 * 18 },
                x: { endBlock: BLOCK - 2880 * 50 },
                y: { endBlock: BLOCK - 2880 * 7 },
                z: { endBlock: BLOCK - 2880 * 46 }
            }
        });
        expect(r.apps).toBe(4);
        expect(r.instances).toBe(9);
        expect(r.top.map(t => [t.name, t.daysExpired])).toEqual([['x', 50], ['z', 46], ['w', 18]]);
    });

    it('breaks a tie on days expired by name', () => {
        const r = run({ running: { b: 1, a: 1 }, lookups: { a: { endBlock: BLOCK - 5760 }, b: { endBlock: BLOCK - 5760 } } });
        expect(r.top.map(t => t.name)).toEqual(['a', 'b']);
    });

    it('returns zeros and an empty list when nothing has expired', () => {
        const r = run({ running: { a: 1 }, specs: [{ name: 'a', height: BLOCK, expire: 5000 }] });
        expect(r).toMatchObject({ apps: 0, instances: 0, unresolved: 0, top: [] });
    });

    it('shows the name as the container spelled it', () => {
        const r = run({ running: { AbioticFactor: 1 }, lookups: { abioticfactor: { endBlock: BLOCK - 2880 * 2 } } });
        expect(r.top[0].name).toBe('AbioticFactor');
    });
});

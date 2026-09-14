import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #161: the Top Network Stats carousel only ever showed Cumulus. fetchTopBenchmarks
 * filtered on `benchmarking === 'CUMULUS'`, so the network's larger Nimbus and Stratus
 * nodes -- which are precisely the ones that win "Most Cores" and "Biggest SSD" -- could
 * never appear. The carousel now reports each tier separately.
 */

vi.mock('../resilientFetch.js', () => ({
    resilientFetch: vi.fn()
}));

import { resilientFetch } from '../resilientFetch.js';
import { fetchCarouselData } from '../carouselService.js';

function node(ip, tier, bench) {
    return {
        benchmark: {
            status: { benchmarking: tier },
            bench: {
                ipaddress: ip,
                cores: 2, ram: 8, ssd: 100, ddwrite: 100, eps: 100,
                download_speed: 100, upload_speed: 100,
                ...bench
            }
        }
    };
}

// One clear winner per tier so each tier's "Most Cores" is unambiguous.
const NODES = [
    node('1.1.1.1', 'CUMULUS', { cores: 4, ssd: 200 }),
    node('1.1.1.2', 'CUMULUS', { cores: 2, ssd: 100 }),
    node('2.2.2.1', 'NIMBUS', { cores: 8, ssd: 400 }),
    node('2.2.2.2', 'NIMBUS', { cores: 6, ssd: 300 }),
    node('3.3.3.1', 'STRATUS', { cores: 16, ssd: 800 }),
    node('3.3.3.2', 'STRATUS', { cores: 12, ssd: 600 })
];

beforeEach(() => {
    vi.clearAllMocks();
    resilientFetch.mockResolvedValue({ status: 'success', data: NODES });
});

describe('fetchTopBenchmarks tier coverage (issue #161)', () => {
    it('reports all three tiers, not just Cumulus', async () => {
        const stats = await fetchCarouselData();
        const tiers = [...new Set(stats.map(s => s.tier))];
        expect(tiers.sort()).toEqual(['Cumulus', 'Nimbus', 'Stratus']);
    });

    it('picks the top node within each tier, not the network-wide top', async () => {
        const stats = await fetchCarouselData();
        const cores = stats.filter(s => s.category === 'cores');

        // Three winners, one per tier -- the old code produced exactly one, always Cumulus.
        expect(cores).toHaveLength(3);
        expect(cores.find(s => s.tier === 'Cumulus').name).toBe('1.1.1.1');
        expect(cores.find(s => s.tier === 'Nimbus').name).toBe('2.2.2.1');
        expect(cores.find(s => s.tier === 'Stratus').name).toBe('3.3.3.1');
    });

    it('groups the slides by tier so the carousel transitions tier by tier', async () => {
        const stats = await fetchCarouselData();
        const order = stats.map(s => s.tier);
        // Every tier's slides are contiguous: the tier changes exactly twice across the run.
        const changes = order.filter((t, i) => i > 0 && t !== order[i - 1]).length;
        expect(changes).toBe(2);
        expect(order[0]).toBe('Cumulus');
    });

    it('skips a tier with no benchmarked nodes rather than emitting empty slides', async () => {
        resilientFetch.mockResolvedValue({
            status: 'success',
            data: NODES.filter(n => n.benchmark.status.benchmarking !== 'NIMBUS')
        });
        const stats = await fetchCarouselData();
        expect([...new Set(stats.map(s => s.tier))].sort()).toEqual(['Cumulus', 'Stratus']);
    });

    it('still ignores nodes with an incomplete benchmark', async () => {
        resilientFetch.mockResolvedValue({
            status: 'success',
            data: [
                node('1.1.1.1', 'CUMULUS', { cores: 4 }),
                { benchmark: { status: { benchmarking: 'CUMULUS' }, bench: { ipaddress: '9.9.9.9', cores: 0 } } }
            ]
        });
        const stats = await fetchCarouselData();
        expect(stats.every(s => s.name !== '9.9.9.9')).toBe(true);
    });
});

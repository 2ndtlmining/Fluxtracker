import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRunningApps = vi.fn();
vi.mock('../runningAppsProvider.js', () => ({
    getRunningApps: (...args) => mockGetRunningApps(...args)
}));

vi.mock('../resilientFetch.js', () => ({
    resilientFetch: vi.fn()
}));

import { fetchTopApps } from '../carouselService.js';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('fetchTopApps', () => {
    it('groups by image-without-tag, sums counts, sorts descending', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['itzg/minecraft-server:latest', 4],
                ['itzg/minecraft-server:1.20', 2], // same image, different tag — should merge
                ['presearch/node:latest', 5]
            ])
        });

        const result = await fetchTopApps();

        expect(result[0]).toMatchObject({ name: 'itzg/minecraft-server', value: 6, rank: 1 });
        expect(result[1]).toMatchObject({ name: 'presearch/node', value: 5, rank: 2 });
    });

    it('excludes watchtower', async () => {
        mockGetRunningApps.mockResolvedValue({
            imageCounts: new Map([
                ['containrrr/watchtower:latest', 999],
                ['presearch/node:latest', 5]
            ])
        });

        const result = await fetchTopApps();

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('presearch/node');
    });

    it('caps at 10 entries', async () => {
        const entries = Array.from({ length: 15 }, (_, i) => [`repo${i}/image:latest`, 15 - i]);
        mockGetRunningApps.mockResolvedValue({ imageCounts: new Map(entries) });

        const result = await fetchTopApps();

        expect(result).toHaveLength(10);
        expect(result[0].name).toBe('repo0/image');
    });

    it('returns an empty array when the provider throws', async () => {
        mockGetRunningApps.mockRejectedValue(new Error('network down'));

        const result = await fetchTopApps();

        expect(result).toEqual([]);
    });
});

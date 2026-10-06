import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Expired-running detection looks apps up on permanentmessages?appname=, which is
 * CASE-SENSITIVE ("AbioticFactor" resolves, "abioticfactor" returns []). deploymentCounts is
 * keyed lowercase, so the census must also carry each app's name as the container spelled it.
 */
vi.mock('../appSpecsCache.js', () => ({
    ensureGlobalSpecsCache: vi.fn(async () => {}),
    resolveRunningAppName: vi.fn(() => ({ appName: 'x', repotag: 'some/image:1' })),
    getAllAppSpecs: vi.fn(() => [])
}));
const mockFetch = vi.fn();
vi.mock('../resilientFetch.js', () => ({ resilientFetch: (...a) => mockFetch(...a) }));

import { getRunningApps, clearRunningAppsCache } from '../runningAppsProvider.js';

beforeEach(() => { vi.clearAllMocks(); clearRunningAppsCache(); });

describe('deploymentNames', () => {
    it('maps each lowercase app key to the casing the container used', async () => {
        mockFetch.mockResolvedValue({ data: [
            { apps: { runningapps: [{ Names: ['/fluxabioticfactor_AbioticFactor'] }] } },
            { apps: { runningapps: [{ Names: ['/fluxdragonwilds1790622302263'] }] } }
        ] });

        const apps = await getRunningApps({ force: true, retries: 0 });

        expect(apps.deploymentNames.get('abioticfactor')).toBe('AbioticFactor');
        expect(apps.deploymentNames.get('dragonwilds1790622302263')).toBe('dragonwilds1790622302263');
        expect(apps.deploymentCounts.get('abioticfactor')).toBe(1);
    });
});

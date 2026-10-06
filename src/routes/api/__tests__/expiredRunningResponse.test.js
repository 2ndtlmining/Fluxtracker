import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Final review: the route used withDbFallback, which cached a successful `{available:false}`
 * for 10 minutes -- one missed block height right after a restart showed "n/a" on the card
 * long after the next cycle had a figure. The route now relies on the service's own cache,
 * which never stores an unavailable result.
 */
const mockGetExpiredRunning = vi.fn();
vi.mock('../../../lib/services/expiredRunningService.js', () => ({
    getExpiredRunning: (...a) => mockGetExpiredRunning(...a)
}));

import { expiredRunningResponse } from '../analytics.js';

beforeEach(() => vi.clearAllMocks());

describe('expiredRunningResponse', () => {
    it('does not hold on to an unavailable answer', async () => {
        mockGetExpiredRunning.mockResolvedValueOnce(null);
        expect(await expiredRunningResponse()).toEqual({ available: false });

        mockGetExpiredRunning.mockResolvedValueOnce({ apps: 2, instances: 3, unresolved: 0, top: [] });
        expect(await expiredRunningResponse()).toMatchObject({ available: true, apps: 2 });
    });
});

import { describe, it, expect, vi } from 'vitest';

/**
 * Issue #431: testAllServices isolates each step and never throws, so the scheduler reported
 * healthy while a service failed every cycle. It now records each step's last success and
 * failures in a row, and /api/health names a step that keeps failing.
 */

vi.mock('../test-allServices.js', () => ({ testAllServices: vi.fn() }));
vi.mock('../carouselService.js', () => ({ fetchCarouselData: vi.fn(), fetchLatestDeployedApps: vi.fn(), fetchExpiringApps: vi.fn() }));
vi.mock('../decentralizationService.js', () => ({ runDecentralizationCycle: vi.fn() }));

import { recordServiceResults, getServiceTestSchedulerStatus } from '../servicesScheduler.js';
import { summarizeHealth } from '../../healthSummary.js';

describe('per-service health (issue #431)', () => {
    it('a cloud outage for three cycles turns /api/health degraded, naming cloud', () => {
        const t0 = Date.parse('2026-09-29T10:00:00Z');
        recordServiceResults({ succeeded: ['nodes', 'cloud'], failed: [] }, t0);
        for (let i = 1; i <= 3; i++) {
            recordServiceResults({ succeeded: ['nodes'], failed: [{ name: 'cloud', error: 'upstream unavailable -- served the stored figures' }] }, t0 + i * 300000);
        }

        const status = getServiceTestSchedulerStatus();
        expect(status.services.cloud).toMatchObject({ consecutiveFailures: 3, lastSuccess: t0 });
        expect(status.services.nodes.consecutiveFailures).toBe(0);
        expect(status.isHealthy).toBe(false);

        const health = summarizeHealth({ dbReachable: true, services: status.services, now: t0 + 15 * 60000 });
        expect(health.status).toBe('degraded');
        expect(health.problems).toEqual(['cloud refresh failed 3 cycles in a row (last success 15 min ago)']);
    });

    it('one success resets the count', () => {
        recordServiceResults({ succeeded: ['cloud'], failed: [] });
        expect(getServiceTestSchedulerStatus().services.cloud.consecutiveFailures).toBe(0);
    });
});

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

import { staleServices, staleColumns, __resetServiceHealthForTests, STALE_SOURCE_MS } from '../serviceHealth.js';

describe('stale sources for the daily snapshot (issue #431, option B)', () => {
    const now = Date.parse('2026-09-30T00:10:00Z');
    const failing = (name, lastSuccess) => {
        recordServiceResults({ succeeded: [name], failed: [] }, lastSuccess);
        recordServiceResults({ succeeded: [], failed: [{ name, error: 'down' }] }, now - 60000);
    };

    it('a source failing for 6 hours or more is stale; one that failed recently is not', () => {
        __resetServiceHealthForTests();
        failing('cloud', now - 7 * 3600000);
        failing('gaming', now - 30 * 60000);
        recordServiceResults({ succeeded: ['nodes'], failed: [] }, now - 60000);

        expect(STALE_SOURCE_MS).toBe(6 * 3600000);
        expect(staleServices(STALE_SOURCE_MS, now)).toEqual(['cloud']);
    });

    it('maps a stale source to exactly its own columns', () => {
        __resetServiceHealthForTests();
        failing('cloud', now - 7 * 3600000);
        const cols = staleColumns(STALE_SOURCE_MS, now);
        expect(cols).toEqual(expect.arrayContaining(['total_cpu_cores', 'cpu_utilization_percent', 'total_apps', 'deployment_fill_percent']));
        expect(cols).not.toContain('node_total');
        expect(cols).not.toContain('current_revenue');
    });
});

import { fetchNodeStats } from './nodeService.js';
import { fetchCloudStats } from './cloudService.js';
import { fetchGamingStats } from './gamingService.js';
import { fetchCryptoStats } from './cryptoService.js';
import { fetchWordPressStats } from './wordpressService.js';
import { fetchRevenueStats } from './revenueService.js';
import { getRunningApps, toRepoCounts } from './runningAppsProvider.js';
import { getCurrentMetrics, createRepoSnapshots } from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('testAllServices');

// Minimum unique images before we trust the payload enough to overwrite today's repo
// snapshot — matches the guard snapshotManager already applies to the nightly write.
const MIN_REPO_KEYS = 10;

/**
 * Refresh the per-image counts for today.
 *
 * createRepoSnapshots() upserts on (snapshot_date, image_name) and applies categorizeImage()
 * at write time, so running it every cycle is idempotent. This is what lets the category
 * cards show today's numbers instead of yesterday's daily snapshot — and because it reads
 * the same payload the metrics above were derived from, the two can't disagree.
 */
async function refreshTodayRepoSnapshot() {
    const runningApps = await getRunningApps();
    const repoCounts = toRepoCounts(runningApps);
    const keyCount = Object.keys(repoCounts).length;

    if (keyCount < MIN_REPO_KEYS) {
        throw new Error(`Only ${keyCount} unique images (expected ${MIN_REPO_KEYS}+), likely partial API data`);
    }

    const today = new Date().toISOString().split('T')[0];
    const saved = await createRepoSnapshots(today, repoCounts);
    log.info({ date: today, images: saved }, 'Refreshed today\'s repo snapshot: %d images', saved);
    return saved;
}

/**
 * Run every service for one cycle.
 *
 * Each step is isolated: a failure is recorded and the remaining steps still run. The
 * previous version awaited all six sequentially inside a single try, so the first failure
 * silently skipped everything after it for the whole cycle.
 *
 * Steps stay sequential on purpose. updateCurrentMetrics() is a read-modify-write of the
 * single current_metrics row, so running these concurrently would let one service's write
 * clobber another's columns. The shared runningAppsProvider already collapses their network
 * calls into one fetch, so sequential costs almost nothing.
 */
async function testAllServices() {
    log.info('Running all services...');

    const steps = [
        ['nodes', fetchNodeStats],
        ['cloud', fetchCloudStats],
        ['gaming', fetchGamingStats],
        ['crypto', fetchCryptoStats],
        ['wordpress', fetchWordPressStats],
        ['revenue', fetchRevenueStats],
        ['repoSnapshot', refreshTodayRepoSnapshot]
    ];

    const succeeded = [];
    const failed = [];

    for (const [name, fn] of steps) {
        try {
            await fn();
            succeeded.push(name);
        } catch (error) {
            failed.push({ name, error: error?.message || String(error) });
            log.error({ err: error, service: name }, '%s failed', name);
        }
    }

    if (failed.length > 0) {
        log.warn({ succeeded, failed }, '%d/%d services succeeded', succeeded.length, steps.length);
    } else {
        log.info({ succeeded }, 'All services completed');
    }

    const metrics = await getCurrentMetrics().catch(() => null);
    if (metrics) log.info({ metrics }, 'Current metrics');

    return { succeeded, failed, allSucceeded: failed.length === 0 };
}

export { testAllServices };

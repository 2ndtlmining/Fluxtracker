import { fetchNodeStats } from './nodeService.js';
import { fetchCloudStats } from './cloudService.js';
import { fetchGamingStats } from './gamingService.js';
import { fetchCryptoStats } from './cryptoService.js';
import { fetchWordPressStats } from './wordpressService.js';
import { fetchRevenueStats } from './revenueService.js';
import { getCurrentMetrics } from '../db/database.js';
import { createLogger } from '../logger.js';

const log = createLogger('testAllServices');

async function testAllServices() {
    log.info('Testing All Services...');

    try {
        // Test 1: Nodes
        log.info('Test 1: Node Statistics');
        await fetchNodeStats();

        // Test 2: Cloud
        log.info('Test 2: Cloud Utilization');
        await fetchCloudStats();

        // Test 3: Gaming
        log.info('Test 3: Gaming Apps');
        await fetchGamingStats();

        // Test 4: Crypto (NEW)
        log.info('Test 4: Crypto Nodes');
        await fetchCryptoStats();

        // Test 5: WordPress
        log.info('Test 5: WordPress Count');
        await fetchWordPressStats();

        // Test 6: Revenue
        log.info('Test 6: Revenue & Price');
        await fetchRevenueStats();

        // Show final results
        log.info('Final Database State');
        const metrics = await getCurrentMetrics();
        log.info({ metrics }, 'Current metrics');

        log.info('All services tested successfully!');

    } catch (error) {
        log.error({ err: error }, 'Test failed');
    }
}

// Export the function
export { testAllServices };

// Run the test
testAllServices();
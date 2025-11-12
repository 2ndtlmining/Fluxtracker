import { fetchNodeStats } from './nodeService.js';
import { fetchCloudStats } from './cloudService.js';
import { fetchGamingStats } from './gamingService.js';
import { fetchCryptoStats } from './cryptoService.js';  
import { fetchWordPressStats } from './wordpressService.js';
import { fetchRevenueStats } from './revenueService.js';
import { getCurrentMetrics } from '../db/database.js';

async function testAllServices() {
    console.log('🧪 Testing All Services...\n');
    console.log('='.repeat(60));
    
    try {
        // Test 1: Nodes
        console.log('\n📊 Test 1: Node Statistics');
        console.log('-'.repeat(60));
        await fetchNodeStats();
        
        // Test 2: Cloud
        console.log('\n☁️  Test 2: Cloud Utilization');
        console.log('-'.repeat(60));
        await fetchCloudStats();
        
        // Test 3: Gaming
        console.log('\n🎮 Test 3: Gaming Apps');
        console.log('-'.repeat(60));
        await fetchGamingStats();
        
        // Test 4: Crypto (NEW)
        console.log('\n🪙 Test 4: Crypto Nodes');
        console.log('-'.repeat(60));
        await fetchCryptoStats();
        
        // Test 5: WordPress
        console.log('\n🌐 Test 5: WordPress Count');
        console.log('-'.repeat(60));
        await fetchWordPressStats();
        
        // Test 6: Revenue
        console.log('\n💰 Test 6: Revenue & Price');
        console.log('-'.repeat(60));
        await fetchRevenueStats();
        
        // Show final results
        console.log('\n📈 Final Database State');
        console.log('='.repeat(60));
        const metrics = getCurrentMetrics();
        console.log(JSON.stringify(metrics, null, 2));
        
        console.log('\n✅ All services tested successfully!\n');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error);
    }
}

// Export the function
export { testAllServices };

// Run the test
testAllServices();
import { debugBlockbookAddress, initialSync, fetchFluxPrice } from './revenueService.js';
import { TARGET_ADDRESSES } from '../config.js';

console.log('🧪 Testing Blockbook API Integration\n');
console.log('='.repeat(80));

// Test with your address
await debugBlockbookAddress(TARGET_ADDRESSES[0]);

console.log('\n' + '='.repeat(80));
console.log('\n💡 If debug passed, running full sync...\n');

// Fetch FLUX price first
try {
    console.log('💰 Fetching FLUX price...\n');
    await fetchFluxPrice();
    console.log('');
} catch (error) {
    console.warn('⚠️  Could not fetch price:', error.message);
}

// If debug works, run full sync
try {
    await initialSync();
} catch (error) {
    console.error('Sync failed:', error);
}
import { fetchCryptoStats, formatCryptoStats, getCryptoBreakdown } from './cryptoService.js';

console.log('🧪 Testing Crypto Service\n');
console.log('='.repeat(80));

try {
    // Fetch crypto stats
    console.log('\n📡 Fetching crypto node statistics from Flux network...\n');
    const cryptoData = await fetchCryptoStats();
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RAW DATA');
    console.log('='.repeat(80));
    console.log(JSON.stringify(cryptoData, null, 2));
    
    // Format for display
    console.log('\n' + '='.repeat(80));
    console.log('📋 FORMATTED STATS');
    console.log('='.repeat(80));
    const formatted = formatCryptoStats(cryptoData);
    console.log(`\nTotal Crypto Nodes: ${formatted.total}\n`);
    
    formatted.nodes.forEach(node => {
        if (node.count > 0) {
            console.log(`  ${node.name.padEnd(20)} ${node.count.toString().padStart(5)} nodes`);
        }
    });
    
    // Get breakdown by category
    console.log('\n' + '='.repeat(80));
    console.log('📈 BREAKDOWN BY CATEGORY');
    console.log('='.repeat(80));
    const breakdown = getCryptoBreakdown(cryptoData);
    
    console.log(`\nTimpi Nodes:       ${breakdown.timpi.count.toString().padStart(5)} (${breakdown.timpi.percentage}%)`);
    console.log(`Mining Nodes:      ${breakdown.mining.count.toString().padStart(5)} (${breakdown.mining.percentage}%)`);
    console.log(`Other Nodes:       ${breakdown.other.count.toString().padStart(5)} (${breakdown.other.percentage}%)`);
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Crypto service test completed successfully!\n');
    
} catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
}
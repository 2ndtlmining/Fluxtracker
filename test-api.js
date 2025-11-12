/**
 * API Test Suite
 * Tests all endpoints of the Flux Performance Dashboard API
 */

const API_BASE = 'http://localhost:3000/api';

// ANSI color codes for terminal output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    reset: '\x1b[0m'
};

async function testEndpoint(name, url, expectedStatus = 200) {
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.status === expectedStatus) {
            console.log(`${colors.green}✓${colors.reset} ${name}`);
            return { success: true, data };
        } else {
            console.log(`${colors.red}✗${colors.reset} ${name} - Expected ${expectedStatus}, got ${response.status}`);
            return { success: false, error: `Status mismatch: ${response.status}` };
        }
    } catch (error) {
        console.log(`${colors.red}✗${colors.reset} ${name} - ${error.message}`);
        return { success: false, error: error.message };
    }
}

async function runTests() {
    console.log(`\n${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}║  FLUX DASHBOARD API - TEST SUITE              ║${colors.reset}`);
    console.log(`${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}\n`);
    
    let passed = 0;
    let failed = 0;
    
    // Test 1: Health Check
    console.log(`${colors.yellow}Health & Status:${colors.reset}`);
    let result = await testEndpoint('Health check', `${API_BASE}/health`);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Database stats', `${API_BASE}/stats`);
    result.success ? passed++ : failed++;
    
    // Test 2: Current Metrics
    console.log(`\n${colors.yellow}Current Metrics:${colors.reset}`);
    result = await testEndpoint('Get current metrics', `${API_BASE}/metrics/current`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Revenue: ${result.data.revenue.current} FLUX`);
        console.log(`  ${colors.blue}→${colors.reset} Total Nodes: ${result.data.nodes.total}`);
        console.log(`  ${colors.blue}→${colors.reset} CPU Utilization: ${result.data.cloud.cpu.utilization}%`);
    }
    
    // Test 3: Historical Data
    console.log(`\n${colors.yellow}Historical Data:${colors.reset}`);
    result = await testEndpoint('Get snapshots (default 30 days)', `${API_BASE}/history/snapshots`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Snapshots returned: ${result.data.count}`);
    }
    
    result = await testEndpoint('Get snapshots (limit 7)', `${API_BASE}/history/snapshots?limit=7`);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Get revenue history (30 days)', `${API_BASE}/history/revenue/30d`);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Get revenue history (7 days)', `${API_BASE}/history/revenue/7d`);
    result.success ? passed++ : failed++;
    
    // Test 4: Metric History
    console.log(`\n${colors.yellow}Metric History:${colors.reset}`);
    const metrics = ['nodes', 'gaming', 'crypto', 'wordpress', 'cpu', 'ram'];
    for (const metric of metrics) {
        result = await testEndpoint(`Get ${metric} history (30d)`, `${API_BASE}/history/metric/${metric}/30d`);
        result.success ? passed++ : failed++;
    }
    
    // Test 5: Transactions
    console.log(`\n${colors.yellow}Transactions:${colors.reset}`);
    result = await testEndpoint('Get recent transactions', `${API_BASE}/transactions/recent`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Transactions returned: ${result.data.count}`);
        console.log(`  ${colors.blue}→${colors.reset} Total today: ${result.data.totalToday}`);
    }
    
    result = await testEndpoint('Get recent transactions (limit 5)', `${API_BASE}/transactions/recent?limit=5`);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Get transaction summary', `${API_BASE}/transactions/summary`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Total transactions: ${result.data.totalTransactions}`);
        console.log(`  ${colors.blue}→${colors.reset} Today's revenue: ${result.data.revenue.today} FLUX`);
    }
    
    // Get today's date for testing
    const today = new Date().toISOString().split('T')[0];
    result = await testEndpoint(`Get transactions for ${today}`, `${API_BASE}/transactions/date/${today}`);
    result.success ? passed++ : failed++;
    
    // Test 6: Analytics
    console.log(`\n${colors.yellow}Analytics:${colors.reset}`);
    result = await testEndpoint('Comparison (7 days ago)', `${API_BASE}/analytics/comparison/7`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Revenue change: ${result.data.changes.revenue.change.toFixed(2)}%`);
        console.log(`  ${colors.blue}→${colors.reset} Nodes change: ${result.data.changes.nodes.difference}`);
    }
    
    result = await testEndpoint('Comparison (30 days ago)', `${API_BASE}/analytics/comparison/30`);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Trends (30 days)', `${API_BASE}/analytics/trends/30d`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Revenue trend: ${result.data.trends.revenue.direction}`);
        console.log(`  ${colors.blue}→${colors.reset} Nodes trend: ${result.data.trends.nodes.direction}`);
    }
    
    result = await testEndpoint('Trends (7 days)', `${API_BASE}/analytics/trends/7d`);
    result.success ? passed++ : failed++;
    
    // Test 7: Categories
    console.log(`\n${colors.yellow}Category Details:${colors.reset}`);
    result = await testEndpoint('Gaming category', `${API_BASE}/categories/gaming`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Total gaming apps: ${result.data.current.total}`);
        console.log(`  ${colors.blue}→${colors.reset} Palworld: ${result.data.current.palworld}`);
        console.log(`  ${colors.blue}→${colors.reset} Minecraft: ${result.data.current.minecraft}`);
    }
    
    result = await testEndpoint('Crypto category', `${API_BASE}/categories/crypto`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Total crypto nodes: ${result.data.current.total}`);
        console.log(`  ${colors.blue}→${colors.reset} Presearch: ${result.data.current.presearch}`);
        console.log(`  ${colors.blue}→${colors.reset} Kadena: ${result.data.current.kadena}`);
    }
    
    result = await testEndpoint('Nodes category', `${API_BASE}/categories/nodes`);
    result.success ? passed++ : failed++;
    if (result.success) {
        console.log(`  ${colors.blue}→${colors.reset} Total nodes: ${result.data.current.total}`);
        console.log(`  ${colors.blue}→${colors.reset} Cumulus: ${result.data.current.cumulus} (${result.data.current.distribution.cumulus}%)`);
        console.log(`  ${colors.blue}→${colors.reset} Nimbus: ${result.data.current.nimbus} (${result.data.current.distribution.nimbus}%)`);
    }
    
    // Test 8: Error Handling
    console.log(`\n${colors.yellow}Error Handling:${colors.reset}`);
    result = await testEndpoint('Invalid endpoint (404)', `${API_BASE}/invalid`, 404);
    result.success ? passed++ : failed++;
    
    result = await testEndpoint('Invalid metric name', `${API_BASE}/history/metric/invalid/30d`, 400);
    result.success ? passed++ : failed++;
    
    // Summary
    console.log(`\n${colors.blue}╔════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}║  TEST RESULTS                                  ║${colors.reset}`);
    console.log(`${colors.blue}╚════════════════════════════════════════════════╝${colors.reset}`);
    console.log(`${colors.green}Passed:${colors.reset} ${passed}`);
    console.log(`${colors.red}Failed:${colors.reset} ${failed}`);
    console.log(`${colors.blue}Total:${colors.reset}  ${passed + failed}`);
    console.log(`${colors.blue}Success Rate:${colors.reset} ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);
    
    if (failed === 0) {
        console.log(`${colors.green}✓ All tests passed!${colors.reset}\n`);
    } else {
        console.log(`${colors.red}✗ Some tests failed. Check the output above.${colors.reset}\n`);
    }
    
    process.exit(failed === 0 ? 0 : 1);
}

// Check if server is running
async function checkServer() {
    try {
        await fetch(`${API_BASE}/health`);
        return true;
    } catch (error) {
        console.log(`${colors.red}Error: Server is not running on ${API_BASE}${colors.reset}`);
        console.log(`${colors.yellow}Please start the server with: npm start${colors.reset}\n`);
        return false;
    }
}

// Run tests
(async () => {
    const serverRunning = await checkServer();
    if (serverRunning) {
        await runTests();
    } else {
        process.exit(1);
    }
})();
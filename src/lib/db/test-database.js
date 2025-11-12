import { initDatabase, getDatabaseStats, getCurrentMetrics } from './database.js';

console.log('🧪 Testing database initialization...');

const stats = getDatabaseStats();
console.log('📊 Database Stats:', stats);

const currentMetrics = getCurrentMetrics();
console.log('📈 Current Metrics:', currentMetrics);

console.log('✅ Database test completed!');
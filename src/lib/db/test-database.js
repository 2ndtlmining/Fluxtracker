import 'dotenv/config';
import { getDatabaseStats, getCurrentMetrics } from './database.js';

console.log('🧪 Testing database initialization...');

const stats = await getDatabaseStats();
console.log('📊 Database Stats:', stats);

const currentMetrics = await getCurrentMetrics();
console.log('📈 Current Metrics:', currentMetrics);

console.log('✅ Database test completed!');

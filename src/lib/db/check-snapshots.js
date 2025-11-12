import { getSnapshotByDate } from './database.js';

async function fetchLatestSnapshots() {
    const now = new Date();
    let daysAgo = 0;
    
    while (daysAgo <= 7) { // Check for the last 7 days
        const dateStr = new Date(now);
        dateStr.setDate(now.getDate() - daysAgo);
        
        const snapshot = await getSnapshotByDate(dateStr.toISOString().split('T')[0]);
        
        if (snapshot) {
            console.log(`Snapshot for ${dateStr.toISOString().split('T')[0]}:`, snapshot);
        } else {
            console.log(`No snapshot found for ${dateStr.toISOString().split('T')[0]}`);
        }
        
        daysAgo++;
    }
}

fetchLatestSnapshots();
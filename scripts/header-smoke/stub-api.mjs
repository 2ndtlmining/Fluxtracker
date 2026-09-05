// Deterministic /api/header stub for the header animation acceptance harness.
// Bumps blockHeight on every request so the 30s header poll sees a new block and
// triggers the sync animation on its second poll.
import http from 'node:http';

let blockHeight = 294912;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  if (req.url.startsWith('/api/header')) {
    blockHeight += 3;
    res.end(JSON.stringify({
      appVersion: 'v1.03',
      network: {
        fluxPriceUsd: 0.1234,
        blockHeight,
        totalNodes: 12481,
        totalApps: 3842,
        arcaneOsCodename: 'jolly wombat'
      },
      tracker: {
        uptime: 123456.7,
        snapshots: 819,
        lastSnapshotDate: '2026-09-04',
        snapshotHealthy: true,
        transactions: 9999,
        lastSyncBlock: blockHeight
      },
      host: {
        platform: 'win32',
        nodeVersion: process.version,
        cpuCores: 8,
        totalMemMB: 16384,
        usedMemMB: 8192,
        memPercent: 50,
        location: { city: 'Melbourne', country: 'Australia', countryCode: 'AU' }
      },
      dbStatus: 'online'
    }));
    return;
  }
  // Other dashboard endpoints answer with an empty object so the rest of the
  // page renders without error noise.
  res.end('{}');
});

const port = Number(process.env.STUB_PORT || 3100);
server.listen(port, '127.0.0.1', () => console.log(`[header-smoke] stub api on ${port}`));

// Deterministic /api/header + /api/carousel/deployed stub for the header animation
// acceptance harness. Bumps blockHeight on every request so the 30s header poll sees a
// new block and triggers the sync animation on its second poll.
//
// Deployment scenario (issue #98's harness acceptance criterion): starts with an empty
// deployed-apps list so the header's baseline-seeding poll has nothing to seed against
// falsely, then check-header.mjs calls POST /inject-deployment on demand to add a new
// entry once it's done asserting the boot/sync behavior -- this avoids racing the sync
// and deployment scenarios against each other on the same poll.
import http from 'node:http';

let blockHeight = 294912;
let deployedApps = [];

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

  if (req.url.startsWith('/api/carousel/deployed')) {
    res.end(JSON.stringify({ stats: deployedApps, cached: true, cacheAge: 0, fresh: true }));
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/inject-deployment')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const overrides = body ? JSON.parse(body) : {};
      deployedApps = [{
        name: 'test-minecraft',
        repo: 'itzg/minecraft-server:latest',
        instances: 3,
        cpu: 2,
        ram: 4096,
        hdd: 25,
        height: blockHeight,
        ...overrides
      }];
      res.end(JSON.stringify({ ok: true, deployedApps }));
    });
    return;
  }

  // Other dashboard endpoints answer with an empty object so the rest of the
  // page renders without error noise.
  res.end('{}');
});

const port = Number(process.env.STUB_PORT || 3100);
server.listen(port, '127.0.0.1', () => console.log(`[header-smoke] stub api on ${port}`));

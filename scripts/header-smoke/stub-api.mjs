// Deterministic /api/header + /api/carousel/deployed + /api/carousel/expiring stub for
// the header animation acceptance harness.
//
// Idle-rotation scenario (issue #104 Phase 2): both carousel endpoints start out serving
// one fixture app each ("initial-*"), so the header's rotation has real data to show
// from its first poll onward -- no seed-then-inject dance needed since the rotation
// isn't event-driven any more. From the SECOND call onward each endpoint switches to a
// different fixture ("updated-*"), so check-header.mjs can assert the rotation picks up
// the change on a later poll instead of holding onto whatever it first saw (the user's
// "don't use cached info" requirement).
import http from 'node:http';

let blockHeight = 294912;
let deployedCalls = 0;
let expiringCalls = 0;

const INITIAL_DEPLOYED = {
  name: 'initial-minecraft',
  repo: 'itzg/minecraft-server:latest',
  instances: 3,
  cpu: 2,
  ram: 4096,
  hdd: 25,
  blockAge: 100
};
const UPDATED_DEPLOYED = {
  name: 'updated-minecraft',
  repo: 'runonflux/orbit:latest', // exercises the octocat icon
  instances: 2,
  cpu: 1,
  ram: 2048,
  hdd: 10,
  blockAge: 5
};

const INITIAL_EXPIRING = {
  name: 'initial-wordpress',
  instances: 1,
  cpu: 1,
  ram: 1024,
  hdd: 10,
  blocksUntilExpiry: 240 // 2h
};
const UPDATED_EXPIRING = {
  name: 'updated-wordpress',
  instances: 1,
  cpu: 1,
  ram: 1024,
  hdd: 10,
  blocksUntilExpiry: 20 // 10m -- more urgent, as a real re-fetch would surface
};

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
    deployedCalls++;
    const app = deployedCalls === 1 ? INITIAL_DEPLOYED : UPDATED_DEPLOYED;
    res.end(JSON.stringify({ stats: [app], cached: true, cacheAge: 0, fresh: true }));
    return;
  }

  if (req.url.startsWith('/api/carousel/expiring')) {
    expiringCalls++;
    const app = expiringCalls === 1 ? INITIAL_EXPIRING : UPDATED_EXPIRING;
    res.end(JSON.stringify({ stats: [app], cached: true, cacheAge: 0, fresh: true }));
    return;
  }

  // Other dashboard endpoints answer with an empty object so the rest of the
  // page renders without error noise.
  res.end('{}');
});

const port = Number(process.env.STUB_PORT || 3100);
server.listen(port, '127.0.0.1', () => console.log(`[header-smoke] stub api on ${port}`));

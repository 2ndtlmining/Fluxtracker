/**
 * Run the production stack locally: Express API + the built SvelteKit server.
 *
 * This is the npm-script twin of `startup.sh`, which is what the Docker image runs. Same two
 * processes, same ports, same start order — so what you see locally is what Flux runs.
 *
 * Two processes are required, not one. The browser only ever talks to the SvelteKit server;
 * `src/hooks.server.js` proxies every `/api/*` request onward to Express at 127.0.0.1:3000.
 * That is the single-port architecture Flux needs, and it means the frontend is useless on its
 * own — `npm start` alone serves pages whose API calls all fail.
 *
 * Written in Node rather than as a shell one-liner because `PORT=5173 node ...` is not valid
 * syntax in cmd.exe or PowerShell, and this has to work on Windows.
 *
 *   npm run build && npm run start:all
 *
 * Ports follow startup.sh: API_PORT (default 3000), FRONTEND_PORT (default 5173).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const API_PORT = process.env.API_PORT || '3000';
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5173';
const HOST = process.env.HOST || '0.0.0.0';
const ORIGIN = process.env.ORIGIN || `http://localhost:${FRONTEND_PORT}`;

const BUILD_ENTRY = join(root, 'build', 'index.js');

if (!existsSync(BUILD_ENTRY)) {
    console.error('No build found at build/index.js — run `npm run build` first.');
    process.exit(1);
}

const children = [];
let shuttingDown = false;

/** Take the whole stack down together: half of it running is never what you want. */
function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) child.kill();
    process.exit(code);
}

function start(name, entry, env) {
    // process.execPath, not "node" — avoids depending on how PATH is set up on Windows
    const child = spawn(process.execPath, [entry], {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: 'inherit'
    });

    child.on('exit', (code) => {
        if (!shuttingDown) {
            console.error(`\n${name} exited (code ${code}) — stopping the other process too.`);
            shutdown(code ?? 1);
        }
    });

    children.push(child);
    return child;
}

/**
 * Poll /api/health/live, not /api/health.
 *
 * The full health check reports unhealthy when the price history is stale, which is a real
 * signal but has nothing to do with whether the process has finished booting. Gating startup
 * on it would refuse to start the frontend over a days-old price row.
 */
async function waitFor(url, attempts = 30) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
            if (response.ok) return true;
        } catch {
            // not up yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`Starting API on port ${API_PORT}...`);
start('API', join(root, 'src', 'server.js'), { PORT: API_PORT });

if (!(await waitFor(`http://127.0.0.1:${API_PORT}/api/health/live`))) {
    console.error(`API did not respond on port ${API_PORT} within 30s — check the output above.`);
    shutdown(1);
}

// API_PORT goes to the frontend too: hooks.server.js proxies /api/* to the API, and it has to
// be told the same port the API was actually started on or every request 503s.
console.log(`API ready. Starting frontend on port ${FRONTEND_PORT}...`);
start('Frontend', BUILD_ENTRY, { PORT: FRONTEND_PORT, HOST, ORIGIN, API_PORT });

/**
 * Verify the proxy, not just the two processes.
 *
 * Both can be up and healthy while the frontend still cannot reach the API — that is exactly
 * what a port mismatch looks like, and checking each process separately misses it completely.
 * This request follows the same path the browser does, so if it passes the dashboard has data.
 */
if (!(await waitFor(`http://127.0.0.1:${FRONTEND_PORT}/api/health/live`, 20))) {
    console.error('');
    console.error(`Frontend is up on ${FRONTEND_PORT} but cannot reach the API through its /api/* proxy.`);
    console.error('The dashboard would load with no data ("API proxy error: fetch failed").');
    console.error(`Most likely the build predates the configurable proxy — run \`npm run build\` and retry.`);
    shutdown(1);
}

console.log('');
console.log(`  Dashboard  http://localhost:${FRONTEND_PORT}`);
console.log(`  API        http://localhost:${API_PORT}/api/health`);
console.log(`  Proxy      /api/* -> 127.0.0.1:${API_PORT}  (verified)`);
console.log('');
console.log('Ctrl+C stops both.');

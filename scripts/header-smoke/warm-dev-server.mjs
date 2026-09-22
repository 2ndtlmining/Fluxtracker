/**
 * Load the dashboard once and throw the result away, so the run that matters measures the
 * app rather than Vite.
 *
 * `check-header.mjs` asserts `boot text appears at boot start` as firstText < 1500ms. On a
 * dev server that has already served the page that is comfortably true. On a cold one it is
 * not: Vite transforms each module on first request, and the boot animation cannot start
 * until the client bundle has been fetched, compiled and hydrated. A clean CI runner
 * measured 2324ms and failed a check about the animation, for a delay that belongs entirely
 * to the dev server and does not exist in the adapter-node build that actually ships.
 *
 * Warming is the honest fix. Raising the threshold would blind the check to the regression
 * it exists to catch.
 *
 * Usage (after the stub and dev server are up):
 *   BROWSER_PATH=/usr/bin/google-chrome node scripts/header-smoke/warm-dev-server.mjs
 *
 * Env: BASE_URL (default http://127.0.0.1:5199), BROWSER_PATH, WARM_SETTLE_MS.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const SETTLE_MS = Number(process.env.WARM_SETTLE_MS || 4000);

// Same candidate list as check-header.mjs, so the two agree on which browser is used.
const browserPath = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p => p && existsSync(p));

if (!browserPath) {
    console.error('No Edge/Chrome found. Set BROWSER_PATH to a Chromium executable.');
    process.exit(1);
}

const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-first-run']
});

try {
    const page = await browser.newPage();
    const started = Date.now();

    // networkidle2 rather than 'load': the point is to make Vite transform the module
    // graph the page actually pulls in, which continues well past the load event.
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120000 });

    // The dashboard keeps fetching after idle (carousel, comparisons, chart data). Give
    // those a moment so their modules are compiled too.
    await new Promise(r => setTimeout(r, SETTLE_MS));

    console.log(`warmed ${BASE} in ${Date.now() - started}ms`);
} finally {
    await browser.close();
}

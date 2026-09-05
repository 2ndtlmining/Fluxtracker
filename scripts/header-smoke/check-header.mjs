/* Header animation acceptance harness.
 *
 * Drives a real (headless) browser against a running dev server + the stub API
 * and asserts the invariants the header was iterated on, so a future change can
 * be checked the same way every one of these was accepted:
 *
 *   - boot is slow (~2x) and the header size never changes — one distinct box
 *     and header height from first paint through boot, steady state and sync
 *   - boot text, sync text and build-info all share one voice (font/colour)
 *   - sync frames always fill all 6 rows (no empty lines mid-wipe)
 *   - the sync blocks counter counts up and lands "... OK"; sync ~2.7s total
 *   - the sync pattern is a random 2-char texture, different on every sync
 *   - build version is accent-green, codename accent-purple
 *   - mobile (375px): exactly 6 mobile rows, no wrapping
 *
 * Usage:
 *   1. npm install --no-save puppeteer-core   (uses the installed Edge/Chrome)
 *   2. node scripts/header-smoke/stub-api.mjs                 (terminal 1)
 *   3. VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --port 5199   (terminal 2)
 *   4. node scripts/header-smoke/check-header.mjs             (terminal 3)
 *
 * Env overrides: BASE_URL (default http://127.0.0.1:5199), STUB_URL,
 * BROWSER_PATH (default: first of Edge/Chrome found), SAMPLE_MS.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const STUB_URL = process.env.STUB_URL || 'http://127.0.0.1:3100/api/header';
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 60);

const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const browserPath = BROWSER_CANDIDATES.find(p => existsSync(p));
if (!browserPath) {
  console.error('No Edge/Chrome found. Set BROWSER_PATH to a Chromium executable.');
  process.exit(2);
}

async function stubReachable() {
  try {
    const res = await fetch(STUB_URL);
    return res.ok;
  } catch {
    return false;
  }
}

const bootTextStyle = { color: 'rgb(136, 146, 176)', fontSize: '11.2px' };
const GREEN = 'rgb(0, 255, 65)';    // --accent-green
const PURPLE = 'rgb(189, 147, 249)'; // --accent-purple

const run = async () => {
  if (!(await stubReachable())) {
    console.error(`Stub API not reachable at ${STUB_URL} — start scripts/header-smoke/stub-api.mjs first.`);
    process.exit(2);
  }

  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // Other dashboard cards fetch endpoints the stub answers with `{}`; their
    // error logs are expected noise here.
    if (/Failed to load resource|CORS|Error fetching/i.test(m.text())) return;
    consoleErrors.push(m.text());
  });

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 500));

  // ---------- sample the whole boot + steady + first sync ----------
  const samples = [];
  const phases = { firstText: null, firstLogoRow: null, settled: null, syncTextSeen: null, backToLogo: null, syncStartT: null };
  let emptyRowViolations = 0;
  let syncSamples = 0;
  const counterValues = [];
  const patternContents = new Set();
  let sawLoadingTransactions = false;
  let sawTransactionsLoaded = false;
  let sawSnapshotsRow = false;
  let sawNetworkRow = false;
  let sawSyncComplete = false;
  let sawCounterOK = false;
  let syncStartT = null;
  const syncDurations = [];
  const bootTextAt2s = { text: null };

  while (Date.now() - t0 < 75000) {
    const s = await page.evaluate(() => {
      const box = document.querySelector('.terminal-box');
      if (!box) return null;
      const spans = [...box.querySelectorAll('span')];
      const textStyleRow = spans.find(sp => sp.className.includes('row-text') && sp.textContent.replace(/\n/g, '').length > 0);
      const style = textStyleRow
        ? (() => { const cs = getComputedStyle(textStyleRow); return { color: cs.color, fontSize: cs.fontSize, text: textStyleRow.textContent.replace(/\n/g, '') }; })()
        : null;
      return {
        settled: box.className.includes('settled'),
        boxH: box.getBoundingClientRect().height,
        headerH: document.querySelector('header.header')?.getBoundingClientRect().height ?? null,
        textStyle: style,
        rows: spans.map(sp => ({ cls: sp.className, text: sp.textContent.replace(/\n/g, '') }))
      };
    });
    if (s) {
      const t = Date.now() - t0;
      const logoFrame = s.rows.every(r => r.cls.includes('row-logo'));
      const textRows = s.rows.filter(r => r.cls.includes('row-text'));
      const textContent = textRows.map(r => r.text);
      const withContent = textContent.filter(x => x.length > 0);

      samples.push({ t, boxH: s.boxH, headerH: s.headerH, settled: s.settled, rows: s.rows, textStyle: s.textStyle });
      if (s.settled) phases.settled ??= t;
      if (phases.firstText === null && withContent.length > 0) phases.firstText = t;
      if (t > 2000 && t < 2600 && bootTextAt2s.text === null && withContent.length > 0) {
        bootTextAt2s.text = withContent.join('\n');
      }
      if (phases.firstLogoRow === null && s.rows.some(r => r.cls.includes('row-logo'))) phases.firstLogoRow = t;

      if (s.settled && textContent.length > 0) {
        // sync-ish: symbol-only texture or the sync text rows
        const isTexture = withContent.length > 0 && textContent.every(x => x.length === 0 || !/[a-z0-9]/i.test(x));
        const isSyncText = textContent.some(x => /synched blocks|loading transactions|sync complete/.test(x));
        if (isTexture || isSyncText) {
          if (phases.syncStartT === null) phases.syncStartT = t;
          syncSamples++;
          const empties = s.rows.filter(r => r.text.length === 0).length;
          if (empties > 0) emptyRowViolations++;
          if (isTexture) patternContents.add(textContent.join('|'));
          const row0 = s.rows[0]?.text || '';
          const m = row0.match(/synched blocks (\d+) \/ (\d+)/);
          if (m) {
            const x = parseInt(m[1], 10);
            if (counterValues.length === 0 || counterValues[counterValues.length - 1] !== x) counterValues.push(x);
            if (row0.includes('... OK')) sawCounterOK = true;
          }
          if (isSyncText) {
            if (textContent.some(x => x === 'loading transactions...')) sawLoadingTransactions = true;
            if (textContent.some(x => /[\d,.]+ transactions loaded successfully/.test(x))) sawTransactionsLoaded = true;
            if (textContent.some(x => /daily snapshots\.\.\. [\d,]+ loaded/.test(x))) sawSnapshotsRow = true;
            if (textContent.some(x => /network [\d,.]+ nodes \| apps [\d,.]+/.test(x))) sawNetworkRow = true;
            if (textContent.some(x => x === 'sync complete')) sawSyncComplete = true;
            phases.syncTextSeen ??= t;
          }
        }
      }
      // sync ends when the box is back to the pure logo
      if (s.settled && logoFrame && phases.syncStartT !== null) {
        syncDurations.push(t - phases.syncStartT);
        phases.syncStartT = null;
        if (phases.syncTextSeen !== null) phases.backToLogo ??= t;
      }
    }
    await new Promise(r => setTimeout(r, SAMPLE_MS));
    if (phases.backToLogo !== null && syncDurations.length >= 1 && Date.now() - t0 > 40000) break;
  }
  await page.screenshot({ path: fileURLToPath(new URL('./steady.png', import.meta.url)), clip: { x: 0, y: 0, width: 700, height: 160 } }).catch(() => {});

  const build = await page.evaluate(() => {
    const pick = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent, color: cs.color };
    };
    return { version: pick('.build-version'), codename: pick('.build-codename') };
  });

  // ---------- mobile stage ----------
  await page.setViewport({ width: 375, height: 700 });
  await page.reload({ waitUntil: 'networkidle2' });
  let mobile = null;
  const mDeadline = Date.now() + 15000;
  while (Date.now() < mDeadline) {
    mobile = await page.evaluate(() => {
      const box = document.querySelector('.terminal-box');
      if (!box) return null;
      return {
        settled: box.className.includes('settled'),
        boxH: box.getBoundingClientRect().height,
        rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        overflow: box.scrollWidth > box.clientWidth
      };
    });
    if (mobile?.settled) break;
    await new Promise(r => setTimeout(r, 150));
  }

  await browser.close();

  // ---------- analysis ----------
  const heights = samples.filter(s => s.boxH > 0 && s.headerH !== null);
  const distinctBox = [...new Set(heights.map(s => Math.round(s.boxH * 100) / 100))];
  const distinctHeader = [...new Set(heights.map(s => Math.round(s.headerH * 100) / 100))];
  const bootSamples = phases.firstLogoRow ? samples.filter(s => s.t < phases.firstLogoRow) : samples;
  const maxBootHeader = Math.max(...bootSamples.map(s => s.headerH));
  const steady = samples.filter(s => phases.settled !== null && s.t > phases.settled + 2000)[0];
  const bootTextStyleSample = samples.find(s => s.rows.some(r => r.cls.includes('row-text') && r.text.length > 0));

  const firstText = phases.firstText ?? Infinity;
  const readingPhase = phases.firstLogoRow !== null && phases.firstText !== null
    ? phases.firstLogoRow - phases.firstText
    : 0;
  const syncTextMatchesBoot = (() => {
    const syncStyle = samples.find(s => s.textStyle && /synched blocks|transactions loaded successfully/.test(s.textStyle.text) && s.t > (phases.settled ?? 0) + 2000);
    if (!syncStyle) return null;
    return syncStyle.textStyle.color === bootTextStyle.color && syncStyle.textStyle.fontSize === bootTextStyle.fontSize;
  })();

  const checks = [
    ['boot text appears at boot start', firstText < 1500],
    ['boot reading phase >= 3.4s (2x the original)', readingPhase >= 3400],
    ['glow settle happens', phases.settled !== null],
    ['box height constant (one distinct value all run)', distinctBox.length === 1],
    ['header height constant boot vs steady', steady ? Math.abs(maxBootHeader - steady.headerH) < 1 : false],
    ['header height constant overall (one distinct value)', distinctHeader.length === 1],
    ['no console errors', consoleErrors.length === 0],
    ['sync observed', syncSamples > 0],
    ['sync frames never show an empty row', syncSamples > 0 && emptyRowViolations === 0],
    ['sync counter counts up and lands "... OK"', counterValues.length >= 2 && counterValues[counterValues.length - 1] > counterValues[0] && sawCounterOK],
    ['sync text frame carries all real-data rows', sawLoadingTransactions && sawTransactionsLoaded && sawSnapshotsRow && sawNetworkRow && sawSyncComplete],
    ['sync total ~2.7s (consistent wipe speeds)', syncDurations.length > 0 && syncDurations.every(d => d > 1800 && d < 4200)],
    ['sync text style matches boot text', syncTextMatchesBoot === true],
    ['pattern is a random 2-char texture, different per sync', patternContents.size >= 2],
    ['build version is accent-green', build.version && build.version.color === GREEN],
    ['build codename is accent-purple', build.codename && build.codename.color === PURPLE],
    ['mobile: exactly 6 mobile rows, no overflow', mobile?.settled && Math.abs(mobile.boxH - 6 * 0.8 * mobile.rootPx) < 1 && !mobile.overflow]
  ];

  console.log('phases:', JSON.stringify({ ...phases, syncStartT: undefined }, null, 0));
  console.log('counter:', counterValues.join(' -> '), '| sync durations(ms):', syncDurations.join(', '));
  console.log('distinct box heights:', distinctBox, '| distinct header heights:', distinctHeader);
  console.log('boot text @~2.2s:\n' + (bootTextAt2s.text || '(not captured)'));
  console.log('pattern variants:', patternContents.size, '| empty-row violations:', emptyRowViolations);

  let allPass = true;
  console.log('\n=== CHECKS ===');
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) allPass = false;
  }
  console.log(allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
};

run().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });

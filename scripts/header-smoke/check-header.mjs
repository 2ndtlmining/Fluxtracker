/* Header animation acceptance harness.
 *
 * Drives a real (headless) browser against a running dev server + the stub API
 * and asserts the invariants the header was iterated on, so a future change can
 * be checked the same way every one of these was accepted:
 *
 *   - boot is slow (~2x) and the header size never changes — one distinct box
 *     and header height from first paint through boot and the idle rotation
 *   - boot text and the idle-rotation info frames share one voice (font/colour)
 *   - the idle rotation (issue #104 Phase 2) cycles Logo -> Latest Expiring ->
 *     Latest Deployed -> Logo -> ...: both info frames appear, each shows its
 *     icon/NAME/EXPIRE-or-REPO/INST/RES rows, no frame ever shows an empty row,
 *     and the box returns to a pure logo frame between them
 *   - the rotation reflects a later poll's data, not what it first loaded: the
 *     stub switches both carousel endpoints to a different fixture app after
 *     their first call, and the harness waits to see that new name on screen
 *   - the deployed/expiring frames' icon bookend rows carry their own accent colour
 *     (green/orange) distinct from the shared boot-text colour (item 4 of the
 *     decentralization follow-ups) -- middle NAME/REPO/EXPIRE/INST/RES rows keep the
 *     shared voice checked above; only the icon rows are accented
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
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const STUB_URL = process.env.STUB_URL || 'http://127.0.0.1:3100/api/header';
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 60);
// Generous enough to cover boot (~5s) + the second header poll picking up the
// stub's "updated-*" fixtures (~30s in) + that update reaching its slot in the
// rotation (up to one full ~25s cycle away).
const MAIN_LOOP_BUDGET_MS = 100000;

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
const ORANGE = 'rgb(249, 115, 22)'; // --accent-orange fallback (#f97316)

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

  // ---------- sample boot + idle rotation ----------
  const samples = [];
  const phases = { firstText: null, firstLogoRow: null, settled: null };
  const bootTextAt2s = { text: null };

  let emptyRowViolations = 0;
  let sawExpiringFrame = false;
  let sawDeployedFrame = false;
  let sawUpdatedDeployedName = false;
  let sawUpdatedExpiringName = false;
  let sawExpireRow = false;
  let sawInstRow = false;
  let sawResRow = false;
  let sawDockerOrGithubIcon = false;
  let returnedToLogoAfterInfo = false;
  let infoTextStyleMatchesBoot = null;
  let deployedIconIsGreen = null;
  let expiringIconIsOrange = null;

  while (Date.now() - t0 < MAIN_LOOP_BUDGET_MS) {
    const s = await page.evaluate(() => {
      const box = document.querySelector('.terminal-box');
      if (!box) return null;
      const spans = [...box.querySelectorAll('span')];
      const textStyleRow = spans.find(sp => sp.className.includes('row-text') && sp.textContent.replace(/\n/g, '').length > 0);
      const style = textStyleRow
        ? (() => { const cs = getComputedStyle(textStyleRow); return { color: cs.color, fontSize: cs.fontSize, text: textStyleRow.textContent.replace(/\n/g, '') }; })()
        : null;
      const deployedIconRow = spans.find(sp => sp.className.includes('row-deployed'));
      const expiringIconRow = spans.find(sp => sp.className.includes('row-expiring'));
      return {
        settled: box.className.includes('settled'),
        boxH: box.getBoundingClientRect().height,
        headerH: document.querySelector('header.header')?.getBoundingClientRect().height ?? null,
        textStyle: style,
        deployedIconColor: deployedIconRow ? getComputedStyle(deployedIconRow).color : null,
        expiringIconColor: expiringIconRow ? getComputedStyle(expiringIconRow).color : null,
        rows: spans.map(sp => ({ cls: sp.className, text: sp.textContent.replace(/\n/g, '') }))
      };
    });
    if (s) {
      const t = Date.now() - t0;
      const logoFrame = s.rows.every(r => r.cls.includes('row-logo'));
      const textRows = s.rows.filter(r => r.cls.includes('row-text'));
      const textContent = textRows.map(r => r.text);
      const withContent = textContent.filter(x => x.length > 0);
      // Content detection (NAME/EXPIRE/DOCKER/GITHUB) reads every row's text, not just
      // row-text ones: the deployed/expiring frames' icon bookend rows now carry their
      // own row-deployed/row-expiring class (item 4 of the decentralization follow-ups),
      // so a row-text-only join would silently drop the "<< GITHUB >>"/"!! EXPIRING !!"
      // glyph text and undercount these checks. The text-style check below still reads
      // s.textStyle, which is computed from a row-text row specifically.
      const joined = s.rows.map(r => r.text).join('\n');

      samples.push({ t, boxH: s.boxH, headerH: s.headerH, settled: s.settled, rows: s.rows, textStyle: s.textStyle });
      if (s.settled) phases.settled ??= t;
      if (phases.firstText === null && withContent.length > 0) phases.firstText = t;
      if (t > 2000 && t < 2600 && bootTextAt2s.text === null && withContent.length > 0) {
        bootTextAt2s.text = withContent.join('\n');
      }
      if (phases.firstLogoRow === null && s.rows.some(r => r.cls.includes('row-logo'))) phases.firstLogoRow = t;

      // An idle-rotation info frame (expiring or deployed), identified by its NAME row.
      if (s.settled && /NAME\s+\S/.test(joined)) {
        const isExpiring = /EXPIRE\s+\S/.test(joined) || joined.includes('EXPIRING');
        const isDeployed = joined.includes('DOCKER') || joined.includes('GITHUB');

        if (isExpiring) {
          sawExpiringFrame = true;
          if (joined.includes('updated-wordpress')) sawUpdatedExpiringName = true;
        }
        if (isDeployed) {
          sawDeployedFrame = true;
          sawDockerOrGithubIcon = true;
          if (joined.includes('updated-minecraft')) sawUpdatedDeployedName = true;
        }
        if (/EXPIRE\s+\S/.test(joined)) sawExpireRow = true;
        if (/INST\s+\d/.test(joined)) sawInstRow = true;
        if (/RES\s+/.test(joined)) sawResRow = true;

        const empties = s.rows.filter(r => r.text.length === 0).length;
        if (empties > 0) emptyRowViolations++;

        if (infoTextStyleMatchesBoot === null && s.textStyle) {
          infoTextStyleMatchesBoot = s.textStyle.color === bootTextStyle.color && s.textStyle.fontSize === bootTextStyle.fontSize;
        }
        if (isDeployed && deployedIconIsGreen === null && s.deployedIconColor) {
          deployedIconIsGreen = s.deployedIconColor === GREEN;
        }
        if (isExpiring && expiringIconIsOrange === null && s.expiringIconColor) {
          expiringIconIsOrange = s.expiringIconColor === ORANGE;
        }
      }

      if (s.settled && logoFrame && (sawExpiringFrame || sawDeployedFrame)) {
        returnedToLogoAfterInfo = true;
      }
    }
    await new Promise(r => setTimeout(r, SAMPLE_MS));
    if (sawUpdatedDeployedName && sawUpdatedExpiringName && returnedToLogoAfterInfo && Date.now() - t0 > 45000) break;
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

  const firstText = phases.firstText ?? Infinity;
  const readingPhase = phases.firstLogoRow !== null && phases.firstText !== null
    ? phases.firstLogoRow - phases.firstText
    : 0;

  const checks = [
    ['boot text appears at boot start', firstText < 1500],
    ['boot reading phase >= 3.4s (2x the original)', readingPhase >= 3400],
    ['glow settle happens', phases.settled !== null],
    ['box height constant (one distinct value all run)', distinctBox.length === 1],
    ['header height constant boot vs steady', steady ? Math.abs(maxBootHeader - steady.headerH) < 1 : false],
    ['header height constant overall (one distinct value)', distinctHeader.length === 1],
    ['no console errors', consoleErrors.length === 0],
    ['idle rotation: expiring frame observed', sawExpiringFrame],
    ['idle rotation: deployed frame observed', sawDeployedFrame],
    ['idle rotation: docker/github icon shown on the deployed frame', sawDockerOrGithubIcon],
    ['idle rotation: EXPIRE row shown', sawExpireRow],
    ['idle rotation: INST row shown', sawInstRow],
    ['idle rotation: RES row shown', sawResRow],
    ['idle rotation: no info frame ever shows an empty row', emptyRowViolations === 0],
    ['idle rotation: info-frame text style matches boot text', infoTextStyleMatchesBoot === true],
    ['idle rotation: deployed frame icon rows are accent-green', deployedIconIsGreen === true],
    ['idle rotation: expiring frame icon rows are accent-orange', expiringIconIsOrange === true],
    ['idle rotation: returns to the logo between info frames', returnedToLogoAfterInfo],
    ['idle rotation: picks up the updated deployed app on a later poll (not cached)', sawUpdatedDeployedName],
    ['idle rotation: picks up the updated expiring app on a later poll (not cached)', sawUpdatedExpiringName],
    ['build version is accent-green', build.version && build.version.color === GREEN],
    ['build codename is accent-purple', build.codename && build.codename.color === PURPLE],
    ['mobile: exactly 6 mobile rows, no overflow', mobile?.settled && Math.abs(mobile.boxH - 6 * 0.8 * mobile.rootPx) < 1 && !mobile.overflow]
  ];

  console.log('phases:', JSON.stringify(phases, null, 0));
  console.log('distinct box heights:', distinctBox, '| distinct header heights:', distinctHeader);
  console.log('boot text @~2.2s:\n' + (bootTextAt2s.text || '(not captured)'));
  console.log('empty-row violations:', emptyRowViolations);
  if (consoleErrors.length > 0) console.log('console errors:', JSON.stringify(consoleErrors, null, 0));

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

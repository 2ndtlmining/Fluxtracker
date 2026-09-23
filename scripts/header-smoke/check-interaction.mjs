/* Header interaction harness (PR 10: issues #282, #284 and the desktop side panel).
 *
 * Asserts, against the stub API:
 *   - the side panel renders beside the box on desktop, six non-empty rows, the same height
 *     as the box, and is hidden on mobile
 *   - hovering holds the frame past a full rotation hold and shows `[ paused ]`; leaving
 *     resumes the rotation
 *   - clicking an app frame puts that app's name in the transaction search and brings the
 *     transaction section on screen (#284)
 *   - clicking the logo replays the last intro
 *   - 20 rapid clicks on "next up" leave ONE rotation chain: the frame that follows holds
 *     for a full dwell instead of being wiped by a second chain (#192's double loop, which
 *     a click could otherwise recreate)
 *   - no console errors
 *
 * Usage (same shape as the other harness scripts):
 *   node scripts/header-smoke/stub-api.mjs                 (terminal 1)
 *   API_PORT=3100 npm run dev -- --port 5199               (terminal 2)
 *   node scripts/header-smoke/check-interaction.mjs        (terminal 3)
 *
 * Env overrides: BASE_URL, STUB_URL, BROWSER_PATH. Takes ~90s.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const STUB_URL = process.env.STUB_URL || 'http://127.0.0.1:3100/api/carousel/deployed';
const ROTATE_HOLD_MS = 8000;
// Same margin check-boot-race.mjs uses: far below a real dwell, far above a second chain's.
const MIN_SLOT_DWELL_MS = 5000;

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function stubReachable() {
  try {
    return (await fetch(STUB_URL)).ok;
  } catch {
    return false;
  }
}

/** The box as rows, plus what kind of frame it is. */
async function readBox(page) {
  return page.evaluate(() => {
    const box = document.querySelector('.terminal-box');
    if (!box) return null;
    const rows = [...box.querySelectorAll('span')].map(s => ({ cls: s.className, text: s.textContent.replace(/\n/g, '') }));
    const text = rows.map(r => r.text).join('\n');
    const all = cls => rows.length > 0 && rows.every(r => r.cls.includes(cls));
    let kind = 'other';
    if (all('row-logo')) kind = 'logo';
    else if (/\bNAME\b/.test(text)) kind = rows.some(r => r.cls.includes('row-expiring')) ? 'expiring' : 'deployed';
    else if (all('row-deployed')) kind = 'intro';
    const name = (text.match(/NAME\s+(\S+)/) || [])[1] ?? null;
    // `[ paused ]` REPLACES the last row's final 10 columns, so the signature leaves those
    // columns out -- otherwise pausing itself would read as the frame changing.
    const sig = rows.map((r, i) => (i === rows.length - 1 ? r.text.slice(0, -10) : r.text)).join('|');
    return { kind, name, text, sig };
  });
}

async function waitFor(page, predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const box = await readBox(page);
    if (box && predicate(box)) return box;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const run = async () => {
  if (!(await stubReachable())) {
    console.error(`Stub API not reachable at ${STUB_URL} — start scripts/header-smoke/stub-api.mjs first.`);
    process.exit(2);
  }

  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run'] });
  const results = [];
  const check = (name, ok, detail = '') => results.push([name, ok, detail]);

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => {
      if (m.type() !== 'error') return;
      // Same filter as check-header.mjs: other cards call endpoints the stub does not serve.
      if (/Failed to load resource|CORS|Error fetching/i.test(m.text())) return;
      errors.push(m.text());
    });
    page.on('pageerror', e => errors.push(String(e)));
    await page.setViewport({ width: 1400, height: 900 });
    await page.mouse.move(700, 880); // well away from the header
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.terminal-row.ready', { timeout: 30000 });

    // ---- side panel ----
    const panel = await page.evaluate(() => {
      const p = document.querySelector('.side-panel');
      const box = document.querySelector('.terminal-box');
      const rows = [...p.querySelectorAll('.panel-row')].map(r => r.textContent.trim());
      return {
        display: getComputedStyle(p).display,
        rows,
        panelH: Math.round(p.getBoundingClientRect().height),
        boxH: Math.round(box.getBoundingClientRect().height),
        sideBySide: p.getBoundingClientRect().left > box.getBoundingClientRect().right
      };
    });
    check('panel: shown beside the box on desktop', panel.display === 'flex' && panel.sideBySide, panel.display);
    check('panel: six rows, none empty', panel.rows.length === 6 && panel.rows.every(r => r.length > 0), JSON.stringify(panel.rows));
    check('panel: same height as the box', panel.panelH === panel.boxH, `${panel.panelH} vs ${panel.boxH}`);

    // ---- hover pause (#282) ----
    const boxRect = await page.$eval('.terminal-box', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const before = await readBox(page);
    await page.mouse.move(boxRect.x, boxRect.y);
    await sleep(ROTATE_HOLD_MS + 3000);
    const during = await readBox(page);
    check('hover: frame holds past a full rotation hold', during.sig === before.sig, `${before.kind} -> ${during.kind}`);
    check('hover: box shows [ paused ]', /\[ paused \]$/.test(during.text.split('\n').at(-1)));
    await page.mouse.move(700, 880);
    const t0 = Date.now();
    await waitFor(page, b => b.sig !== during.sig, 4000, 'rotation to resume');
    check('leave: rotation resumes promptly', Date.now() - t0 < 4000, `${Date.now() - t0}ms`);

    // ---- click an app frame -> transaction search (#284) ----
    const appFrame = await waitFor(page, b => b.kind === 'deployed' || b.kind === 'expiring', 40000, 'an app detail frame');
    const panelName = await page.$eval('.side-panel .panel-name', el => el.textContent.trim());
    await page.click('.terminal-box');
    await sleep(1500);
    const afterClick = await page.evaluate(() => {
      const input = document.querySelector('.search-input');
      const log = document.querySelector('.transaction-log');
      const r = log.getBoundingClientRect();
      return { search: input?.value, logOnScreen: r.top < window.innerHeight && r.bottom > 0 };
    });
    check('click app frame: panel names the same app as the box', panelName === appFrame.name, `${panelName} / ${appFrame.name}`);
    check('click app frame: transaction search is that app', afterClick.search === appFrame.name, afterClick.search);
    check('click app frame: transaction section scrolled into view', afterClick.logOnScreen);
    await page.mouse.move(700, 880);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    // ---- 20 rapid "next up" clicks: one chain afterwards ----
    await page.waitForSelector('.panel-next', { timeout: 30000 });
    for (let i = 0; i < 20; i++) {
      await page.click('.panel-next').catch(() => {});
      await sleep(30);
    }
    await page.mouse.move(700, 880);
    // Let the last click's intro/wipe finish, then the detail frame must hold a full dwell.
    const settled = await waitFor(page, b => b.kind === 'deployed' || b.kind === 'expiring', 15000, 'a detail frame after the click storm');
    const dwellStart = Date.now();
    let dwellBroken = null;
    while (Date.now() - dwellStart < MIN_SLOT_DWELL_MS) {
      const b = await readBox(page);
      if (b.sig !== settled.sig) { dwellBroken = Date.now() - dwellStart; break; }
      await sleep(60);
    }
    check(`20 rapid clicks: next frame holds >= ${MIN_SLOT_DWELL_MS}ms (one chain)`, dwellBroken === null,
      dwellBroken === null ? '' : `replaced after ${dwellBroken}ms`);

    // ---- click the logo -> replay the last intro ----
    await waitFor(page, b => b.kind === 'logo', 40000, 'the logo');
    await page.click('.terminal-box');
    const replay = await waitFor(page, b => b.kind === 'intro', 3000, 'the replayed intro').catch(() => null);
    check('click logo: last intro replays', !!replay);
    await page.mouse.move(700, 880);

    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' || '));

    // ---- mobile ----
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, isMobile: true });
    await mobile.goto(BASE, { waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('.side-panel');
    const mobilePanel = await mobile.$eval('.side-panel', el => getComputedStyle(el).display);
    check('mobile: side panel hidden', mobilePanel === 'none', mobilePanel);
  } catch (e) {
    check(`harness error: ${e.message}`, false);
  } finally {
    await browser.close();
  }

  console.log('');
  let failed = 0;
  for (const [name, ok, detail] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
    if (!ok) failed++;
  }
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
};

run().catch(e => {
  console.error(e);
  process.exit(2);
});

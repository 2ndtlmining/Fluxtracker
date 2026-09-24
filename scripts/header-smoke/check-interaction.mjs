/* Header interaction harness (issues #282, #284, #345).
 *
 * Asserts, against the stub API:
 *   - desktop: an app frame is ONE wide frame about that app (type, image, payment beside
 *     the name/expiry/instances/resources) with nothing unrelated in it (#345); mobile keeps
 *     the narrow frame
 *   - hovering holds the frame past a full rotation hold and shows `[ paused ]`; leaving
 *     resumes the rotation
 *   - clicking an app frame puts that app's name in the transaction search and brings the
 *     transaction section on screen (#284)
 *   - clicking the logo replays the last intro, and the frame after it holds a full dwell:
 *     one rotation chain, not two (#192's double loop, which a click could otherwise recreate)
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
    const anyLogo = rows.some(r => r.cls.includes('row-logo'));
    // Part logo, part something else = a wipe in progress, not a frame to judge.
    if (anyLogo && !all('row-logo')) kind = 'mixed';
    else if (all('row-logo')) kind = 'logo';
    else if (/\bNAME\b/.test(text)) kind = rows.some(r => r.cls.includes('row-expiring')) ? 'expiring' : 'deployed';
    // Anything else with no NAME row is art: a game intro, the crane, an outro or the fuse.
    else if (rows.length > 0) kind = 'intro';
    const name = (text.match(/NAME\s+(\S+)/) || [])[1] ?? null;
    // `[ paused ]` REPLACES the last row's final 10 columns, so the signature leaves those
    // columns out -- otherwise pausing itself would read as the frame changing.
    const sig = rows.map((r, i) => (i === rows.length - 1 ? r.text.slice(0, -10) : r.text)).join('|');
    // Which slot is on screen. A frame legitimately redraws in place when its payment lookup
    // lands ("checking…" -> the figure), so holds and dwells are judged on this, not on sig.
    const id = `${kind}:${name ?? ''}`;
    return { kind, name, text, sig, id };
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

/** Like waitFor, but only for a frame that is still the same a wipe's length later. */
async function waitForSettled(page, predicate, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const first = await waitFor(page, predicate, timeoutMs - (Date.now() - t0), label);
    await sleep(500); // REVEAL_MS is 400
    const second = await readBox(page);
    if (second && second.sig === first.sig) return second;
  }
  throw new Error(`timed out waiting for a settled ${label}`);
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

    // ---- wide detail frame (issue #345): one frame, everything about one app ----
    const wideFrame = await waitForSettled(page, b => b.kind === 'deployed' || b.kind === 'expiring', 40000, 'an app detail frame');
    const wideRows = wideFrame.text.split('\n');
    check('desktop: app frame is one wide frame with type, image, payment and term rows',
      /\b(GAME|SERVICE|TYPE)\b/.test(wideRows[1]) && /\bIMAGE\b/.test(wideRows[2]) && /\bPAID\b/.test(wideRows[3]) && /\bTERM\b/.test(wideRows[4]),
      JSON.stringify(wideRows));
    check('desktop: nothing that is not about the app (no block height, node count, next up)',
      !/block|nodes|next up/i.test(wideFrame.text));
    check('desktop: no side panel any more', await page.$('.side-panel') === null);

    // ---- hover pause (#282) ----
    const boxRect = await page.$eval('.terminal-box', el => { const r = el.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; });
    const before = await readBox(page);
    await page.mouse.move(boxRect.x, boxRect.y);
    await sleep(ROTATE_HOLD_MS + 3000);
    const during = await readBox(page);
    check('hover: frame holds past a full rotation hold', during.id === before.id, `${before.id} -> ${during.id}`);
    check('hover: box shows [ paused ]', /\[ paused \]$/.test(during.text.split('\n').at(-1)));
    await page.mouse.move(700, 880);
    const t0 = Date.now();
    await waitFor(page, b => b.id !== during.id, 4000, 'rotation to resume');
    check('leave: rotation resumes promptly', Date.now() - t0 < 4000, `${Date.now() - t0}ms`);

    // ---- click an app frame -> transaction search (#284) ----
    // Hover first (pauses the rotation), then read the frame and click: the app clicked is
    // exactly the app read, with no chance of the rotation moving on in between.
    await waitFor(page, b => b.kind === 'deployed' || b.kind === 'expiring', 40000, 'an app detail frame');
    await page.mouse.move(boxRect.x, boxRect.y);
    await sleep(300);
    const appFrame = await readBox(page);
    await page.mouse.click(boxRect.x, boxRect.y);
    await sleep(1500);
    const afterClick = await page.evaluate(() => {
      const input = document.querySelector('.search-input');
      const log = document.querySelector('.transaction-log');
      const r = log.getBoundingClientRect();
      return { search: input?.value, logOnScreen: r.top < window.innerHeight && r.bottom > 0 };
    });
    check('click app frame: transaction search is that app', afterClick.search === appFrame.name, afterClick.search);
    check('click app frame: transaction section scrolled into view', afterClick.logOnScreen);
    await page.mouse.move(700, 880);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    // ---- click the logo -> replay the last intro, and ONE chain carries on from it ----
    await waitFor(page, b => b.kind === 'logo', 40000, 'the logo');
    await page.click('.terminal-box');
    await page.mouse.move(700, 880);
    const replay = await waitFor(page, b => b.kind === 'intro', 3000, 'the replayed intro').catch(() => null);
    check('click logo: last intro replays', !!replay);
    const settled = await waitFor(page, b => b.kind === 'deployed' || b.kind === 'expiring', 15000, 'the detail frame after the replay');
    const dwellStart = Date.now();
    let dwellBroken = null;
    while (Date.now() - dwellStart < MIN_SLOT_DWELL_MS) {
      const b = await readBox(page);
      if (b.id !== settled.id) { dwellBroken = Date.now() - dwellStart; break; }
      await sleep(60);
    }
    check(`after a replay the detail frame holds >= ${MIN_SLOT_DWELL_MS}ms (one chain)`, dwellBroken === null,
      dwellBroken === null ? '' : `replaced after ${dwellBroken}ms`);

    // ---- attract mode (#288): typing "flux" plays every piece of art with a caption ----
    await page.mouse.move(700, 880);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.type('flux');
    const first = await waitFor(page, b => /ATTRACT MODE/.test(b.text) && /\b1 of \d+/.test(b.text), 15000, 'the first attract caption').catch(() => null);
    check('attract: typing "flux" starts the run', !!first && /1 of \d+/.test(first.text), first?.text.split('\n')[3]?.trim());
    const second = await waitFor(page, b => /ATTRACT MODE/.test(b.text) && /\b2 of \d+/.test(b.text), 15000, 'the second caption').catch(() => null);
    check('attract: it moves on to the next piece of art', !!second);
    // Typing into a field must not trigger it.
    await page.focus('.search-input');
    await page.keyboard.type('flux');
    await page.evaluate(() => document.activeElement?.blur());

    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' || '));

    // ---- mobile keeps the narrow frame ----
    const mobile = await browser.newPage();
    await mobile.setViewport({ width: 390, height: 844, isMobile: true });
    await mobile.goto(BASE, { waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('.terminal-row.ready', { timeout: 30000 });
    const narrow = await waitFor(mobile, b => b.kind === 'deployed' || b.kind === 'expiring', 40000, 'a mobile app frame');
    check('mobile: narrow frame (no IMAGE/PAID columns)', !/IMAGE|PAID/.test(narrow.text) && narrow.text.split('\n').every(r => r.length <= 34));
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

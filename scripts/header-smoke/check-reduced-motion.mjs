/* Reduced-motion regression harness for the terminal header (issue #194).
 *
 * The bug: schedule() clamps EVERY delay to 30ms when prefers-reduced-motion is on --
 *
 *   setTimeout(fn, reducedMotion ? Math.min(delay, 30) : delay)
 *
 * The clamp is there to fast-forward the boot's cosmetic pacing, but it also hits the two
 * delays that are not pacing at all:
 *
 *   1. scheduleNextRotationStep()'s ROTATE_HOLD_MS (8s) -- the dwell that makes a slot
 *      READABLE. Clamped, the box cycles Logo -> Expiring -> Deployment every 30ms: the
 *      "rapidly flashing FLUX logo" users reported. Reduced motion is precisely the
 *      preference that must never produce a 33Hz strobe.
 *   2. BOOT_TIMEOUT_MS (8s), the telemetry give-up. Clamped to 30ms it fires before the
 *      header fetch can possibly land, so a reduced-motion user always boots into
 *      "> telemetry unavailable" and never sees real numbers.
 *
 * Brave's fingerprinting protection reports prefers-reduced-motion: reduce regardless of
 * the OS setting, which is why this surfaced as "Brave users see a flashing logo".
 *
 * Usage (same shape as check-header.mjs):
 *   1. npm install --no-save puppeteer-core
 *   2. node scripts/header-smoke/stub-api.mjs        (terminal 1)
 *   3. API_PORT=3100 npm run dev -- --port 5199      (terminal 2)
 *   4. node scripts/header-smoke/check-reduced-motion.mjs   (terminal 3)
 *
 * Env overrides: BASE_URL, STUB_URL, BROWSER_PATH, SAMPLE_MS, RUN_MS.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const STUB_URL = process.env.STUB_URL || 'http://127.0.0.1:3100/api/carousel/deployed';
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 25);
// The boot, then the logo, the expiring still and details, and the deployed still at 8s
// each (the expiring slot gained a still of its own with the #182 fuse) -- 40s leaves room.
const RUN_MS = Number(process.env.RUN_MS || 40000);

// A healthy run repaints the box only on boot lines and rotation handovers: well under
// one change per second. The bug produces ~30 per second, so the threshold does not need
// to be tight to be decisive.
const MAX_FRAME_CHANGES = Number(process.env.MAX_FRAME_CHANGES || 40);

// Issue #289: once the rotation starts, every frame -- the poster of a game's art
// included -- holds for a full ROTATE_HOLD_MS (8s). The tolerance covers sampling only.
const ROTATE_HOLD_MS = 8000;
const HOLD_TOLERANCE_MS = 500;

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

const run = async () => {
  if (!(await stubReachable())) {
    console.error(`Stub API not reachable at ${STUB_URL} — start scripts/header-smoke/stub-api.mjs first.`);
    process.exit(2);
  }

  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  // The whole point of this harness: the component must behave under the preference, not
  // just under the default.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  let last = null;
  const changes = [];          // { t, sig } — one entry per repaint of the box
  let sawTelemetryUnavailable = null;
  let sawLogo = false;
  let firstLogoAt = null;
  let sawPoster = false;

  while (Date.now() - t0 < RUN_MS) {
    const frame = await page.evaluate(() => {
      const box = document.querySelector('.terminal-box');
      if (!box) return null;
      const rows = [...box.querySelectorAll('span')];
      return {
        sig: rows.map(s => `${s.className}:${s.textContent.replace(/\n/g, '')}`).join('|'),
        text: rows.map(s => s.textContent.replace(/\n/g, '')).join(' '),
        isLogo: rows.length > 0 && rows.every(s => s.className.includes('row-logo')),
        // A poster is intro art shown still (#289): every row in the art's accent, and none
        // of the detail frame's labelled rows.
        isPoster: rows.length > 0 && rows.every(s => s.className.includes('row-deployed'))
          && !rows.some(s => /\b(NAME|INST|AGO)\b/.test(s.textContent))
      };
    });

    if (frame) {
      const t = Date.now() - t0;
      if (frame.sig !== last) {
        changes.push({ t, sig: frame.sig });
        last = frame.sig;
      }
      if (frame.isLogo) {
        sawLogo = true;
        firstLogoAt ??= t;
      }
      if (frame.isPoster) sawPoster = true;
      if (sawTelemetryUnavailable === null && /telemetry unavailable/i.test(frame.text)) {
        sawTelemetryUnavailable = t;
      }
    }

    await new Promise(r => setTimeout(r, SAMPLE_MS));
  }

  await browser.close();

  const perSecond = (changes.length / (RUN_MS / 1000)).toFixed(1);

  // Gaps between consecutive repaints after the rotation began.
  const rotation = changes.filter(c => firstLogoAt !== null && c.t >= firstLogoAt);
  const gaps = rotation.slice(1).map((c, i) => c.t - rotation[i].t);
  const shortestGap = gaps.length ? Math.min(...gaps) : null;
  console.log(`rotation gaps (ms): ${gaps.join(', ') || 'none'}`);

  const results = [
    [`rotation is readable: <= ${MAX_FRAME_CHANGES} box repaints in ${RUN_MS / 1000}s`, changes.length <= MAX_FRAME_CHANGES],
    ['boot waited for telemetry: no "telemetry unavailable" against a live stub', sawTelemetryUnavailable === null],
    ['sanity: the logo was reached at all', sawLogo],
    ['#289: a game deployment shows its art as a still poster', sawPoster],
    [`#289: every rotation frame holds >= ${ROTATE_HOLD_MS - HOLD_TOLERANCE_MS}ms (one change per hold)`,
      gaps.length >= 2 && shortestGap >= ROTATE_HOLD_MS - HOLD_TOLERANCE_MS]
  ];

  console.log(`\nbox repaints: ${changes.length} in ${RUN_MS / 1000}s (${perSecond}/s)`);
  if (sawTelemetryUnavailable !== null) {
    console.log(`"telemetry unavailable" first seen at ${sawTelemetryUnavailable}ms — BOOT_TIMEOUT_MS was clamped`);
  }
  if (changes.length > MAX_FRAME_CHANGES) {
    console.log('\nfirst 10 repaints:');
    for (const c of changes.slice(0, 10)) console.log(`  ${String(c.t).padStart(6)}ms | ${c.sig.slice(0, 70)}`);
  }

  console.log('');
  let failed = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log('');
  process.exit(failed ? 1 : 0);
};

run().catch(e => {
  console.error(e);
  process.exit(2);
});

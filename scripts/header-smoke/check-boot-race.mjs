/* Boot-race regression harness for the terminal header (issue #192).
 *
 * The bug: TerminalHeaderAnimation's 8s BOOT_TIMEOUT_MS path starts finishing the boot
 * without changing `state`, and `state` only becomes 'ready' ~2.1s later (the finishBoot
 * delay + the reveal + BOOT_READY_DELAY_MS). waitForData()'s only guard is
 * `state !== 'booting'`, so an /api/header response landing inside that window ran the
 * WHOLE boot sequence a second time: two finishBoot() calls, two startIdleRotation()
 * chains, and two concurrent requestAnimationFrame reveals fighting over frameLines every
 * frame. On screen that is the reported "FLUX logo flashing rapidly".
 *
 * This harness drives the real component against the stub with HEADER_DELAY_MS set so the
 * first /api/header lands inside that window, and asserts two things that are true only
 * when the boot runs exactly once:
 *
 *   1. Boot text never reappears once the logo has been shown. The second boot's
 *      animateBlockCounter writes "loading blocks ..." rows back into the box after the
 *      first boot already wiped to the logo -- the crispest signature of a double boot.
 *   2. Every completed rotation dwell lasts at least MIN_SLOT_DWELL_MS. Two rotation
 *      chains advance independently, so one wipes a frame away seconds before its own
 *      ROTATE_HOLD_MS is up.
 *
 * Usage (same shape as check-header.mjs):
 *   1. npm install --no-save puppeteer-core
 *   2. HEADER_DELAY_MS=8500 node scripts/header-smoke/stub-api.mjs   (terminal 1)
 *   3. API_PORT=3100 npm run dev -- --port 5199                       (terminal 2)
 *   4. node scripts/header-smoke/check-boot-race.mjs                  (terminal 3)
 *
 * The stub must be restarted between runs -- HEADER_DELAY_MS only delays its FIRST
 * /api/header call, which is the one the boot sequence races against.
 *
 * Env overrides: BASE_URL, STUB_URL, BROWSER_PATH, SAMPLE_MS, RUN_MS.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199';
const STUB_URL = process.env.STUB_URL || 'http://127.0.0.1:3100/api/carousel/deployed';
const SAMPLE_MS = Number(process.env.SAMPLE_MS || 60);
// Long enough for the delayed boot (~13s) plus two full rotation cycles (~28s each), so
// at least two dwells complete and can be measured.
const RUN_MS = Number(process.env.RUN_MS || 70000);

// ROTATE_HOLD_MS is 8000 and the deployed slot is longer still (its intro art plays
// first). 5000 leaves room for sampling jitter and a slow dev-server frame while staying
// far below any legitimate dwell.
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

/**
 * Which rotation slot a sampled frame belongs to, from the row style classes the
 * component stamps on every row. A frame mid-wipe carries rows of both the outgoing and
 * incoming slot; those are 'mixed' and act as run boundaries rather than dwell time.
 *
 * The deployed slot's intro art is all row-deployed rows and its detail frame has
 * row-deployed bookends, so art + wipe + detail read as one continuous 'deployed' dwell —
 * which is what they are.
 */
function classify(rows) {
  const hasLogo = rows.some(r => r.cls.includes('row-logo'));
  const hasDeployed = rows.some(r => r.cls.includes('row-deployed'));
  const hasExpiring = rows.some(r => r.cls.includes('row-expiring'));

  if (hasLogo && !hasDeployed && !hasExpiring) {
    return rows.every(r => r.cls.includes('row-logo')) ? 'logo' : 'mixed';
  }
  if (hasLogo) return 'mixed';
  if (hasDeployed) return 'deployed';
  if (hasExpiring) return 'expiring';
  return 'text';
}

const isBootText = rows =>
  rows.some(r => /loading blocks|connecting to flux network|start_flux_tracker|telemetry unavailable/i.test(r.text));

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

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  let firstLogoAt = null;
  const bootTextAfterLogo = [];   // { t, text } — assertion 1's evidence
  const runs = [];                // { slot, start, end } — assertion 2's evidence
  let current = null;

  while (Date.now() - t0 < RUN_MS) {
    const rows = await page.evaluate(() => {
      const box = document.querySelector('.terminal-box');
      if (!box) return null;
      return [...box.querySelectorAll('span')].map(sp => ({
        cls: sp.className,
        text: sp.textContent.replace(/\n/g, '')
      }));
    });

    if (rows && rows.length) {
      const t = Date.now() - t0;
      const slot = classify(rows);

      if (slot === 'logo' && firstLogoAt === null) firstLogoAt = t;
      if (firstLogoAt !== null && t > firstLogoAt && isBootText(rows)) {
        bootTextAfterLogo.push({ t, text: rows.map(r => r.text).find(x => x.trim()) || '' });
      }

      if (slot === 'mixed') {
        current = null;
      } else if (!current || current.slot !== slot) {
        current = { slot, start: t, end: t };
        runs.push(current);
      } else {
        current.end = t;
      }
    }

    await new Promise(r => setTimeout(r, SAMPLE_MS));
  }

  await browser.close();

  // Only rotation dwells are measured: boot text ('text') is not a rotation slot, and the
  // last run is truncated by the end of sampling rather than by the rotation.
  const rotationRuns = runs.filter(r => r.slot !== 'text');
  const completed = rotationRuns.slice(0, -1);
  const shortDwells = completed.filter(r => r.end - r.start < MIN_SLOT_DWELL_MS);

  const results = [
    ['boot ran once: no boot text after the logo appeared', bootTextAfterLogo.length === 0],
    ['rotation runs one chain: every completed dwell >= 5s', shortDwells.length === 0],
    ['sanity: the logo was reached at all', firstLogoAt !== null],
    ['sanity: at least two rotation dwells completed', completed.length >= 2]
  ];

  console.log(`\nboot reached the logo at ${firstLogoAt ?? 'never'}ms\n`);
  console.log('rotation dwells (slot, start, duration):');
  for (const r of rotationRuns) {
    const dur = r.end - r.start;
    const flag = r === rotationRuns.at(-1) ? '(truncated by end of run)' : dur < MIN_SLOT_DWELL_MS ? '<-- SHORT' : '';
    console.log(`  ${r.slot.padEnd(9)} @${String(r.start).padStart(6)}ms  ${String(dur).padStart(6)}ms ${flag}`);
  }

  if (bootTextAfterLogo.length) {
    console.log(`\nboot text reappeared after the logo (${bootTextAfterLogo.length} samples), first few:`);
    for (const b of bootTextAfterLogo.slice(0, 5)) console.log(`  ${String(b.t).padStart(6)}ms | ${b.text.slice(0, 60)}`);
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

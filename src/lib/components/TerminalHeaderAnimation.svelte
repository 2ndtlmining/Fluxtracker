<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    LOGO_LINES,
    BOOT_LINE_COUNT,
    ROW_KIND_TEXT,
    ROW_KIND_LOGO,
    pickBootStartBlock,
    computeAnimatedBlock,
    formatStatusLine,
    formatSnapshotLine,
    formatSummaryLine,
    padLines,
    composeRevealFrame,
    composeRevealKinds,
    formatDeploymentFrame,
    formatExpiringFrame,
    formatDeploymentReducedMotionLines,
    formatExpiringReducedMotionLines,
    deploymentFrameKinds,
    expiringFrameKinds
  } from '$lib/utils/terminalAnimation.js';

  export let blockHeight = null;
  export let totalNodes = 0;
  export let totalApps = 0;
  export let snapshotCount = 0;
  export let appVersion = '...';
  export let arcaneOsCodename = '';
  export let apiStatus = 'checking';
  export let dbStatus = 'checking';
  export let dataReady = false;
  export let latestDeployedApp = null;   // most recent /api/carousel/deployed entry, or null
  export let latestExpiringApp = null;   // soonest /api/carousel/expiring entry, or null

  // Boot pacing. Everything the boot sequence schedules is multiplied by
  // BOOT_SLOWDOWN, so the whole read takes about twice as long as it used to
  // (~2.3s -> ~4.6s) and the number is tunable in exactly one place.
  const BOOT_SLOWDOWN = 2;
  const BOOT_TIMEOUT_MS = 4000 * BOOT_SLOWDOWN; // must exceed the slowest boot path
  const COUNTER_DURATION_MS = 1100 * BOOT_SLOWDOWN;

  // Row-reveal duration shared by every wipe — the boot's text -> logo reveal and
  // every idle-rotation transition — so the ASCII logo always repaints at the same
  // pace, top-down, no matter when you catch it.
  const REVEAL_MS = 400;
  const BOOT_SETTLE_MS = 350 * BOOT_SLOWDOWN; // glow settle after the reveal
  const BOOT_READY_DELAY_MS = 450 * BOOT_SLOWDOWN;

  // Idle rotation (replaces the old block-sync animation and the one-off "new
  // deployment" flash): once boot finishes, the box cycles Logo -> Latest Expiring ->
  // Latest Deployed -> Logo -> ... forever, skipping any slot with no data yet. Each
  // slot's content is read live from props at the moment its wipe starts, so a poll
  // update always shows up by the slot's next turn rather than needing a restart.
  const ROTATE_SLOWDOWN = 2;
  const ROTATE_TRANSITION_MS = REVEAL_MS;
  const ROTATE_HOLD_MS = 4000 * ROTATE_SLOWDOWN; // readable hold, matches the old deploy-flash hold

  let state = 'booting'; // 'booting' | 'ready'
  // The single fixed box: every phase of the header (boot text, logo, rotation
  // frames) is rendered here, always exactly LOGO_LINES.length rows, so the
  // header keeps one constant size from first paint onwards.
  let frameLines = padLines([], BOOT_LINE_COUNT);
  let frameKinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  let bootTextLines = [];
  let logoSettled = false;
  let reducedMotion = false;
  let rotationIndex = 0; // index into idleSlots() of the slot currently on screen
  let currentAriaLabel = 'Flux network status';

  let timeouts = [];
  let rafId = null;
  let bootTimeoutId = null;

  function schedule(fn, delay) {
    const id = setTimeout(fn, reducedMotion ? Math.min(delay, 30) : delay);
    timeouts.push(id);
    return id;
  }

  function textKinds() {
    return Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  }

  function logoKinds() {
    return Array(BOOT_LINE_COUNT).fill(ROW_KIND_LOGO);
  }

  function pushLine(text) {
    bootTextLines = [...bootTextLines, text];
    frameLines = padLines(bootTextLines, BOOT_LINE_COUNT);
    frameKinds = textKinds();
  }

  function replaceLastLine(text) {
    bootTextLines = [...bootTextLines.slice(0, -1), text];
    frameLines = padLines(bootTextLines, BOOT_LINE_COUNT);
    frameKinds = textKinds();
  }

  function animateBlockCounter(startBlock, targetBlock, onDone) {
    if (reducedMotion || startBlock === null || targetBlock === null || targetBlock <= startBlock) {
      pushLine(`loading blocks ${targetBlock ?? '...'} / ${targetBlock ?? '...'} ... OK`);
      onDone();
      return;
    }

    pushLine(`loading blocks ${startBlock} / ${targetBlock}`);
    const start = performance.now();

    function frame(now) {
      const progress = (now - start) / COUNTER_DURATION_MS;
      const value = computeAnimatedBlock(startBlock, targetBlock, progress);
      replaceLastLine(`loading blocks ${value} / ${targetBlock}`);

      if (progress >= 1) {
        replaceLastLine(`loading blocks ${targetBlock} / ${targetBlock} ... OK`);
        onDone();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  function startBoot() {
    state = 'booting';
    bootTextLines = [];
    frameLines = padLines([], BOOT_LINE_COUNT);
    frameKinds = textKinds();
    logoSettled = false;

    pushLine('> ./start_flux_tracker');

    bootTimeoutId = schedule(() => {
      if (state === 'booting') {
        replaceLastLine('> connecting to flux network... ERROR');
        pushLine('> telemetry unavailable');
        schedule(() => finishBoot(), 400 * BOOT_SLOWDOWN);
      }
    }, BOOT_TIMEOUT_MS);

    schedule(() => pushLine('> connecting to flux network...'), 300 * BOOT_SLOWDOWN);

    schedule(() => waitForData(), 650 * BOOT_SLOWDOWN);
  }

  function waitForData() {
    if (state !== 'booting') return;
    if (!dataReady) {
      schedule(waitForData, 100 * BOOT_SLOWDOWN);
      return;
    }
    if (bootTimeoutId) clearTimeout(bootTimeoutId);

    replaceLastLine(`> connecting to flux network... ${apiStatus === 'offline' ? 'ERROR' : 'OK'}`);
    if (apiStatus === 'offline') {
      pushLine('> telemetry unavailable');
      schedule(() => finishBoot(), 400 * BOOT_SLOWDOWN);
      return;
    }

    pushLine(formatStatusLine(apiStatus, dbStatus));
    // Real tracker data — the snapshot line is only written once the header
    // fetch has landed, so the number is live, never a placeholder.
    schedule(() => pushLine(formatSnapshotLine(snapshotCount)), 150 * BOOT_SLOWDOWN);

    const target = blockHeight;
    const startBlock = pickBootStartBlock(target);
    schedule(() => animateBlockCounter(startBlock, target, () => {
      pushLine(formatSummaryLine(appVersion, arcaneOsCodename, totalNodes, totalApps));
      schedule(() => finishBoot(), 550 * BOOT_SLOWDOWN);
    }), 300 * BOOT_SLOWDOWN);
  }

  function finishBoot() {
    const baseLines = padLines(bootTextLines, BOOT_LINE_COUNT);

    if (reducedMotion) {
      frameLines = LOGO_LINES;
      frameKinds = logoKinds();
      logoSettled = true;
      schedule(() => {
        state = 'ready';
        startIdleRotation();
      }, 30);
      return;
    }

    runReveal(baseLines, textKinds(), LOGO_LINES, logoKinds(), 'top-down', REVEAL_MS, () => {
      frameLines = LOGO_LINES;
      frameKinds = logoKinds();
      schedule(() => { logoSettled = true; }, BOOT_SETTLE_MS);
      schedule(() => {
        state = 'ready';
        startIdleRotation();
      }, BOOT_READY_DELAY_MS);
    });
  }

  /** Animate the box from one frame to another, revealing row-by-row (with matching style kinds). */
  function runReveal(baseLines, baseKinds, incomingLines, incomingKinds, direction, duration, onDone) {
    const start = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const revealedCount = Math.round(progress * baseLines.length);
      frameLines = composeRevealFrame(baseLines, incomingLines, revealedCount, direction);
      frameKinds = composeRevealKinds(baseKinds, incomingKinds, revealedCount, direction);
      if (progress >= 1) {
        onDone();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  /**
   * The rotation's slot list, recomputed live on every advance so a poll update that
   * lands mid-cycle is picked up by that slot's next turn rather than requiring a
   * restart. The logo is always slot 0; "expiring"/"deployed" are included only when
   * there's real data for them, so an app-less start (or a fetch error) just holds
   * the logo instead of rotating into an empty frame.
   */
  function idleSlots() {
    const slots = [{ kind: 'logo' }];
    if (latestExpiringApp) slots.push({ kind: 'expiring', data: latestExpiringApp });
    if (latestDeployedApp) slots.push({ kind: 'deployed', data: latestDeployedApp });
    return slots;
  }

  function framesForSlot(slot) {
    if (slot.kind === 'logo') {
      return { lines: LOGO_LINES, kinds: logoKinds(), ariaLabel: 'Flux network status' };
    }
    if (slot.kind === 'expiring') {
      // Reduced motion stays plain text (essentials only, per its existing design
      // intent) -- the orange accent is an animation-adjacent flourish, not information.
      const lines = reducedMotion ? formatExpiringReducedMotionLines(slot.data) : formatExpiringFrame(slot.data);
      const kinds = reducedMotion ? textKinds() : expiringFrameKinds();
      return { lines, kinds, ariaLabel: `Expiring soon: ${slot.data.name}` };
    }
    const lines = reducedMotion ? formatDeploymentReducedMotionLines(slot.data) : formatDeploymentFrame(slot.data);
    const kinds = reducedMotion ? textKinds() : deploymentFrameKinds();
    return { lines, kinds, ariaLabel: `Latest deployment: ${slot.data.name}` };
  }

  function startIdleRotation() {
    rotationIndex = 0;
    frameLines = LOGO_LINES;
    frameKinds = logoKinds();
    currentAriaLabel = 'Flux network status';
    scheduleNextRotationStep();
  }

  function scheduleNextRotationStep() {
    schedule(() => advanceRotation(), ROTATE_HOLD_MS);
  }

  function advanceRotation() {
    const slots = idleSlots();
    if (slots.length <= 1) {
      // Nothing to rotate to yet (no expiring/deployed data) — hold the logo and
      // check again next interval rather than wiping it into itself.
      scheduleNextRotationStep();
      return;
    }

    rotationIndex = (rotationIndex + 1) % slots.length;
    const next = framesForSlot(slots[rotationIndex]);

    if (reducedMotion) {
      frameLines = next.lines;
      frameKinds = next.kinds;
      currentAriaLabel = next.ariaLabel;
      scheduleNextRotationStep();
      return;
    }

    const fromLines = frameLines;
    const fromKinds = frameKinds;
    runReveal(fromLines, fromKinds, next.lines, next.kinds, 'top-down', ROTATE_TRANSITION_MS, () => {
      frameLines = next.lines;
      frameKinds = next.kinds;
      currentAriaLabel = next.ariaLabel;
      scheduleNextRotationStep();
    });
  }

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    startBoot();
  });

  onDestroy(() => {
    timeouts.forEach(clearTimeout);
    if (bootTimeoutId) clearTimeout(bootTimeoutId);
    if (rafId) cancelAnimationFrame(rafId);
  });
</script>

<pre
  class="terminal-box"
  class:settled={logoSettled}
  style="--box-rows: {BOOT_LINE_COUNT};"
  aria-label={currentAriaLabel}
>{#each frameLines as line, i}<span class="row-{frameKinds[i]}">{line + '\n'}</span>{/each}</pre>

<style>
  /* The fixed box: always --box-rows rows of --box-row height, whatever it is
     showing (boot text, logo or a rotation frame), so the header keeps one
     constant size from first paint through every refresh.
     overflow: clip (not hidden) keeps the logo's glow from being chopped into
     a hard-edged block at the box bounds: the clip sits overflow-clip-margin
     (32px — just past the widest --glow-cyan blur) outside the box, so the
     glow fades naturally like it did before the box was introduced, while a
     too-long boot/rotation line on a narrow screen still can't run away. */
  .terminal-box {
    margin: 0;
    font-family: inherit;
    font-size: 0.7rem;
    line-height: var(--box-row, 0.95rem);
    height: calc(var(--box-rows, 6) * var(--box-row, 0.95rem));
    overflow: clip;
    overflow-clip-margin: 32px;
    white-space: pre;
  }

  /* Terminal text rows — same font and colour the boot output has always used. */
  .row-text {
    font-size: 0.7rem;
    color: var(--text-dim);
  }

  /* Logo rows — the bright persistent identity. Line-height comes from the box,
     so logo rows and text rows always align row for row. */
  .row-logo {
    font-size: clamp(0.4rem, 1.4vw, 0.95rem);
    color: var(--text-primary);
    text-shadow: 0 0 8px #00ffff99;
    transition: text-shadow 0.4s ease-out;
  }

  .terminal-box.settled .row-logo {
    text-shadow: var(--glow-cyan);
  }

  /* Idle-rotation icon bookend rows (item 4 of the decentralization follow-ups) --
     orange for an expiring app, green for a new deployment, same glow treatment as
     .row-logo above so they read as accented, not just a different color of plain
     text. --accent-orange isn't defined in app.css root, so fall back the same way
     CarouselCard.svelte already does. */
  .row-expiring {
    font-size: 0.7rem;
    color: var(--accent-orange, #f97316);
    text-shadow: 0 0 8px rgba(249, 115, 22, 0.6);
  }

  .row-deployed {
    font-size: 0.7rem;
    color: var(--accent-green);
    text-shadow: 0 0 8px rgba(0, 255, 65, 0.6);
  }

  @media (max-width: 480px) {
    .terminal-box {
      --box-row: 0.8rem;
    }

    .row-text {
      font-size: 0.6rem;
    }

    .row-logo {
      font-size: clamp(0.32rem, 2.4vw, 0.6rem);
    }

    .row-expiring,
    .row-deployed {
      font-size: 0.6rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row-logo {
      transition: none;
    }
  }
</style>

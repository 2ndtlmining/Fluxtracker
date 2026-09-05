<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import {
    LOGO_LINES,
    LOGO_WIDTH,
    BOOT_LINE_COUNT,
    ROW_KIND_TEXT,
    ROW_KIND_LOGO,
    pickBootStartBlock,
    computeAnimatedBlock,
    mergeSyncTarget,
    formatStatusLine,
    formatSnapshotLine,
    formatSummaryLine,
    buildSyncPatternLines,
    pickPatternChars,
    padLines,
    composeRevealFrame,
    composeRevealKinds,
    formatSyncBlocksLine,
    formatTransactionsLine
  } from '$lib/utils/terminalAnimation.js';

  export let blockHeight = null;
  export let totalNodes = 0;
  export let totalApps = 0;
  export let snapshotCount = 0;
  export let transactionCount = 0;
  export let appVersion = '...';
  export let arcaneOsCodename = '';
  export let apiStatus = 'checking';
  export let dbStatus = 'checking';
  export let dataReady = false;
  export let syncRequest = null;

  const dispatch = createEventDispatcher();

  // Boot pacing. Everything the boot sequence schedules is multiplied by
  // BOOT_SLOWDOWN, so the whole read takes about twice as long as it used to
  // (~2.3s -> ~4.6s) and the number is tunable in exactly one place.
  const BOOT_SLOWDOWN = 2;
  const BOOT_TIMEOUT_MS = 4000 * BOOT_SLOWDOWN; // must exceed the slowest boot path
  const COUNTER_DURATION_MS = 1100 * BOOT_SLOWDOWN;

  // Boot text -> logo transition: the logo wipes over the boot text row by row,
  // top-down, inside the same fixed box.
  const BOOT_REVEAL_MS = 400;
  const BOOT_SETTLE_MS = 350 * BOOT_SLOWDOWN; // glow settle after the reveal
  const BOOT_READY_DELAY_MS = 450 * BOOT_SLOWDOWN;

  // Sync transition phases — logo -> pattern -> text -> logo, all in the logo's fixed box.
  // SYNC_SLOWDOWN stretches the whole sequence so the text is readable. Inside the text
  // phase the blocks counter counts up (HOLD2) and the transactions-loaded line lands
  // below it (HOLD3), mirroring how the boot text builds line by line.
  const SYNC_SLOWDOWN = 2;
  const SYNC_PHASE1_MS = 300 * SYNC_SLOWDOWN; // logo -> sync pattern, reveals bottom-up
  const SYNC_HOLD1_MS = 150 * SYNC_SLOWDOWN;  // pause on the full sync pattern
  const SYNC_PHASE2_MS = 300 * SYNC_SLOWDOWN; // pattern -> text, reveals top-down
  const SYNC_HOLD2_MS = 450 * SYNC_SLOWDOWN;  // blocks counter counts up inside the text frame
  const SYNC_HOLD3_MS = 150 * SYNC_SLOWDOWN;  // pause on the transactions-loaded payoff line
  const SYNC_PHASE3_MS = 300 * SYNC_SLOWDOWN; // text -> logo, reveals top-down

  let state = 'booting'; // 'booting' | 'ready' | 'syncing'
  // The single fixed box: every phase of the header (boot text, logo, sync
  // frames) is rendered here, always exactly LOGO_LINES.length rows, so the
  // header keeps one constant size from first paint onwards.
  let frameLines = padLines([], BOOT_LINE_COUNT);
  let frameKinds = Array(BOOT_LINE_COUNT).fill(ROW_KIND_TEXT);
  let bootTextLines = [];
  let logoSettled = false;
  let reducedMotion = false;

  let lastHandledSyncId = null;
  let activeSyncEnd = null;

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
        dispatch('bootComplete');
      }, 30);
      return;
    }

    runReveal(baseLines, textKinds(), LOGO_LINES, logoKinds(), 'top-down', BOOT_REVEAL_MS, () => {
      frameLines = LOGO_LINES;
      frameKinds = logoKinds();
      schedule(() => { logoSettled = true; }, BOOT_SETTLE_MS);
      schedule(() => {
        state = 'ready';
        dispatch('bootComplete');
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

  /** Replace a single row of the current frame without touching the others. */
  function setFrameLine(index, text) {
    frameLines = frameLines.map((line, i) => (i === index ? text : line));
  }

  /**
   * Boot-style count-up inside the text frame's top row: X climbs from the
   * previous block height to the freshly polled one and lands with `... OK`.
   * `activeSyncEnd` is read live so a sync that arrives mid-count extends the
   * target without restarting.
   */
  function animateSyncCounter(fromBlock, onDone) {
    const start = performance.now();

    function frame(now) {
      const target = typeof activeSyncEnd === 'number' ? activeSyncEnd : fromBlock;
      const done = () => {
        setFrameLine(0, `${formatSyncBlocksLine(target, target)} ... OK`);
        onDone();
      };
      if (reducedMotion || fromBlock === null || target === null || target <= fromBlock) {
        done();
        return;
      }
      const progress = Math.min(1, (now - start) / SYNC_HOLD2_MS);
      const value = computeAnimatedBlock(fromBlock, target, progress);
      setFrameLine(0, formatSyncBlocksLine(value, target));
      if (progress >= 1) {
        done();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  /**
   * Sync animation: the whole thing plays out inside the logo's own fixed box (same row
   * count throughout) so it never pushes the header around. Logo wipes into a sync-pattern
   * texture from the bottom up, the pattern gives way to the live status text from the top
   * down, then the logo repaints from the top down. Like the boot text, the status text
   * builds as it reads: the blocks counter counts up first, then the real transaction
   * total lands below it, and `sync complete` closes it out. Both use the same style as
   * the boot text, so all reads share one voice. The pattern is woven from a fresh random
   * character pair on every sync.
   */
  function startSync(fromBlock, toBlock) {
    state = 'syncing';
    activeSyncEnd = toBlock;

    const patternLines = buildSyncPatternLines(BOOT_LINE_COUNT, LOGO_WIDTH, pickPatternChars());
    // Revealed while the counter is still counting: the transactions row stays
    // empty until its number lands in HOLD3.
    const buildTextLines = () =>
      padLines([formatSyncBlocksLine(fromBlock, activeSyncEnd), 'loading transactions...', '', 'sync complete'], BOOT_LINE_COUNT);

    if (reducedMotion) {
      frameLines = padLines(
        [
          `${formatSyncBlocksLine(activeSyncEnd, activeSyncEnd)} ... OK`,
          'loading transactions...',
          formatTransactionsLine(transactionCount),
          'sync complete'
        ],
        BOOT_LINE_COUNT
      );
      frameKinds = textKinds();
      schedule(() => {
        frameLines = LOGO_LINES;
        frameKinds = logoKinds();
        state = 'ready';
        activeSyncEnd = null;
      }, 30);
      return;
    }

    runReveal(LOGO_LINES, logoKinds(), patternLines, textKinds(), 'bottom-up', SYNC_PHASE1_MS, () => {
      frameLines = patternLines;
      frameKinds = textKinds();
      schedule(() => {
        const textLines = buildTextLines();
        runReveal(patternLines, textKinds(), textLines, textKinds(), 'top-down', SYNC_PHASE2_MS, () => {
          frameLines = textLines;
          frameKinds = textKinds();
          animateSyncCounter(fromBlock, () => {
            setFrameLine(2, formatTransactionsLine(transactionCount));
            schedule(() => {
              runReveal(frameLines, textKinds(), LOGO_LINES, logoKinds(), 'top-down', SYNC_PHASE3_MS, () => {
                frameLines = LOGO_LINES;
                frameKinds = logoKinds();
                state = 'ready';
                activeSyncEnd = null;
              });
            }, SYNC_HOLD3_MS);
          });
        });
      }, SYNC_HOLD1_MS);
    });
  }

  $: if (syncRequest && syncRequest.id !== lastHandledSyncId) {
    lastHandledSyncId = syncRequest.id;
    if (state === 'syncing') {
      activeSyncEnd = mergeSyncTarget(activeSyncEnd, syncRequest.to);
    } else if (state === 'ready') {
      startSync(syncRequest.from, syncRequest.to);
    }
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
>{#each frameLines as line, i}<span class="row-{frameKinds[i]}">{line + '\n'}</span>{/each}</pre>

<style>
  /* The fixed box: always --box-rows rows of --box-row height, whatever it is
     showing (boot text, logo, sync pattern or sync text), so the header keeps
     one constant size from first paint through every refresh.
     overflow: clip (not hidden) keeps the logo's glow from being chopped into
     a hard-edged block at the box bounds: the clip sits overflow-clip-margin
     (32px — just past the widest --glow-cyan blur) outside the box, so the
     glow fades naturally like it did before the box was introduced, while a
     too-long boot/sync line on a narrow screen still can't run away. */
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

  /* Logo (and sync-pattern) rows — the bright persistent identity. Line-height
     comes from the box, so logo rows and text rows always align row for row. */
  .row-logo {
    font-size: clamp(0.4rem, 1.4vw, 0.95rem);
    color: var(--text-primary);
    text-shadow: 0 0 8px #00ffff99;
    transition: text-shadow 0.4s ease-out;
  }

  .terminal-box.settled .row-logo {
    text-shadow: var(--glow-cyan);
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
  }

  @media (prefers-reduced-motion: reduce) {
    .row-logo {
      transition: none;
    }
  }
</style>

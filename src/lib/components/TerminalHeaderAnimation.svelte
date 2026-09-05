<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import {
    LOGO_LINES,
    LOGO_WIDTH,
    pickBootStartBlock,
    computeAnimatedBlock,
    mergeSyncTarget,
    formatNetworkLine,
    formatVersionLine,
    buildSyncBlockLines,
    buildSyncPatternLines,
    padLines,
    composeRevealFrame,
    SYNC_FILLER_LINES
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
  export let syncRequest = null;

  const dispatch = createEventDispatcher();

  const BOOT_TIMEOUT_MS = 4000;
  const COUNTER_DURATION_MS = 1100;

  // Sync transition phases — logo -> pattern -> text -> logo, all in the logo's fixed box.
  // Total is 1500ms, double the previous flat 750ms sync, so the change reads as alive
  // rather than flickering past before it can be noticed.
  const SYNC_PHASE1_MS = 300; // logo -> sync pattern, reveals bottom-up
  const SYNC_HOLD1_MS = 150;  // pause on the full sync pattern
  const SYNC_PHASE2_MS = 300; // pattern -> status text, reveals top-down
  const SYNC_HOLD2_MS = 450;  // pause on the full status text so it's actually readable
  const SYNC_PHASE3_MS = 300; // status text -> logo, reveals top-down

  let state = 'booting'; // 'booting' | 'ready' | 'syncing'
  let lines = [];
  let frameLines = LOGO_LINES; // fixed-box content shown once booted — the logo, or a sync frame
  let showLogo = false;
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

  function pushLine(text) {
    lines = [...lines, text];
  }

  function replaceLastLine(text) {
    lines = [...lines.slice(0, -1), text];
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
    lines = [];
    showLogo = false;
    logoSettled = false;

    pushLine('> ./start_flux_tracker');

    bootTimeoutId = schedule(() => {
      if (state === 'booting') {
        pushLine('> connecting to flux network... ERROR');
        pushLine('> telemetry unavailable');
        schedule(() => finishBoot(), 400);
      }
    }, BOOT_TIMEOUT_MS);

    schedule(() => pushLine('> initializing telemetry...'), 150);
    schedule(() => replaceLastLine('> initializing telemetry... OK'), 350);
    schedule(() => pushLine('> connecting to flux network...'), 450);

    schedule(() => waitForData(), 650);
  }

  function waitForData() {
    if (state !== 'booting') return;
    if (!dataReady) {
      schedule(waitForData, 100);
      return;
    }
    if (bootTimeoutId) clearTimeout(bootTimeoutId);

    replaceLastLine(`> connecting to flux network... ${apiStatus === 'offline' ? 'ERROR' : 'OK'}`);
    if (apiStatus === 'offline') {
      pushLine('> telemetry unavailable');
      schedule(() => finishBoot(), 400);
      return;
    }

    pushLine(`> api......................... ${apiStatus === 'online' ? 'OK' : 'ERROR'}`);
    pushLine(`> database.................... ${dbStatus === 'online' ? 'OK' : 'OFFLINE'}`);

    const target = blockHeight;
    const startBlock = pickBootStartBlock(target);
    animateBlockCounter(startBlock, target, () => {
      pushLine(formatVersionLine(appVersion, arcaneOsCodename));
      schedule(() => pushLine(formatNetworkLine(totalNodes, totalApps)), 150);
      schedule(() => pushLine(`tracker ${snapshotCount} snapshots`), 280);
      schedule(() => pushLine('> telemetry ready'), 400);
      schedule(() => finishBoot(), 550);
    });
  }

  function finishBoot() {
    showLogo = true;
    frameLines = LOGO_LINES;
    schedule(() => { logoSettled = true; }, reducedMotion ? 0 : 350);
    schedule(() => {
      state = 'ready';
      dispatch('bootComplete');
    }, reducedMotion ? 30 : 450);
  }

  /** Animate `frameLines` from `baseLines` to `incomingLines`, revealing row-by-row over `duration`. */
  function runReveal(baseLines, incomingLines, direction, duration, onDone) {
    const start = performance.now();
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const revealedCount = Math.round(progress * baseLines.length);
      frameLines = composeRevealFrame(baseLines, incomingLines, revealedCount, direction);
      if (progress >= 1) {
        onDone();
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
  }

  /**
   * Sync animation: the whole thing plays out inside the logo's own fixed box (same row
   * count throughout) so it never pushes the header around. Logo wipes into a sync-pattern
   * texture from the bottom up, the pattern gives way to the real status text from the top
   * down, then the logo repaints from the top down. `activeSyncEnd` is read live when the
   * status text is built so a sync that arrives mid-animation is reflected without restarting.
   */
  function startSync(fromBlock, toBlock) {
    state = 'syncing';
    activeSyncEnd = toBlock;

    const patternLines = buildSyncPatternLines(LOGO_LINES.length, LOGO_WIDTH);
    const buildTextLines = () =>
      padLines([...buildSyncBlockLines(fromBlock, activeSyncEnd), 'sync complete'], LOGO_LINES.length, SYNC_FILLER_LINES);

    if (reducedMotion) {
      frameLines = buildTextLines();
      schedule(() => {
        frameLines = LOGO_LINES;
        state = 'ready';
        activeSyncEnd = null;
      }, 30);
      return;
    }

    runReveal(LOGO_LINES, patternLines, 'bottom-up', SYNC_PHASE1_MS, () => {
      frameLines = patternLines;
      schedule(() => {
        const textLines = buildTextLines();
        runReveal(patternLines, textLines, 'top-down', SYNC_PHASE2_MS, () => {
          frameLines = textLines;
          schedule(() => {
            runReveal(textLines, LOGO_LINES, 'top-down', SYNC_PHASE3_MS, () => {
              frameLines = LOGO_LINES;
              state = 'ready';
              activeSyncEnd = null;
            });
          }, SYNC_HOLD2_MS);
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

<div class="terminal-header">
  {#if state === 'booting'}
    <pre class="terminal-lines">{lines.join('\n')}</pre>
  {/if}

  {#if showLogo}
    <pre class="ascii-logo" class:settled={logoSettled}>{frameLines.join('\n')}</pre>
  {/if}
</div>

<style>
  .terminal-header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 2.2rem;
  }

  .terminal-lines {
    margin: 0;
    font-family: inherit;
    font-size: 0.7rem;
    line-height: 1.4;
    color: var(--text-dim);
    white-space: pre-wrap;
  }

  .ascii-logo {
    margin: 0;
    font-family: inherit;
    font-size: clamp(0.4rem, 1.4vw, 0.95rem);
    line-height: 1;
    white-space: pre;
    color: var(--text-primary);
    text-shadow: 0 0 8px #00ffff99;
    opacity: 0;
    transform: translateY(2px);
    transition: opacity 0.35s ease-out, transform 0.35s ease-out, text-shadow 0.4s ease-out;
  }

  .ascii-logo.settled {
    opacity: 1;
    transform: translateY(0);
    text-shadow: var(--glow-cyan);
  }

  @media (max-width: 480px) {
    .ascii-logo {
      font-size: clamp(0.32rem, 2.4vw, 0.6rem);
    }
    .terminal-lines {
      font-size: 0.6rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ascii-logo {
      transition: none;
    }
  }
</style>

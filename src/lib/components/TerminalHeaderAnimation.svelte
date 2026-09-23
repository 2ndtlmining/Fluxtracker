<script>
  import { onMount, onDestroy } from 'svelte';
  import { cssomStyle } from '$lib/actions/cssomStyle.js';
  import { resolveIntroKey, getApiUrl } from '$lib/config.js';
  import { focusApp } from '$lib/stores/appFocus.js';
  import {
    pickNextDeployed,
    rememberShown
  } from '$lib/utils/headerRotation.js';
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
    expiringFrameKinds,
    formatGamepadFrame,
    gamepadFrameKinds,
    GAMEPAD_FRAME_COUNT,
    formatValheimFrame,
    valheimFrameKinds,
    VALHEIM_FRAME_COUNT,
    formatDragonFrame,
    dragonFrameKinds,
    DRAGON_FRAME_COUNT,
    formatMinecraftFrame,
    formatPalworldFrame,
    palworldFrameKinds,
    PALWORLD_FRAME_COUNT,
    minecraftFrameKinds,
    MINECRAFT_FRAME_COUNT,
    markPaused,
    formatDeploymentFrameWide,
    formatExpiringFrameWide
  } from '$lib/utils/terminalAnimation.js';
  import {
    formatOrbitFrame, orbitFrameKinds, ORBIT_FRAME_COUNT,
    formatZomboidFrame, zomboidFrameKinds, ZOMBOID_FRAME_COUNT,
    formatFoldingFrame, foldingFrameKinds, FOLDING_FRAME_COUNT,
    formatCryptoFrame, cryptoFrameKinds, CRYPTO_FRAME_COUNT
  } from '$lib/utils/introArt.js';

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
  export let deployedApps = [];          // the whole 24h /api/carousel/deployed list (issue #283)
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

  // Intro frames (issues #177, #180): a game deployment plays a short animation before its
  // detail frame. ~2s total -- long enough to read as animation, short enough that the
  // information it precedes is not meaningfully delayed. One step duration for every intro,
  // so they all move at the same pace no matter which art is playing.
  const INTRO_STEP_MS = 250 * ROTATE_SLOWDOWN;

  // The shared controller (issue #177): every game that has no art of its own.
  const GAMEPAD_INTRO = {
    frameCount: GAMEPAD_FRAME_COUNT,
    format: formatGamepadFrame,
    kinds: gamepadFrameKinds
  };

  // Per-game art, keyed by what resolveGameFromAppName() returns (issue #180). Adding a
  // game is one entry here plus its formatter -- nothing else in this component changes.
  const GAME_INTROS = {
    Valheim: {
      frameCount: VALHEIM_FRAME_COUNT,
      format: formatValheimFrame,
      kinds: valheimFrameKinds
    },
    // One key covers Java and Bedrock: resolveGameFromAppName() returns 'Minecraft' for
    // all four of minecraftj / minecraftb / minecraftserver / minecraftbedrockserver.
    Minecraft: {
      frameCount: MINECRAFT_FRAME_COUNT,
      format: formatMinecraftFrame,
      kinds: minecraftFrameKinds
    },
    // The key is the exact string resolveGameFromAppName() returns (#162 named it for
    // Flux's games hub). 'Runescape' or 'RuneScape' silently falls through to the gamepad
    // with no error, so it is spelled out here in full rather than derived.
    // Second by live instances, and until now the only game in the top four without art of
    // its own. The key is what resolveGameFromAppName() returns for the 'palworld' app-name
    // prefix -- app names rather than repotags, because most Palworld deployments are
    // enterprise-encrypted and carry no readable image.
    Palworld: {
      frameCount: PALWORLD_FRAME_COUNT,
      format: formatPalworldFrame,
      kinds: palworldFrameKinds
    },
    'RuneScape: Dragonwilds': {
      frameCount: DRAGON_FRAME_COUNT,
      format: formatDragonFrame,
      kinds: dragonFrameKinds
    },
    // Issue #273: the most-deployed game without art of its own until now.
    'Project Zomboid': {
      frameCount: ZOMBOID_FRAME_COUNT,
      format: formatZomboidFrame,
      kinds: zomboidFrameKinds
    }
  };

  // Service art (issue #271) keyed by the `service:<key>` resolveIntroKey() returns. A service
  // without an entry gets no intro, exactly as before (#276-#279 add the rest).
  const SERVICE_INTROS = {
    orbit: { frameCount: ORBIT_FRAME_COUNT, format: formatOrbitFrame, kinds: orbitFrameKinds },       // #272
    folding: { frameCount: FOLDING_FRAME_COUNT, format: formatFoldingFrame, kinds: foldingFrameKinds }, // #274
    crypto: { frameCount: CRYPTO_FRAME_COUNT, format: formatCryptoFrame, kinds: cryptoFrameKinds }      // #275
  };

  // Apps the rotation has shown, oldest first -- pickNextDeployed() walks the whole day's
  // list with it instead of replaying the newest deployment (issue #283).
  let recentDeployed = [];

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
  // The slot on screen, set when it STARTS (intro included), so a click or the side panel
  // always refers to the app the art belongs to. Null until the rotation begins.
  let currentSlot = null;
  // The last slot that played an intro -- clicking the logo replays it (issue #282).
  let lastIntroSlot = null;
  // True once the current slot's detail frame is fully on screen (not mid-intro or wipe).
  let detailShown = false;
  // Desktop gets one wide detail frame with everything about the app (issue #345); narrower
  // screens keep the 34-column frame. Tracked live, so resizing across it switches over.
  const WIDE_QUERY = '(min-width: 1280px)';
  let wide = false;

  // Hover pause (issue #282). Only the move to the NEXT slot waits: an intro or a wipe that
  // is already running finishes, then the frame holds for as long as the pointer stays.
  let paused = false;
  let advanceHeld = false;
  const RESUME_GRACE_MS = 800; // leaving the box does not snap straight to the next slot

  // Rotation-chain generation. Every continuation of the rotation (the hold timer, each
  // intro step, the reduced-motion poster hold, each wipe's completion) captures it and
  // does nothing once it has moved on. A click restarts the chain by bumping it, so no
  // number of clicks can leave two chains -- and so two rAF loops -- running: that is
  // #192's double loop, which a click could otherwise recreate.
  let chainGen = 0;

  function restartChain() {
    chainGen += 1;
    advanceHeld = false;
    cancelRafLoop();
  }

  /** schedule()/pace() for the rotation chain: dropped if the chain was restarted. */
  function chainStep(fn, delay, { paced = false } = {}) {
    const gen = chainGen;
    const run = () => { if (gen === chainGen) fn(); };
    return paced ? pace(run, delay) : schedule(run, delay);
  }

  let timeouts = [];
  let bootTimeoutId = null;

  // One-shot latch over the whole boot (issue #192). Two paths can finish the boot --
  // data arriving and the BOOT_TIMEOUT_MS telemetry giveup -- and `state` cannot arbitrate
  // between them: it only flips to 'ready' at the END of the reveal, ~2.1s after a path
  // commits. An /api/header response landing in that window used to run the ENTIRE boot a
  // second time, leaving two startIdleRotation() chains and two requestAnimationFrame
  // loops fighting over frameLines every frame -- the reported flashing logo. Whichever
  // path claims the boot first wins; the other becomes a no-op.
  let bootClaimed = false;

  // Exactly one animation drives frameLines at a time. Both the boot's block counter and
  // every reveal run as requestAnimationFrame loops writing the same state, so a second
  // loop starting while one is live repaints a conflicting frame on alternating frames.
  // Starting a loop supersedes any loop already running: the older one sees a stale
  // generation on its next frame and stops instead of writing.
  let rafId = null;
  let rafGeneration = 0;

  /** Run `frame(now)` every animation frame until it returns false. */
  function startRafLoop(frame) {
    cancelRafLoop();
    const generation = ++rafGeneration;
    const step = now => {
      if (generation !== rafGeneration) return;
      rafId = frame(now) ? requestAnimationFrame(step) : null;
    };
    rafId = requestAnimationFrame(step);
  }

  function cancelRafLoop() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    rafGeneration += 1;
  }

  /** True for the first caller only — see bootClaimed above. */
  function claimBoot() {
    if (bootClaimed) return false;
    bootClaimed = true;
    return true;
  }

  /**
   * A real delay, honoured whatever the motion preference is. This is the default for
   * everything that is not animation pacing: a give-up timeout, a poll interval, and
   * above all the rotation's dwell, which is how long a frame stays READABLE.
   */
  function schedule(fn, delay) {
    const id = setTimeout(fn, delay);
    timeouts.push(id);
    return id;
  }

  /**
   * Animation pacing only -- the boot's cosmetic beat between lines. Reduced motion
   * fast-forwards these to ~nothing, which is the whole point of the preference.
   *
   * Issue #194: this clamp used to live in schedule() itself and so hit EVERY delay,
   * including ROTATE_HOLD_MS and BOOT_TIMEOUT_MS. A reduced-motion visitor got the
   * rotation advancing every 30ms -- a 33Hz strobe of the FLUX logo, which is the exact
   * opposite of what the preference asks for -- and a boot that gave up on telemetry
   * 30ms in, so it always read "> telemetry unavailable" with no real numbers. Brave
   * reports prefers-reduced-motion: reduce as fingerprinting protection regardless of
   * the OS setting, which is why this surfaced as "the logo flashes in Brave".
   */
  function pace(fn, delay) {
    return schedule(fn, reducedMotion ? Math.min(delay, 30) : delay);
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

    startRafLoop(now => {
      const progress = (now - start) / COUNTER_DURATION_MS;
      const value = computeAnimatedBlock(startBlock, targetBlock, progress);
      replaceLastLine(`loading blocks ${value} / ${targetBlock}`);

      if (progress >= 1) {
        replaceLastLine(`loading blocks ${targetBlock} / ${targetBlock} ... OK`);
        onDone();
        return false;
      }
      return true;
    });
  }

  function startBoot() {
    state = 'booting';
    bootTextLines = [];
    frameLines = padLines([], BOOT_LINE_COUNT);
    frameKinds = textKinds();
    logoSettled = false;

    pushLine('> ./start_flux_tracker');

    bootTimeoutId = schedule(() => {
      if (state === 'booting' && claimBoot()) {
        replaceLastLine('> connecting to flux network... ERROR');
        pushLine('> telemetry unavailable');
        pace(() => finishBoot(), 400 * BOOT_SLOWDOWN);
      }
    }, BOOT_TIMEOUT_MS);

    pace(() => pushLine('> connecting to flux network...'), 300 * BOOT_SLOWDOWN);

    pace(() => waitForData(), 650 * BOOT_SLOWDOWN);
  }

  function waitForData() {
    if (state !== 'booting' || bootClaimed) return;
    if (!dataReady) {
      schedule(waitForData, 100 * BOOT_SLOWDOWN);
      return;
    }
    // Claim before writing a single line: the timeout above may already have given up
    // on telemetry and be part-way through finishing the boot (issue #192).
    if (!claimBoot()) return;
    if (bootTimeoutId) clearTimeout(bootTimeoutId);

    replaceLastLine(`> connecting to flux network... ${apiStatus === 'offline' ? 'ERROR' : 'OK'}`);
    if (apiStatus === 'offline') {
      pushLine('> telemetry unavailable');
      pace(() => finishBoot(), 400 * BOOT_SLOWDOWN);
      return;
    }

    pushLine(formatStatusLine(apiStatus, dbStatus));
    // Real tracker data — the snapshot line is only written once the header
    // fetch has landed, so the number is live, never a placeholder.
    pace(() => pushLine(formatSnapshotLine(snapshotCount)), 150 * BOOT_SLOWDOWN);

    const target = blockHeight;
    const startBlock = pickBootStartBlock(target);
    pace(() => animateBlockCounter(startBlock, target, () => {
      pushLine(formatSummaryLine(appVersion, arcaneOsCodename, totalNodes, totalApps));
      pace(() => finishBoot(), 550 * BOOT_SLOWDOWN);
    }), 300 * BOOT_SLOWDOWN);
  }

  function finishBoot() {
    const baseLines = padLines(bootTextLines, BOOT_LINE_COUNT);

    if (reducedMotion) {
      frameLines = LOGO_LINES;
      frameKinds = logoKinds();
      logoSettled = true;
      pace(() => {
        state = 'ready';
        startIdleRotation();
      }, 30);
      return;
    }

    runReveal(baseLines, textKinds(), LOGO_LINES, logoKinds(), 'top-down', REVEAL_MS, () => {
      frameLines = LOGO_LINES;
      frameKinds = logoKinds();
      pace(() => { logoSettled = true; }, BOOT_SETTLE_MS);
      pace(() => {
        state = 'ready';
        startIdleRotation();
      }, BOOT_READY_DELAY_MS);
    });
  }

  /** Animate the box from one frame to another, revealing row-by-row (with matching style kinds). */
  function runReveal(baseLines, baseKinds, incomingLines, incomingKinds, direction, duration, onDone) {
    const start = performance.now();
    startRafLoop(now => {
      const progress = Math.min(1, (now - start) / duration);
      const revealedCount = Math.round(progress * baseLines.length);
      frameLines = composeRevealFrame(baseLines, incomingLines, revealedCount, direction);
      frameKinds = composeRevealKinds(baseKinds, incomingKinds, revealedCount, direction);
      if (progress >= 1) {
        onDone();
        return false;
      }
      return true;
    });
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
    if (deployedList().length > 0) slots.push({ kind: 'deployed' });
    return slots;
  }

  /** The deployed list to rotate through; falls back to the single latest app. */
  function deployedList() {
    if (Array.isArray(deployedApps) && deployedApps.length > 0) return deployedApps;
    return latestDeployedApp ? [latestDeployedApp] : [];
  }

  /**
   * Fill in the deployed slot at the moment it is entered: which app is up next, and its
   * place in the day. Chosen here rather than in idleSlots() so the shown-history only
   * advances when a deployment is actually put on screen.
   */
  function claimDeployedSlot(slot) {
    const choice = pickNextDeployed(deployedList(), recentDeployed, resolveIntroKey);
    if (!choice) return null;
    recentDeployed = rememberShown(recentDeployed, choice.app, resolveIntroKey(choice.app));
    return { ...slot, data: choice.app, rank: { position: choice.position, total: choice.total } };
  }

  /**
   * The intro animation for a slot, or null for slots that go straight to their detail
   * frame. Game detection uses the APP NAME path from issues #162/#163, not the image: most
   * game deployments come from Flux's dedicated sites, whose specs are enterprise-encrypted
   * and carry no repotag at all, so an image check would miss nearly all of them.
   *
   * A game with its own art gets it; every other game falls back to the controller.
   */
  function introForSlot(slot) {
    if (slot?.kind !== 'deployed') return null;
    // One resolver for games and services (issue #271): `game:<name>` or `service:<key>`.
    const key = resolveIntroKey(slot.data);
    if (!key) return null;
    if (key.startsWith('game:')) return GAME_INTROS[key.slice(5)] || GAMEPAD_INTRO;
    return SERVICE_INTROS[key.slice(8)] || null;
  }

  /**
   * Show a slot: its intro first when it has one, then its detail frame, then hold.
   * Reduced motion shows the intro's first frame as a still poster for one normal hold
   * instead of skipping the art (issue #289) -- the preference asks for no motion, not no
   * imagery. The hold goes through schedule(), never pace(), or it strobes (#194).
   */
  function presentSlot(slot) {
    currentSlot = slot;
    detailShown = false;
    const next = framesForSlot(slot);
    const intro = introForSlot(slot);
    if (intro) lastIntroSlot = slot;
    const ctx = { app: slot.data, blockHeight };

    if (reducedMotion) {
      currentAriaLabel = next.ariaLabel;
      if (intro) {
        frameLines = intro.format(0, ctx);
        frameKinds = intro.kinds();
        chainStep(() => {
          frameLines = next.lines;
          frameKinds = next.kinds;
          scheduleNextRotationStep();
        }, ROTATE_HOLD_MS);
        return;
      }
      frameLines = next.lines;
      frameKinds = next.kinds;
      scheduleNextRotationStep();
      return;
    }

    if (intro) {
      playIntroThen(intro, next, ctx);
      return;
    }

    const gen = chainGen;
    runReveal(frameLines, frameKinds, next.lines, next.kinds, 'top-down', ROTATE_TRANSITION_MS, () => {
      if (gen !== chainGen) return;
      frameLines = next.lines;
      frameKinds = next.kinds;
      currentAriaLabel = next.ariaLabel;
      detailShown = true;
      scheduleNextRotationStep();
    });
  }

  function framesForSlot(slot) {
    if (slot.kind === 'logo') {
      return { lines: LOGO_LINES, kinds: logoKinds(), ariaLabel: 'Flux network status' };
    }
    const extras = { introKey: resolveIntroKey(slot.data), payment: payments[slot.data?.name], nowMs: Date.now() };
    if (slot.kind === 'expiring') {
      // Reduced motion stays plain text (essentials only, per its existing design
      // intent) -- the orange accent is an animation-adjacent flourish, not information.
      const lines = reducedMotion
        ? formatExpiringReducedMotionLines(slot.data)
        : wide ? formatExpiringFrameWide(slot.data, extras) : formatExpiringFrame(slot.data);
      const kinds = reducedMotion ? textKinds() : expiringFrameKinds();
      return { lines, kinds, ariaLabel: `Expiring soon: ${slot.data.name}` };
    }
    const lines = reducedMotion
      ? formatDeploymentReducedMotionLines(slot.data)
      : wide ? formatDeploymentFrameWide(slot.data, slot.rank, extras) : formatDeploymentFrame(slot.data, slot.rank);
    const kinds = reducedMotion ? textKinds() : deploymentFrameKinds();
    return { lines, kinds, ariaLabel: `Latest deployment: ${slot.data.name}` };
  }

  function startIdleRotation() {
    rotationIndex = 0;
    currentSlot = { kind: 'logo' };
    frameLines = LOGO_LINES;
    frameKinds = logoKinds();
    currentAriaLabel = 'Flux network status';
    scheduleNextRotationStep();
  }

  function scheduleNextRotationStep() {
    chainStep(() => {
      if (paused) {
        advanceHeld = true; // resume() picks it up
        return;
      }
      advanceRotation();
    }, ROTATE_HOLD_MS);
  }

  /**
   * Move to the next slot. `appsOnly` skips the logo -- the side panel's "next up" asks for
   * the next APP, and landing on the logo instead would read as the click doing nothing.
   */
  function advanceRotation({ appsOnly = false } = {}) {
    const slots = idleSlots();
    if (slots.length <= 1) {
      // Nothing to rotate to yet (no expiring/deployed data) — hold the logo and
      // check again next interval rather than wiping it into itself.
      scheduleNextRotationStep();
      return;
    }

    rotationIndex = (rotationIndex + 1) % slots.length;
    if (appsOnly && slots[rotationIndex].kind === 'logo') rotationIndex = (rotationIndex + 1) % slots.length;
    let slot = slots[rotationIndex];
    if (slot.kind === 'deployed') {
      slot = claimDeployedSlot(slot);
      if (!slot) {
        scheduleNextRotationStep();
        return;
      }
    }
    presentSlot(slot);
  }

  // ---- Pointer interaction. Issue #282: hover pauses, click acts -- pointer only, no
  // keyboard focus on the box, by the owner's decision. Issue #284: an app frame's click
  // goes to that app's payments. ----

  function pause() {
    if (state !== 'ready') return;
    paused = true;
  }

  function resume() {
    paused = false;
    if (!advanceHeld) return;
    advanceHeld = false;
    chainStep(() => {
      if (paused) advanceHeld = true;
      else advanceRotation();
    }, RESUME_GRACE_MS);
  }

  /** The box: an app frame jumps to that app's payments; the logo replays the last intro. */
  function handleBoxClick() {
    if (state !== 'ready' || !currentSlot) return;
    if ((currentSlot.kind === 'deployed' || currentSlot.kind === 'expiring') && currentSlot.data?.name) {
      focusApp(currentSlot.data.name);
      return;
    }
    replayLastIntro();
  }

  function replayLastIntro() {
    restartChain();
    const slot = lastIntroSlot;
    if (!slot) {
      advanceRotation({ appsOnly: true });
      return;
    }
    // Put the rotation back on the slot being replayed, so it carries on from there.
    const index = idleSlots().findIndex(s => s.kind === slot.kind);
    if (index !== -1) rotationIndex = index;
    presentSlot(slot);
  }

  // Payments (issue #345). The wide frame shows what was paid for the app on screen: one
  // small search per app name, cached for PAYMENT_TTL_MS so the rotation's repeat visits cost
  // nothing, and fetched one slot ahead so the figure is usually there when the frame is.
  // Keyed by name, so a slow answer for an app that has left the screen only fills the cache.
  const PAYMENT_TTL_MS = 5 * 60 * 1000;
  let payments = {}; // name -> { status, amount?, usd?, date?, total?, at }

  async function loadPayment(name) {
    if (!name) return;
    const cached = payments[name];
    if (cached && (cached.status === 'loading' || Date.now() - cached.at < PAYMENT_TTL_MS)) return;
    payments = { ...payments, [name]: { status: 'loading', at: Date.now() } };
    let result;
    try {
      const params = new URLSearchParams({ page: '1', limit: '1', search: name });
      const response = await fetch(`${getApiUrl()}/api/transactions/paginated?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      // The search is a substring match; only an exact app-name row counts as its payment.
      const tx = body.transactions?.find(t => t.app_name === name);
      result = tx
        ? { status: 'ok', amount: tx.amount, usd: tx.amount_usd, date: tx.date, total: body.total }
        : { status: 'none' };
    } catch {
      result = { status: 'error' };
    }
    payments = { ...payments, [name]: { ...result, at: Date.now() } };
  }

  /** The app the rotation will show next -- pickNextDeployed() is pure, so this is the same
   *  app advanceRotation() will claim, as long as the data is unchanged. */
  function nextAppName() {
    const slots = idleSlots();
    for (let k = 1; k <= slots.length; k++) {
      const slot = slots[(rotationIndex + k) % slots.length];
      if (slot.kind === 'expiring' && slot.data) return slot.data.name;
      if (slot.kind === 'deployed') return pickNextDeployed(deployedList(), recentDeployed, resolveIntroKey)?.app?.name;
    }
    return null;
  }

  $: slotAppName = (currentSlot?.kind === 'deployed' || currentSlot?.kind === 'expiring') ? currentSlot.data?.name : null;
  $: if (slotAppName) {
    loadPayment(slotAppName);
    loadPayment(nextAppName());
  }

  // A payment that lands while its app's detail frame is on screen redraws that frame, so
  // "checking…" turns into the figure without waiting for the next visit.
  $: if (detailShown && wide && !reducedMotion && slotAppName && payments[slotAppName]) {
    frameLines = framesForSlot(currentSlot).lines;
  }

  $: displayLines = paused && state === 'ready' ? markPaused(frameLines) : frameLines;
  $: isAppSlot = currentSlot?.kind === 'deployed' || currentSlot?.kind === 'expiring';
  $: boxLabel = state !== 'ready'
    ? currentAriaLabel
    : `${currentAriaLabel}. ${isAppSlot ? 'Click to show its payments.' : 'Click to replay the last animation.'}`;

  /**
   * Step through an intro's frames, then wipe to the detail frame `next`.
   * Each step is a straight frame swap (no wipe) so the art reads as one continuous
   * animation; only the handover to the details uses the shared reveal.
   *
   * @param {{frameCount: number, format: (step: number, ctx?: object) => string[], kinds: () => string[]}} intro
   * @param {{app?: object, blockHeight?: number}} ctx real data an intro may draw on (issue
   *   #271) -- the existing art ignores it; intros that show a height or an instance count
   *   read it here rather than inventing a number
   */
  function playIntroThen(intro, next, ctx = {}) {
    let step = 0;
    const gen = chainGen;

    const showStep = () => {
      if (gen !== chainGen) return;
      frameLines = intro.format(step, ctx);
      frameKinds = intro.kinds();
      currentAriaLabel = next.ariaLabel;   // the details are the meaning; the art is not

      step += 1;
      if (step < intro.frameCount) {
        chainStep(showStep, INTRO_STEP_MS, { paced: true });
        return;
      }

      chainStep(() => {
        runReveal(frameLines, frameKinds, next.lines, next.kinds, 'top-down', ROTATE_TRANSITION_MS, () => {
          if (gen !== chainGen) return;
          frameLines = next.lines;
          frameKinds = next.kinds;
          currentAriaLabel = next.ariaLabel;
          detailShown = true;
          scheduleNextRotationStep();
        });
      }, INTRO_STEP_MS, { paced: true });
    };

    // Wipe INTO the art the same way every other rotation step arrives, so it does not pop
    // in differently from the frames around it.
    runReveal(frameLines, frameKinds, intro.format(0, ctx), intro.kinds(), 'top-down', ROTATE_TRANSITION_MS, showStep);
  }

  let wideQuery;
  const onWideChange = event => { wide = event.matches; };

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    wideQuery = window.matchMedia(WIDE_QUERY);
    wide = wideQuery.matches;
    wideQuery.addEventListener('change', onWideChange);
    startBoot();
  });

  onDestroy(() => {
    wideQuery?.removeEventListener('change', onWideChange);
    timeouts.forEach(clearTimeout);
    if (bootTimeoutId) clearTimeout(bootTimeoutId);
    cancelRafLoop();
  });
</script>

<!-- Hover pauses, click acts (issue #282). Pointer only, by the owner's decision: no tabindex
     or key handling on the box. -->
<div
  class="terminal-row"
  class:ready={state === 'ready'}
  role="group"
  aria-label="Network activity"
  on:pointerenter={pause}
  on:pointerleave={resume}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <pre
    class="terminal-box"
    class:settled={logoSettled}
    use:cssomStyle={{ '--box-rows': BOOT_LINE_COUNT }}
    aria-label={boxLabel}
    title={state === 'ready' ? boxLabel : undefined}
    on:click={handleBoxClick}
  >{#each displayLines as line, i}<span class="row-{frameKinds[i]}">{line + '\n'}</span>{/each}</pre>
</div>

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

  .terminal-row {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: var(--spacing-lg);
  }

  .terminal-row.ready .terminal-box {
    cursor: pointer;
  }

  /* Desktop reserves the wide frame's width (issue #345) so the header does not shift
     sideways each time the rotation moves between the logo and an app. */
  @media (min-width: 1280px) {
    .terminal-box {
      min-width: 80ch;
    }
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

  /* Service intro accents (issues #272, #274, #275). Games stay green; a service takes its
     own colour so its art never reads as a game deployment. */
  .row-purple {
    font-size: 0.7rem;
    color: var(--accent-purple);
    text-shadow: 0 0 8px rgba(189, 147, 249, 0.55);
  }

  .row-blue {
    font-size: 0.7rem;
    color: var(--accent-blue);
    text-shadow: 0 0 8px rgba(0, 217, 255, 0.55);
  }

  .row-gold {
    font-size: 0.7rem;
    color: var(--accent-yellow);
    text-shadow: 0 0 8px rgba(255, 235, 59, 0.5);
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
    .row-deployed,
    .row-purple,
    .row-blue,
    .row-gold {
      font-size: 0.6rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row-logo {
      transition: none;
    }
  }
</style>

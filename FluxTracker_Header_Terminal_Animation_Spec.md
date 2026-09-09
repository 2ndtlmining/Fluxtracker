# FluxTracker Header — Terminal Boot & Sync Animation
## Implementation Specification

**Project:** FluxTracker  
**Repository:** https://github.com/2ndtlmining/Fluxtracker  
**Feature:** Retro Linux/terminal-inspired animated header  
**Status:** Implementation-ready specification  
**Primary goal:** Make the header feel like a small piece of terminal software booting and synchronizing with the Flux network.

---

# 1. Design Decision

Replace the current static `FLUX / TRACKER` header title with a compact terminal/ASCII experience.

The final persistent state should **NOT** show the existing two-line `FLUX / TRACKER` text.

Instead, after the boot sequence completes, the header should permanently display a **compact ASCII-art `FLUX` logo only**.

The word `TRACKER` should not appear in the final logo. This saves vertical space and gives the application a more distinctive retro-terminal identity.

The animation should feel like:

> a small Linux command-line application starting, connecting to the Flux network, processing blocks, then becoming a live monitoring interface.

It should NOT feel like a generic cyberpunk animation.

---

# 2. UX Summary

There are two animation modes.

## Mode A — Initial Boot

Triggered once whenever the application is loaded/refreshed.

Approximate total duration:

**2.5–3.0 seconds maximum**

Sequence:

```text
> ./start_flux_tracker
> initializing telemetry...
> connecting to flux network... OK
> api......................... OK
> database.................... OK
> loading blocks XXXX / 294912
> loading blocks XXXX / 294912
> loading blocks XXXX / 294912
> loading blocks 294912 / 294912 ... OK
> version vX.XX <codename> loaded
> network XXXX nodes | apps XXXX
> tracker ready
```

Then transition into the ASCII `FLUX` logo.

The ASCII logo should remain visible as the **persistent header identity** after boot.

---

## Mode B — Periodic Sync

Triggered when the application detects that new blockchain data has arrived / the tracker has synchronized.

This must be much shorter than the boot sequence.

Target duration:

**~0.7–1.2 seconds**

Example:

```text
> loading new blocks 294913
> loading new blocks 294914
> loading new blocks 294915
> sync complete
```

Then immediately return to the persistent ASCII `FLUX` logo.

Do NOT replay the full boot sequence every five minutes.

Do NOT hide the entire header during a sync.

---

# 3. Desired Visual Style

The implementation should preserve the current FluxTracker visual language:

- dark terminal-like background
- monospace typography
- cyan primary accent
- subtle cyan glow
- restrained animation
- no gradients that look modern/consumer-oriented
- no floating particle systems
- no generic sci-fi HUD graphics
- no excessive animation
- no large modal/overlay
- no full-screen splash screen

Think:

**Linux terminal + old-school ASCII utility + blockchain node monitor**

rather than:

**modern crypto landing page + cyberpunk effects**

The animation should be crisp and readable.

---

# 4. Final ASCII Logo

The final persistent logo should be `FLUX` only.

Use a compact ASCII/block representation.

Suggested starting design:

```text
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

However, this is a **starting candidate**, not a strict requirement.

The implementation should make the ASCII logo easy to replace later.

Store it as a constant/data structure rather than scattering the ASCII characters throughout the component.

Example concept:

```js
const FLUX_LOGO = `
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
`;
```

The final logo must:

- be rendered in a `<pre>` or equivalent monospace-safe element
- preserve whitespace
- use the existing cyan/glow styling
- remain responsive
- not cause horizontal page overflow
- scale down appropriately on mobile

If this particular ASCII font is too wide for the existing header, create a **smaller 4–5 row FLUX logo** rather than allowing the header to become oversized.

---

# 5. Boot Sequence — Detailed Behaviour

## 5.1 Start

On browser mount, before the normal logo is displayed:

```text
> ./start_flux_tracker
```

The cursor can optionally blink once or twice.

Example:

```text
> ./start_flux_tracker_
```

Then:

```text
> ./start_flux_tracker
```

Do not make the cursor animation excessive.

---

## 5.2 Initialization

Display:

```text
> initializing telemetry...
```

After approximately 150–250 ms:

```text
> initializing telemetry... OK
```

Then:

```text
> connecting to flux network...
```

Then:

```text
> connecting to flux network... OK
```

These messages should not each require long delays.

The entire boot sequence must stay below roughly 3 seconds.

---

# 6. Use Real Application Data

The boot sequence should use real values already available from `/api/header`.

The current `Header.svelte` already retrieves:

- `fluxPrice`
- `blockHeight`
- `totalNodes`
- `totalApps`
- `uptime`
- `snapshotCount`
- `transactionCount`
- `lastSyncBlock`
- `appVersion`
- `arcaneOsCodename`
- `platform`
- `hostLocation`
- `cpuCores`
- `totalMemMB`
- `usedMemMB`
- `memPercent`
- API status
- DB status

Do not invent values when real values are available.

Relevant existing code is in:

```text
src/lib/components/Header.svelte
```

The existing component currently fetches:

```text
/api/header
```

and refreshes its header data periodically.

---

# 7. Block Loading Animation

This is one of the main visual features.

The desired terminal line is:

```text
> loading blocks XXXX / 294912
```

The displayed number should rapidly count upward.

IMPORTANT:

This is a **visual counter only**.

Do NOT make 294,912 API calls.

Do NOT actually iterate through every blockchain block.

The animation should interpolate from an appropriate starting block to the current block and update the displayed number at a controlled frame rate.

Example:

```text
> loading blocks 293841 / 294912
> loading blocks 293902 / 294912
> loading blocks 293967 / 294912
> loading blocks 294031 / 294912
> loading blocks 294107 / 294912
> loading blocks 294196 / 294912
> loading blocks 294274 / 294912
> loading blocks 294351 / 294912
> loading blocks 294428 / 294912
> loading blocks 294511 / 294912
> loading blocks 294607 / 294912
> loading blocks 294712 / 294912
> loading blocks 294812 / 294912
> loading blocks 294912 / 294912 ... OK
```

The actual target should be the current `blockHeight` returned by the API.

Do not hard-code `294912` in production.

The `294912` shown above is only an example.

Use:

```js
blockHeight
```

as the target.

---

# 8. Boot Counter Timing

Target duration:

**~1.2–1.8 seconds**

The counter should accelerate naturally.

Recommended behaviour:

1. Determine the current block height.
2. Determine a visually reasonable starting value.
3. Animate toward the current block.
4. Update the displayed number approximately 20–30 times per second OR use `requestAnimationFrame`.
5. Always finish exactly on the real target block height.
6. Never overshoot the target.
7. If the target is unavailable, use a fallback loading state and continue safely.

The visual counter should feel fast.

Do not make the user watch a long blockchain replay.

---

# 9. Boot Stats

After the block animation, briefly display useful real statistics.

Example:

```text
> version v1.03 jolly wombat loaded
> network 12,481 nodes | apps 3,842
> tracker 819 snapshots | 182,492 transactions
> telemetry ready
```

Keep this concise.

Do not display every available metric.

The boot sequence should communicate that the application successfully initialized, not dump the whole dashboard into the header.

Recommended order:

```text
> version <version> <codename> loaded
> network <nodes> nodes | <apps> apps
> tracker <snapshots> snapshots
> telemetry ready
```

---

# 10. Transition Into ASCII FLUX

After the final boot line:

```text
> telemetry ready
```

transition to the ASCII `FLUX` logo.

Recommended transition:

### Stage 1

Terminal text remains visible.

### Stage 2

Terminal text fades/clears.

### Stage 3

ASCII logo appears.

### Stage 4

ASCII logo briefly has a subtle cyan glow.

### Stage 5

Logo becomes stable.

The final state should be:

```text
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

and this remains displayed.

There should be no:

```text
FLUX
TRACKER
```

text beneath it.

The existing `Build: vX.X <codename>` line can remain if it still fits the layout, but it should be positioned beneath or beside the compact ASCII logo according to the current responsive layout.

---

# 11. Sync Animation

The sync animation must be separate from the boot animation.

State flow:

```text
READY
  ↓
SYNCING
  ↓
READY
```

When a new sync is detected:

```text
> loading new blocks 294913
```

If several blocks arrived:

```text
> loading new blocks 294913
> loading new blocks 294914
> loading new blocks 294915
```

Then:

```text
> sync complete
```

Immediately restore:

```text
[ASCII FLUX LOGO]
```

Target total duration:

**~0.7–1.2 seconds**

Do not wait five seconds.

Do not show a large overlay.

Do not interrupt the rest of the dashboard.

---

# 12. Detecting a Real Sync

The animation should be data-driven.

The current `Header.svelte` receives:

```js
blockHeight = data.network.blockHeight;
lastSyncBlock = data.tracker.lastSyncBlock;
```

Use the previous block height as the baseline.

Conceptually:

```js
let previousBlockHeight = null;

async function fetchHeaderData() {
    // fetch data

    const newBlockHeight = data.network.blockHeight;

    if (
        previousBlockHeight !== null &&
        newBlockHeight > previousBlockHeight &&
        bootComplete
    ) {
        triggerSyncAnimation(previousBlockHeight, newBlockHeight);
    }

    previousBlockHeight = newBlockHeight;

    // update normal state
}
```

The first successful fetch MUST NOT trigger the sync animation.

Otherwise every page refresh would show both boot and sync.

---

# 13. Boot vs Sync Guard

Use explicit state.

Suggested:

```js
let animationState = 'boot';
// 'boot' | 'ready' | 'syncing'
```

Rules:

```text
boot
 └── initial page load only

ready
 └── normal persistent ASCII FLUX logo

syncing
 └── short new-block animation
```

During initial boot:

- ignore block-height changes
- do not trigger sync animation
- finish boot first
- set state to `ready`

After boot:

- monitor block height
- trigger sync animation when appropriate
- return to `ready`

---

# 14. Do Not Depend Solely on a Five-Minute Timer

The application currently has refresh mechanisms.

The dashboard uses:

```text
DASHBOARD_REFRESH_MS
```

and the current header independently polls `/api/header`.

Do not implement:

```js
setInterval(triggerSyncAnimation, 300000)
```

as the source of truth.

A timer can be used to fetch data, but the animation should happen because **new data was actually detected**.

Preferred:

```text
poll / refresh
     ↓
new block height?
     ↓
yes
     ↓
sync animation
```

This prevents the UI from claiming a sync happened when the backend did not actually change.

---

# 15. Consider Aligning Header Refresh With Dashboard Refresh

The current `Header.svelte` independently refreshes `/api/header` every 30 seconds.

The dashboard has its own shared refresh cycle.

Do not perform a large refactor unless necessary.

For the first implementation, the simplest safe solution is:

- keep existing header polling
- detect new block height inside `Header.svelte`
- run boot animation on first mount
- run sync animation only after boot

A future refactor can introduce a shared sync store if needed.

Do not over-engineer this feature.

---

# 16. Suggested New Component

Create:

```text
src/lib/components/TerminalHeaderAnimation.svelte
```

Responsibilities:

- boot sequence rendering
- terminal line animation
- block counter animation
- ASCII FLUX logo
- sync animation
- animation state management
- reduced-motion handling

The existing `Header.svelte` should remain responsible for:

- API fetching
- header statistics
- API/DB status
- host information
- deciding when a sync occurred

This separation keeps the component maintainable.

---

# 17. Suggested Component Interface

A possible interface:

```svelte
<TerminalHeaderAnimation
    blockHeight={blockHeight}
    lastSyncBlock={lastSyncBlock}
    totalNodes={totalNodes}
    totalApps={totalApps}
    snapshotCount={snapshotCount}
    transactionCount={transactionCount}
    appVersion={appVersion}
    arcaneOsCodename={arcaneOsCodename}
    on:bootComplete={handleBootComplete}
/>
```

However, use the Svelte syntax/style already established by the repository.

Do not introduce a new state-management library.

The exact component API can be adapted to the project's existing Svelte version/style.

---

# 18. Recommended Internal State

Inside the animation component, use a small explicit state machine.

Conceptually:

```js
let state = 'booting';
// booting
// ready
// syncing

let terminalLines = [];
let animatedBlock = null;
let syncStartBlock = null;
let syncEndBlock = null;
let reducedMotion = false;
```

Potential functions:

```js
startBoot()
animateBlockLoading()
finishBoot()
startSync(startBlock, endBlock)
finishSync()
```

Keep these functions small.

---

# 19. ASCII Animation

The ASCII logo itself can have a short entrance animation.

Do not make it a conventional fade only.

A good retro-terminal effect would be:

```text
FLUX logo characters initially appear as noise
        ↓
characters stabilize
        ↓
final ASCII FLUX
```

For example, a few frames could look like:

```text
> loading interface...

 ███░███╗██╗░░░░░██╗░░░██╗██╗░░██╗
 ██╔══██║██║░░░░░██║░░░██║╚██╗██╔╝
 ███████║██║░░░░░██║░░░██║░╚███╔╝
```

then:

```text
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 ...
```

The exact frame design can be refined after implementation.

Do not use a huge number of animation frames.

Aim for:

**3–6 frames maximum.**

---

# 20. ASCII Motion

ASCII Motion can be used as a **design/prototyping tool** to experiment with:

- ASCII logo frames
- distortion
- character replacement
- noise
- timing

Do NOT make ASCII Motion a required runtime dependency unless there is a compelling technical reason.

The preferred runtime implementation is native Svelte/HTML/CSS/JavaScript.

Reasons:

- lower dependency complexity
- easier integration with live FluxTracker data
- easier responsive behaviour
- easier accessibility
- easier state control
- easier maintenance
- no need to ship a pre-rendered animation

---

# 21. Reduced Motion / Accessibility

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

If reduced motion is enabled:

- skip the animated block counter
- skip character distortion
- skip prolonged terminal typing effects
- show the boot text with minimal/no animation
- transition quickly to the final ASCII FLUX logo
- sync animation should be nearly instantaneous

The feature should remain usable without animation.

---

# 22. Error Handling

The animation must never prevent the actual dashboard from loading.

If `/api/header` fails:

```text
> ./start_flux_tracker
> initializing telemetry...
> connecting to flux network... ERROR
> telemetry unavailable
```

Then the normal header should still render.

Do not leave the user permanently stuck in the boot sequence.

Recommended timeout:

**~4 seconds maximum**

If boot data cannot be loaded by then, exit the animation and render the normal/fallback header state.

---

# 23. Important Data Rules

Never display fake success messages.

For example, do not show:

```text
> database... OK
```

if the API/database status is actually offline.

If the real status is known:

```text
> database... OK
```

If offline:

```text
> database... OFFLINE
```

Likewise, do not show:

```text
> network 12,481 nodes
```

unless that number came from the API.

The terminal aesthetic is decorative, but its status information should remain truthful.

---

# 24. Existing Files To Modify

## Required

### `src/lib/components/Header.svelte`

Modify this file to:

1. Preserve existing API fetching.
2. Preserve existing header statistics.
3. Track the previous block height.
4. Track boot completion.
5. Detect a new block height after boot.
6. Trigger the sync animation.
7. Replace the existing static title with the new terminal/ASCII component.
8. Keep existing right-side statistics.
9. Keep existing API/DB status indicators.
10. Preserve responsive behaviour.

The current title is approximately:

```svelte
<h1 class="header-title glow-text">
    FLUX<br/>TRACKER
</h1>
```

This should be replaced by the new animated component/final ASCII logo.

The current API polling behaviour should remain intact unless a small adjustment is necessary.

---

## Required — New File

### `src/lib/components/TerminalHeaderAnimation.svelte`

Create this component.

Responsibilities:

- initial boot sequence
- terminal text
- block counter
- ASCII FLUX logo
- sync animation
- state machine
- reduced motion
- animation cleanup

---

# 25. Potentially Modified File

## `src/routes/+page.svelte`

Only modify this if necessary.

The current page already mounts:

```svelte
<Header />
```

and has the dashboard refresh system.

Do NOT add another global timer here unless there is a clear architectural reason.

The first implementation should preferably keep the feature encapsulated inside `Header.svelte` + `TerminalHeaderAnimation.svelte`.

---

# 26. Potentially Modified File

## `src/lib/config.js`

Only inspect this file.

Do not change it unless the existing refresh timing is required for synchronization.

The implementation should respect:

```text
DASHBOARD_REFRESH_MS
```

rather than introducing another five-minute constant without understanding the existing configuration.

---

# 27. Files That Should NOT Be Changed

Unless required by an implementation issue:

- dashboard card components
- chart components
- revenue components
- node components
- footer
- API endpoints
- database code
- backend synchronization logic
- global theme variables
- unrelated CSS

This is intended to be a focused header enhancement.

---

# 28. CSS Requirements

The final ASCII logo should use the existing theme variables wherever possible.

Use existing variables such as:

```css
var(--text-primary)
var(--text-cyan)
var(--glow-cyan)
var(--bg-header)
var(--text-muted)
```

Do not introduce a new palette.

The logo should visually belong to the current FluxTracker header.

Suggested:

```css
.ascii-logo {
    margin: 0;
    font-family: inherit;
    color: var(--text-primary);
    text-shadow: var(--glow-cyan);
    white-space: pre;
    line-height: 1;
}
```

If the existing glow variable is too strong for the ASCII logo, create a component-local, more subtle version using the existing cyan colour variable.

---

# 29. Responsive Requirements

Desktop:

- ASCII FLUX logo should be visually prominent but compact.
- Right-side stats should remain in their current position.
- Header should not become significantly taller than the current header.

Tablet:

- preserve the existing header stacking behaviour.

Mobile:

- use a smaller ASCII FLUX logo
- do not cause horizontal scrolling
- do not allow the ASCII art to push the stats off-screen
- host-line can retain its existing mobile hiding behaviour
- boot text should wrap or use a compact version

If necessary, use a separate compact ASCII logo for mobile.

---

# 30. Animation Timing Target

Target:

```text
0.00s  > ./start_flux_tracker
0.20s  > initializing telemetry...
0.45s  > initializing telemetry... OK
0.55s  > connecting to flux network...
0.80s  > connecting to flux network... OK
0.90s  > api.................... OK
1.00s  > database............... OK
1.05s  > loading blocks XXXX / TARGET
1.05–2.15s  block counter animation
2.20s  > version X.X <codename> loaded
2.35s  > network XXXX nodes | apps XXXX
2.50s  > telemetry ready
2.55s  ASCII FLUX begins appearing
2.90s  ASCII FLUX stable
```

These are targets, not rigid requirements.

The animation should feel fast.

---

# 31. Sync Timing Target

Example:

```text
0.00s  > loading new blocks 294913
0.20s  > loading new blocks 294914
0.40s  > loading new blocks 294915
0.60s  > loading new blocks 294916
0.75s  > sync complete
0.85s  ASCII FLUX
```

For multiple blocks, interpolate quickly.

Do not create a long per-block delay.

---

# 32. Avoid Animation Overlap

If another sync occurs while the sync animation is already running:

- do not start another animation concurrently
- update the target block if practical
- otherwise allow the current sync animation to finish and then use the newest known block height

Never allow multiple timers/animation frames to compete.

All timers and `requestAnimationFrame` loops must be cleaned up in `onDestroy`.

---

# 33. Initial Data Race

The current header performs its first API request during `onMount()`.

The implementation must account for:

```text
component mounted
      ↓
animation starts
      ↓
API request completes
```

The boot sequence should wait for enough data to populate the meaningful boot lines.

Do not render:

```text
> network 0 nodes
> apps 0
```

just because the initial Svelte defaults are zero.

Prefer:

```text
> connecting to flux network...
```

until the data arrives.

---

# 34. Recommended Implementation Order

Implement in this order.

## Step 1

Create:

```text
TerminalHeaderAnimation.svelte
```

with a static test boot sequence.

Do not connect it to sync detection yet.

---

## Step 2

Connect real header data:

- block height
- nodes
- apps
- snapshots
- transactions
- version
- codename
- API status
- DB status

---

## Step 3

Implement the animated block counter.

Verify that:

- it completes in under ~2 seconds
- it ends exactly at the actual block height
- it never makes blockchain/API requests per displayed block

---

## Step 4

Implement the ASCII FLUX final state.

Verify that:

- only `FLUX` appears
- `TRACKER` is removed from the final state
- it fits the existing header
- it looks good on desktop and mobile

---

## Step 5

Add boot completion state to `Header.svelte`.

The first API response must not trigger sync.

---

## Step 6

Add block-height change detection.

Example:

```text
old block = 294912
new block = 294916
```

should trigger:

```text
> loading new blocks 294913
> loading new blocks 294914
> loading new blocks 294915
> loading new blocks 294916
> sync complete
```

---

## Step 7

Test repeated refreshes.

Every full browser refresh should:

```text
BOOT
 ↓
ASCII FLUX
```

---

## Step 8

Wait for/force a data refresh.

Verify:

```text
ASCII FLUX
 ↓
SHORT SYNC
 ↓
ASCII FLUX
```

---

## Step 9

Test API failure.

Verify the user still gets the dashboard.

---

## Step 10

Test:

- desktop
- tablet
- mobile
- reduced-motion
- slow network
- API failure
- no new block
- one new block
- many new blocks

---

# 35. Acceptance Criteria

The implementation is complete only when all of the following are true.

### Boot

- [ ] Browser refresh triggers the terminal boot sequence.
- [ ] Boot begins with `> ./start_flux_tracker`.
- [ ] Boot uses real API data where appropriate.
- [ ] Block counter animates toward the real current block height.
- [ ] Block counter completes within approximately 3 seconds total.
- [ ] No API request is made for each animated block.
- [ ] Version/codename appears during boot.
- [ ] Network stats appear during boot.
- [ ] Boot eventually resolves into the ASCII FLUX logo.
- [ ] Final state contains `FLUX` only.
- [ ] Existing `FLUX TRACKER` text is not displayed in the final state.

### Persistent state

- [ ] ASCII FLUX remains visible after boot.
- [ ] Header right-side telemetry remains functional.
- [ ] Existing price, uptime, snapshots, API/DB, host and memory information remain intact.
- [ ] Header does not become unnecessarily taller.

### Sync

- [ ] New block height after boot triggers the short sync animation.
- [ ] Sync animation shows only new blocks.
- [ ] Sync animation lasts roughly 0.7–1.2 seconds.
- [ ] Sync returns to ASCII FLUX.
- [ ] Full boot does not replay on sync.
- [ ] No overlapping sync animations occur.

### Reliability

- [ ] API errors do not trap the user in the animation.
- [ ] Timers/animation frames are cleaned up.
- [ ] First API fetch does not incorrectly trigger sync.
- [ ] Slow API responses are handled gracefully.

### Accessibility

- [ ] `prefers-reduced-motion` is respected.
- [ ] Reduced-motion users get the same information without excessive animation.
- [ ] ASCII art remains readable.

### Responsive

- [ ] Desktop works.
- [ ] Tablet works.
- [ ] Mobile works.
- [ ] No horizontal overflow is introduced.

---

# 36. Do Not Do These Things

Do NOT:

- add a full-screen splash screen
- add a video
- add a GIF
- add a canvas animation unless absolutely necessary
- add a heavy animation dependency
- add Matrix-style falling characters
- add random particles
- replay the boot sequence every five minutes
- fake blockchain processing
- make hundreds/thousands of network requests during the animation
- add fake statistics
- change the dashboard refresh architecture unnecessarily
- remove existing useful header telemetry
- make the animation longer than approximately 3 seconds
- make the sync animation annoying
- create excessive glow effects
- make the ASCII logo so large that it dominates the page

---

# 37. Desired End Result

The user's experience should be:

### Refresh

```text
> ./start_flux_tracker
> initializing telemetry...
> connecting to flux network... OK
> api......................... OK
> database.................... OK
> loading blocks 294812 / 294912
> loading blocks 294851 / 294912
> loading blocks 294891 / 294912
> loading blocks 294912 / 294912 ... OK
> version v1.03 jolly wombat loaded
> network 12,481 nodes | apps 3,842
> telemetry ready
```

Then:

```text
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

And it stays there.

Five minutes later:

```text
> loading new blocks 294913
> loading new blocks 294914
> loading new blocks 294915
> sync complete
```

Then immediately:

```text
 ███████╗██╗     ██╗   ██╗██╗  ██╗
 ██╔════╝██║     ██║   ██║╚██╗██╔╝
 █████╗  ██║     ██║   ██║ ╚███╔╝
 ██╔══╝  ██║     ██║   ██║ ██╔██╗
 ██║     ███████╗╚██████╔╝██╔╝ ██╗
 ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝
```

The result should feel like **FluxTracker is a terminal application with a graphical dashboard attached to it**, which is the intended visual identity for this feature.

---

# 38. Implementation Principle

Keep this feature **small, self-contained and reversible**.

The first implementation should primarily involve:

```text
src/lib/components/Header.svelte
src/lib/components/TerminalHeaderAnimation.svelte
```

with only minimal supporting changes elsewhere.

Do not refactor unrelated application architecture as part of this task.

The animation should enhance the existing FluxTracker dashboard, not become the dashboard.

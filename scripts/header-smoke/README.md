# Header animation acceptance harness

Headless-browser checks for the terminal header (`TerminalHeaderAnimation.svelte`). Every
header change shipped so far was accepted against exactly these assertions — run them
before touching the animation so regressions (size jumps, style drift, empty rows,
timing changes) are caught mechanically.

## What it asserts

- Boot reads slowly (~2x the original) and the header/box height is **one constant value**
  from first paint through boot and the idle rotation
- Boot text and the idle-rotation info frames share one voice (font/colour)
- **Idle rotation** (issue #104 Phase 2): once boot finishes, the box cycles
  Logo -> Latest Expiring -> Latest Deployed -> Logo -> ... — both info frames appear
  (icon + NAME + EXPIRE-or-AGO + INST + RES rows), no frame ever shows an empty row,
  and the box returns to a pure logo frame between them
- **Freshness**: the stub switches both `/api/carousel/deployed` and
  `/api/carousel/expiring` to a different fixture app after their first call: the harness
  waits to see that new name appear in the rotation, proving it re-polls rather than
  holding onto whatever it first loaded
- **Per-game intros** (issues #180, #199): the second deployed fixture is named after a
  game with art of its own, and the harness asserts that art appears and animates. Which
  game is chosen by `DEPLOYED_GAME` (`valheim` default, `minecraft`, `dragonwilds`) and
  **must be passed identically to the stub and the check** — the stub names the fixture
  from it and the check picks the art signature from it. One run covers one game: the
  component holds a single `latestDeployedApp` and the dashboard's 5-minute poll interval
  is longer than the harness's 100s budget, so a full sweep is three runs:

  ```bash
  for g in valheim minecraft dragonwilds; do
    DEPLOYED_GAME=$g node scripts/header-smoke/stub-api.mjs &   # restart between runs
    DEPLOYED_GAME=$g node scripts/header-smoke/check-header.mjs
  done
  ```

  The first fixture (palworld) has no art of its own, so every run also covers the shared
  controller fallback.
- Build version renders `--accent-green`, codename `--accent-purple`
- Mobile (375px): exactly 6 mobile rows, no wrapping
- No console errors

## Boot-race check (issue #192)

`check-boot-race.mjs` is a second, separate run that covers the one thing the suite above
cannot see on a fast connection: an `/api/header` response landing *after* the component's
8s `BOOT_TIMEOUT_MS` has given up on telemetry. That used to run the whole boot a second
time, leaving two idle-rotation chains and two `requestAnimationFrame` loops writing
`frameLines` on alternating frames — the flashing FLUX logo reported in issue #192.

It asserts boot text never reappears once the logo has been shown, and that every completed
rotation dwell lasts at least 5s (a second chain wipes frames away early).

```bash
HEADER_DELAY_MS=8500 node scripts/header-smoke/stub-api.mjs   # terminal 1
API_PORT=3100 npm run dev -- --port 5199                       # terminal 2
node scripts/header-smoke/check-boot-race.mjs                  # terminal 3
```

`HEADER_DELAY_MS` delays only the stub's **first** `/api/header` call, so restart the stub
between runs. Unset (the default) it changes nothing, and `check-header.mjs` above runs
exactly as before. Takes ~70s.

## Reduced-motion check (issue #194)

`check-reduced-motion.mjs` is a third run that covers the one visitor the other two never
simulate: one whose browser reports `prefers-reduced-motion: reduce`. `schedule()` used to
clamp *every* delay to 30ms under that preference, including `ROTATE_HOLD_MS` and
`BOOT_TIMEOUT_MS`, so the box cycled Logo -> Expiring -> Deployment about 30 times a second
(the flashing FLUX logo of issue #194) and the boot gave up on telemetry 30ms in. Brave
reports the preference as fingerprinting protection whatever the OS setting is, which is why
it read as a Brave-only bug.

It asserts the box repaints at most 40 times in 30s and that the boot never falls back to
`> telemetry unavailable` while the stub is answering.

```bash
node scripts/header-smoke/stub-api.mjs              # terminal 1
API_PORT=3100 npm run dev -- --port 5199            # terminal 2
node scripts/header-smoke/check-reduced-motion.mjs  # terminal 3
```

Takes ~30s. Before the fix: 923 repaints in 30s. After: 8.

## Run it

```bash
npm install --no-save puppeteer-core          # uses the installed Edge/Chrome, no download
node scripts/header-smoke/stub-api.mjs        # terminal 1 — deterministic /api/header
API_PORT=3100 npm run dev -- --port 5199      # terminal 2
node scripts/header-smoke/check-header.mjs    # terminal 3 — exits 0 when all pass
```

`API_PORT` (not `VITE_API_URL`) is what points `hooks.server.js`'s `/api/*` proxy at the
stub — the browser calls same-origin relative paths, exactly like real usage. Issue #125's
CSP (`connect-src 'self'`) blocks a cross-origin `VITE_API_URL` override.

Env overrides: `BASE_URL`, `STUB_URL`, `BROWSER_PATH` (defaults to the first of
Edge/Chrome found), `SAMPLE_MS`, `STUB_PORT`. Takes ~2 minutes (waits for the second
30s header poll to serve the stub's updated fixtures, then for the rotation to reach
that slot).

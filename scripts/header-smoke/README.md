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
  (icon + NAME + EXPIRE-or-REPO + INST + RES rows), no frame ever shows an empty row,
  and the box returns to a pure logo frame between them
- **Freshness**: the stub switches both `/api/carousel/deployed` and
  `/api/carousel/expiring` to a different fixture app after their first call: the harness
  waits to see that new name appear in the rotation, proving it re-polls rather than
  holding onto whatever it first loaded
- Build version renders `--accent-green`, codename `--accent-purple`
- Mobile (375px): exactly 6 mobile rows, no wrapping
- No console errors

## Run it

```bash
npm install --no-save puppeteer-core          # uses the installed Edge/Chrome, no download
node scripts/header-smoke/stub-api.mjs        # terminal 1 — deterministic /api/header
VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --port 5199   # terminal 2
node scripts/header-smoke/check-header.mjs    # terminal 3 — exits 0 when all pass
```

Env overrides: `BASE_URL`, `STUB_URL`, `BROWSER_PATH` (defaults to the first of
Edge/Chrome found), `SAMPLE_MS`, `STUB_PORT`. Takes ~2 minutes (waits for the second
30s header poll to serve the stub's updated fixtures, then for the rotation to reach
that slot).

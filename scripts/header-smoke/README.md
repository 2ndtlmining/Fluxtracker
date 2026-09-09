# Header animation acceptance harness

Headless-browser checks for the terminal header (`TerminalHeaderAnimation.svelte`). Every
header change shipped so far was accepted against exactly these assertions — run them
before touching the animation so regressions (size jumps, style drift, empty rows,
timing changes) are caught mechanically.

## What it asserts

- Boot reads slowly (~2x the original) and the header/box height is **one constant value**
  from first paint through boot, steady state and sync
- Boot text, sync text and the build-info line share one voice (font/colour)
- Sync frames **always fill all 6 rows** — no empty row at any point of any wipe
- The sync blocks counter counts up and lands `... OK`; full sync ~2.7s (400ms wipes)
- The sync pattern is a random 2-char texture, different on every sync
- Build version renders `--accent-green`, codename `--accent-purple`
- Mobile (375px): exactly 6 mobile rows, no wrapping
- No console errors
- **Deployment event** (issues #98 / #104): injected via the stub's
  `POST /inject-deployment` once the sync scenario above finishes (so the two never
  compete for the same poll) — box height never changes, the correct icon (whale for
  docker, octocat for a `runonflux/orbit` repo) shows, NAME/INST/RES rows appear, no row
  is ever empty mid-frame, and the box returns to the logo afterward

## Run it

```bash
npm install --no-save puppeteer-core          # uses the installed Edge/Chrome, no download
node scripts/header-smoke/stub-api.mjs        # terminal 1 — deterministic /api/header
VITE_API_URL=http://127.0.0.1:3100 npm run dev -- --port 5199   # terminal 2
node scripts/header-smoke/check-header.mjs    # terminal 3 — exits 0 when all pass
```

Env overrides: `BASE_URL`, `STUB_URL`, `BROWSER_PATH` (defaults to the first of
Edge/Chrome found), `SAMPLE_MS`, `STUB_PORT`. Takes ~2-3 minutes (waits for the 30s
header poll to trigger a real sync, then injects and waits out a full deployment event).

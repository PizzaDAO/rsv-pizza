# woodfired-98150 — Rollup banner download fix

## Problem

Users report (a) the rollup banner often fails to download at all, and (b)
downloaded PNGs have "a lot of white space at the end."

## Root cause

`frontend/src/components/generative/configs/rollupConfig.ts` sets
`fullResWidth: 10061, fullResHeight: 27392`. At full-res scale the offscreen
canvas in `renderFullRes` (`frontend/src/components/generative/GenerativeCanvas.tsx`
around lines 437-466) is **10061 × 27392 = 275.6M pixels**, which exceeds
Chrome's hard canvas-area limit of **2^28 = 268,435,456 px** by ~7M pixels.

Two failure modes follow:

1. `toDataURL('image/png')` silently returns the empty placeholder
   `data:,` → the `link.click()` download produces nothing → user sees no file
   appear / a "trouble downloading" symptom.
2. Where the browser allocates the canvas but clips out-of-range writes, only
   the top portion is drawn from `drawImage`. The bottom of the canvas stays
   transparent, which renders as white in most viewers/printers → "white space
   at the end."

The poster config is fine: 5400 × 7200 = 38.9M px.

Mobile path *already* caps width:

```ts
// GenerativeCanvas.tsx ~L441
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const maxWidth = isMobile ? 4000 : config.fullResWidth;
const effectiveScale = Math.min(scaleFactor, maxWidth / config.canvasWidth);
```

…but desktop has no cap, so it uses the full 10061 → 275M px canvas.

## Fix

Cap *desktop* width too, sized to stay under the browser canvas-area limit.

Chrome's limit is 268,435,456 px. With aspect ratio `2940/1080 ≈ 2.722`, the
maximum safe width is `sqrt(268_435_456 / 2.722) ≈ 9925`. We want margin (other
browsers and headroom for layer compositing), so cap at **8000 wide**:

- canvas = 8000 × 21778 ≈ 174.2M px → safe in all major browsers.
- On a typical 33" × 80" roll-up banner that's ~242 DPI — well above print
  threshold (200 DPI is industry minimum, 150 DPI is acceptable for large
  banners viewed from a distance).

### Implementation

In `frontend/src/components/generative/GenerativeCanvas.tsx`, change the
`renderFullRes` cap to apply on both mobile and desktop. Two clean options;
pick the simpler:

**Option A — single cap, simple:**

```ts
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MAX_DESKTOP_WIDTH = 8000;
const MAX_MOBILE_WIDTH = 4000;
const maxWidth = Math.min(
  config.fullResWidth,
  isMobile ? MAX_MOBILE_WIDTH : MAX_DESKTOP_WIDTH,
);
const effectiveScale = Math.min(scaleFactor, maxWidth / config.canvasWidth);
```

**Option B — area-based cap (more general):** compute max width from
`sqrt(MAX_AREA / aspectRatio)`. More robust if other tall formats are added
later, but more code. Skip unless we expect more rollup-like formats.

Use Option A.

## Files to change

- `frontend/src/components/generative/GenerativeCanvas.tsx` — single change in
  `renderFullRes()` (~lines 437-466). No other file needs to change.

## Out of scope

- Touching the `fullResUrl` template asset (10061-wide PNG is fine; we just
  downsample when drawing).
- The poster format — its canvas (38.9M px) is well within limits.
- Changing the existing mobile cap.
- The full-res *template fetch* (`loadImg(config.fullResUrl)`) still happens
  so output is sharp; we just render it into a smaller canvas.

## Verification

1. Open a rollup-eligible event → Print tab → Roll-Up Banner.
2. Click Download on desktop Chrome. Confirm:
   - A PNG file actually downloads (not empty).
   - The PNG has content all the way to the bottom — no white block at the end.
   - Image dimensions are 8000 × 21778 (or close, depending on aspect ratio
     rounding).
3. Repeat on mobile (iOS/Android) — should still produce a 4000-wide PNG as
   before.
4. Confirm the poster format download is unaffected (PNG ~5400 × 7200).

## Tests

No unit tests added — this is a rendering parameter change; behavior is
verifiable from the visible download. If the team later wants automated cover-
age, a Playwright test that hits Download and asserts the PNG's height matches
expectation would be the right shape, but is out of scope for this fix.

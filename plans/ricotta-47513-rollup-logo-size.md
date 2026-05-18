# ricotta-47513 — Rollup download: sponsor logos sized larger than preview

## Problem

Users report the downloaded rollup banner doesn't match the preview — sponsor
logos appear higher and larger in the download than in the on-screen preview.

## Root cause

The preview's group-logo size fallback (`GenerativeCanvas.tsx:962`):

```ts
const size = logoSizes[s.id] ?? Math.min(defaultLogoSize, autoLogoSize);
```

…clamps to `defaultLogoSize = 80` (CSS px in canvas coords).

The download path (`renderCanvas.ts:132`):

```ts
const customSize = sp.id && logoSizes[sp.id] ? logoSizes[sp.id] * s : autoLogoSize;
```

…uses `autoLogoSize` with no 80-clamp.

For the rollup config (`sponsorBox.height = 540`, `defaultRows = 3`,
`logoScale = 1.5`) the computed `autoLogoSize` is ~258px in canvas coords,
roughly 3× the preview size. Larger logos → larger `row.height` → smaller
`drawY` from the `(boxH - totalH) / 2` centering math → logos shift visually
upward in the download.

The popped-logo path (`renderCanvas.ts:105`) already uses
`(logoSizes[sp.id!] || 80) * s`, so it's correct — only the group-layout
fallback needs the clamp.

## Fix

In `frontend/src/components/generative/renderCanvas.ts`, change the
group-logo fallback to apply the same `Math.min(80, autoLogoSize)` clamp the
preview uses. Multiply by `s` because everything in this branch is in scaled
canvas coords:

```ts
// Before (line ~132):
const customSize = sp.id && logoSizes[sp.id] ? logoSizes[sp.id] * s : autoLogoSize;

// After:
const customSize = sp.id && logoSizes[sp.id]
  ? logoSizes[sp.id] * s
  : Math.min(80 * s, autoLogoSize);
```

That's the entire fix. No other lines need to change.

## Files to change

- `frontend/src/components/generative/renderCanvas.ts` — one line in the
  group-logo `for (const sp of groupSponsors)` loop.

## Out of scope

- The popped-logo path — already correct.
- The poster format — uses the same code but `posterConfig` has no
  `logoScale` and a smaller sponsor box, so its `autoLogoSize` is already
  ≤80, making the bug invisible.
- The 8000-px desktop canvas cap from PR #370 — that fix stays; orthogonal.

## Verification

1. Open a rollup-eligible event with multiple sponsors → Print tab → Roll-Up
   Banner. Confirm the preview already looks right (it does in prod today).
2. Click Download. The downloaded PNG's sponsor logos should:
   - Match the preview's sizes (capped at 80px equivalent), not 3× larger.
   - Sit at the same vertical position as in the preview.
3. Sanity-check: drag a sponsor logo's resize handle in the preview to set
   an explicit `logoSizes[id]`. Download again — that logo should appear at
   the dragged size (the clamp only applies when no explicit size is set).

## Tests

No unit tests added — this is a 1-line size-fallback alignment fix between
two render paths. Visible from a single download verification.

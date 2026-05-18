# burrata-23342 — GPP map markers flicker on every keystroke

**Priority**: P2
**Branch**: `burrata-23342-gpp-map-flicker`

## Problem

On `/gpp`, typing into the signup form (name / email / telegram / city inputs) makes the Molto Benny KML pizzeria markers on the map below flicker on every keystroke.

## Root cause

`GPPLandingPage` re-renders on every keystroke (`setCity` / `setHostName` / `setEmail` / `setTelegram`). `GPPMap` is lazy-loaded but **not memoized**, so it re-renders too. Its container `<div>` JSX gets a fresh inline `style={{ height, width: '100%' }}` object on each render. Google Maps' `KmlLayer` renders the markers as DOM children of that container and is sensitive to the churn — markers flicker as a result.

Props passed to `GPPMap` (`height={500} minZoom={3} maxZoom={12} initialZoom={3}`) are all stable primitives, so wrapping with `React.memo` makes the re-render a no-op.

## Files to modify

`frontend/src/components/GPPMap.tsx` — 3-line change:
1. Add `memo` to the `react` import
2. Rename the inline-default-export function to a named declaration
3. Export `memo(GPPMap)` as default

## Implementation

```diff
-import { useEffect, useRef, useState } from 'react';
+import { memo, useEffect, useRef, useState } from 'react';

 ...

-export default function GPPMap({
+function GPPMap({
   height = 500,
   minZoom = 3,
   maxZoom = 12,
   initialZoom = 3,
 }: GPPMapProps) {
   ...
 }
+
+export default memo(GPPMap);
```

That's the entire change. No other files touched.

## Verification

On the Vercel preview:
1. Open `/gpp`
2. Wait for map to load and KML markers (Molto Benny etc.) to appear
3. Click into the host-name input and type a few characters
4. The pizzeria markers should stay completely still — no flicker, no momentary disappearance
5. Repeat for the email, telegram, and city inputs

## Notes for the implementation agent

- The `lazy(() => import('../components/GPPMap'))` in `GPPLandingPage.tsx` works fine with a memoized default export — no changes needed there.
- Do not change `GPPMap`'s internal logic, only the export wrapping.
- Use relative paths if writing files (worktree-absolute-path memory).
- As step 0, `git checkout -B burrata-23342-gpp-map-flicker origin/master` to make sure you're branched off prod (worktree-branches-from-parent-head memory).

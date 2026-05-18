# forno-79490: AvatarImg retry on transient image load failure

**Priority:** P2
**Branch:** `forno-79490-retry`
**Date diagnosed:** 2026-05-17

## Problem statement

`AvatarImg` in `frontend/src/components/HostsList.tsx` (lines 6-34) renders host
and cohost avatars on the public EventPage and the compact `HostsAvatars`
summary. Today it latches `failed=true` on the FIRST `onError` and shows the
User-icon fallback permanently for the rest of the component's lifetime.

**Observed symptom (2026-05-17):** "Snax Y-Not avatar doesn't render" on the
public EventPage. Verified during debugging:

- API returns a valid `avatar_url`.
- The file at the URL is a valid 18958-byte JPEG.
- `/cdn/<path>` rewrite returns HTTP 200.
- A hard reload sometimes fixes it.

The root cause is a single transient `onError` (Supabase CORS preflight race on
first paint, edge-cache miss, momentary network blip) flipping the latch.

## Root cause

```tsx
const [failed, setFailed] = useState(false);
if (failed) { return <FallbackIcon/>; }
return <img src={cdnUrl(src)} onError={() => setFailed(true)} />;
```

A single `onError` is treated as terminal. There is also no `useEffect` to
reset `failed` when the parent passes a new `src` — so a re-render with a
different avatar keeps the stale fallback.

## Proposed solution (Option A — retry with stable cache-buster, then latch)

Retry up to **2 times** before latching `failed=true`. Use a stable per-retry
token (`?r=1`, `?r=2`) so the Vercel `/cdn/*` edge cache and Supabase edge
cache still absorb the load — never `Date.now()`. Use a small backoff
(500 ms, then 1500 ms) so a true network hiccup has time to clear.

### Pseudocode

```tsx
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500]; // delay BEFORE retry attempt N (0-indexed)

const AvatarImg: React.FC<{...}> = ({ src, alt, className, fallbackClassName, iconClassName, style }) => {
  const [retryCount, setRetryCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimerRef = useRef<number | null>(null);

  // Reset state when src changes (parent passed a new avatar)
  useEffect(() => {
    setRetryCount(0);
    setFailed(false);
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [src]);

  const handleError = () => {
    if (retryCount >= MAX_RETRIES) {
      setFailed(true);
      return;
    }
    const delay = RETRY_DELAYS_MS[retryCount] ?? 1500;
    retryTimerRef.current = window.setTimeout(() => {
      setRetryCount(c => c + 1);
      retryTimerRef.current = null;
    }, delay);
  };

  if (failed) {
    return (
      <div className={fallbackClassName} style={style}>
        <User className={iconClassName} />
      </div>
    );
  }

  // Stable per-retry token: ?r=0 first attempt (omit to keep current behavior),
  // ?r=1, ?r=2 for retries. Caches still hit because the token is stable.
  const base = cdnUrl(src);
  const sep = base.includes('?') ? '&' : '?';
  const finalSrc = retryCount === 0 ? base : `${base}${sep}r=${retryCount}`;

  return (
    <img
      key={retryCount}
      src={finalSrc}
      alt={alt}
      className={className}
      style={style}
      onError={handleError}
    />
  );
};
```

### Why these specific choices

- **`?r=1`, `?r=2` (stable tokens), not `Date.now()`** — Vercel's `/cdn/*` edge
  rewrite passes through query strings; using a per-page-load timestamp would
  bypass the edge cache and hammer Supabase. With `?r=1`/`?r=2`, the second
  user to hit the same flaky path still gets a cache hit. (The first request
  uses no query at all, so the dominant case — first paint succeeded — has
  zero impact on cache keys.)
- **`key={retryCount}`** — when `retryCount` flips from 0→1, React would skip
  the DOM update if the rendered src happens to be byte-identical after the
  query append (it won't, but defensive). Keying on `retryCount` guarantees
  the `<img>` is recreated and the browser re-fetches.
- **`MAX_RETRIES = 2`** — small budget. Total worst-case wait before User icon
  shows: 0 + 500ms + 1500ms = 2 seconds.
- **`useEffect` cleanup** — cancel pending retry timer on unmount or `src`
  change to avoid setting state on an unmounted component.
- **Reset on `src` change** — covers the case where a parent re-renders with
  a new avatar URL. Without this, a previously-latched component would never recover.

### Options considered and rejected

- **Option B — drop the latch entirely, use CSS `:has()` / `image-set()`.**
  More complex, `:has()` browser support still spotty in some embedded
  webviews used by guests opening event links from messengers, and we lose
  the explicit User-icon fallback semantics. Rejected.
- **Option C — single retry on a longer timeout.** Compromise that doesn't
  meaningfully cover the multi-cause transient population. Rejected as inferior to A.

## Files to modify

- `frontend/src/components/HostsList.tsx` — only `AvatarImg` (lines 6-34).
  Add `useEffect`, `useRef`. Update the `useState` import already on line 1.
  No call-site changes — confirmed via grep there are 4 call sites
  (lines 128, 218, 301, 322) all inside this same file.

No backend changes. No DB changes. No new dependencies.

## Confirmed via grep

- `AvatarImg` is used only inside `HostsList.tsx` (4 call sites). No external consumers.
- The other `<img>` references in the file go through `AvatarImg`.
- `cdnUrl()` (`frontend/src/lib/supabase.ts:29`) only rewrites Supabase storage
  URLs to `/cdn/...`; non-matching URLs pass through. Query strings are
  preserved by the Vercel rewrite, so `?r=N` flows to Supabase unchanged.

## Step-by-step implementation

1. Worktree: `git worktree add ../rsvpizza-forno-79490 -b forno-79490-retry origin/master`
2. Open `frontend/src/components/HostsList.tsx`.
3. Update imports on line 1: `import React, { useState, useEffect, useRef } from 'react';`
4. Replace the `AvatarImg` component body (lines 7-34) with the implementation above.
   Keep the prop signature identical so the 4 existing call sites continue to compile unchanged.
5. Add module-level constants `MAX_RETRIES = 2` and `RETRY_DELAYS_MS = [500, 1500]`
   just above the component.
6. Run `cd frontend && npx tsc --noEmit` — must pass clean.
7. Run `cd frontend && npm run lint` (if a lint script exists) — must pass.
8. Commit with task ID in subject:
   `forno-79490: retry transient avatar load failures before latching fallback`
9. Push: `git push -u origin forno-79490-retry`
10. Draft PR via `gh pr create --draft`.
11. Wait for Vercel preview; verify manually (see test plan).

## Verification — manual test plan

Run against the Vercel preview deploy of the PR. Use Chrome DevTools.

**Test 1 — happy path (no regression):**
- Open a public EventPage with a known-good host avatar (e.g., Snax Y-Not).
- Avatar should render on first paint, no retries triggered.
- Network tab: exactly one request to `/cdn/<path>` returning 200. No `?r=` query.

**Test 2 — transient failure recovers (the bug being fixed):**
- Open EventPage with DevTools Network → set to "Offline" briefly.
- Throttle to Offline, reload page so the first avatar request fails.
- Within ~500 ms switch back to Online.
- Expected: avatar appears after first retry (`?r=1` returns 200). User-icon fallback should NOT appear.

**Test 3 — genuinely broken URL still falls back:**
- Mount `AvatarImg` with a nonexistent Supabase path.
- Expected: 3 failed requests (`/cdn/.../nonexistent.jpg`, then `?r=1`, then `?r=2`),
  spaced by ~500ms / ~1500ms. After the final failure, the User-icon fallback renders.
  Total time to fallback: ~2 seconds.

**Test 4 — src change resets the latch:**
- In React DevTools, find a latched `AvatarImg` (after Test 3).
- Change its `src` prop to a known-good URL.
- Expected: component re-renders with the new image, fallback clears, retry count resets to 0.

**Test 5 — unmount during pending retry:**
- Trigger Test 3's first failure (offline reload).
- Within the 500 ms retry delay, navigate away from the EventPage.
- Expected: no console warning about "setState on unmounted component."

## Out of scope

- No loading spinner.
- No global image-error redesign.
- No mirroring to alternate storage.
- No changes outside `AvatarImg`.

## DNS length check

`rsvpizza-git-forno-79490-retry-pizza-dao` = 24 + 17 = 41 chars. Under the 63-char limit. ✓

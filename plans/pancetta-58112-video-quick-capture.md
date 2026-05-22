# pancetta-58112 — VideoQuickCaptureCard in Party Guide

## Goal
Add a "Quick video" capture card to the day-of host dashboard
(`DayOfDashboard`), mirroring the existing `PhotoQuickCaptureCard`.

## Why
Video upload infrastructure exists end-to-end (storage bucket, helper,
backend endpoint accepting video MIME types, gallery Videos tab), but
there is no dedicated entry point in the Party Guide. Hosts can record
short videos on their phone — surfacing this beside the photo card makes
the feature discoverable. Snax confirmed the photo-card mirror approach.

## Out of scope (explicit)
- Backend / Prisma / Supabase migrations / column grants — none needed.
- `EventPage` public CTA — already says "Upload Photos & Videos".
- `PhotoUpload.tsx` / `PhotoGallery` — already video-aware.
- Party-level video toggle — videos use existing `photosEnabled` /
  `photoModeration` gating.
- Refactoring `uploadEventVideo`'s return shape — out of scope.

## Files touched
1. NEW `frontend/src/components/day-of/VideoQuickCaptureCard.tsx`
   — direct mirror of `PhotoQuickCaptureCard.tsx`. Swaps:
   - `uploadEventPhoto` → `uploadEventVideo` (storage helper)
   - `Camera`/`ImagePlus` → `Video`/`Film` icons
   - `accept="image/*"` → `accept="video/*"`
   - Button copy: "Take a Photo" → "Record a Video";
     "Upload from library" → "Upload a video"
   - Adds helper line `≤50MB · ≤5 min · mp4 / webm / mov`
   - Forwards `duration` from upload result to `uploadPhoto` API
     (backend already accepts it)
   - Generic error on `null` upload result: "Upload failed — check size
     (≤50MB) and length (≤5 min)" (precise reason is `console.error`'d
     inside the helper)
2. EDIT `frontend/src/components/day-of/DayOfDashboard.tsx`
   — import + new `<CollapsibleCard id="video-quick-capture" />`
   immediately after `photo-quick-capture` in `rightColumn`.
3. EDIT `frontend/src/components/day-of/index.ts`
   — add named export.

## Verification
- [ ] Vercel preview → host Party Guide → "Quick video" appears under
      "Quick photo" in the right column (desktop) / stacked (mobile).
- [ ] Record a short phone video via "Record a Video" → uploads → shows
      success message; appears in PhotoGallery Videos sub-tab.
- [ ] Upload a >50MB file (or a >5min clip) via "Upload a video" → shows
      "Upload failed — check size (≤50MB) and length (≤5 min)".
- [ ] `npm run typecheck` (frontend) passes.

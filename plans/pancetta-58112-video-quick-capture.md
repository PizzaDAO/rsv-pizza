# pancetta-58112 — Unified "Quick photo or video" card in Party Guide

## Goal
Extend the existing day-of host `PhotoQuickCaptureCard` (in `DayOfDashboard`)
to accept BOTH photos and videos through a single unified CTA, instead of
introducing a separate VideoQuickCaptureCard.

## Why
Video upload infrastructure already exists end-to-end (storage bucket,
`uploadEventVideo` helper, backend endpoint accepting video MIME types and
storing `duration`, gallery Videos sub-tab). The host-side day-of capture
card was photo-only. Snax redirected from the dual-card approach to a
single unified "Upload photo or video" card — the OS-level camera capture
prompt already lets the user choose photo vs video on mobile, so two cards
are unnecessary clutter.

## Out of scope (explicit)
- Backend / Prisma / Supabase migrations / column grants — none needed.
- `EventPage` public CTA — already says "Upload Photos & Videos".
- `PhotoUpload.tsx` / `PhotoGallery` — already video-aware.
- Party-level video toggle — videos use existing `photosEnabled` /
  `photoModeration` gating.
- Refactoring `uploadEventVideo` / `uploadEventPhoto` return shapes.

## Files touched
1. EDIT `frontend/src/components/day-of/PhotoQuickCaptureCard.tsx`
   - Import `uploadEventVideo` alongside `uploadEventPhoto`.
   - Header: "Quick photo" → "Quick photo or video".
   - Primary CTA: "Take a Photo" → "Take photo or video".
   - Secondary CTA: "Upload from library" (unchanged); icon swapped to
     a neutral `Upload`.
   - File inputs: `accept="image/*"` → `accept="image/*,video/*"` on both.
   - `handleFile`: branch on `file.type.startsWith('video/')` and route
     to `uploadEventVideo` (passes `duration`) or `uploadEventPhoto`.
   - Helper line below buttons:
     "Photos up to 10MB · videos up to 50MB and 5 min · mp4/webm/mov".
2. EDIT `frontend/src/components/day-of/DayOfDashboard.tsx`
   - `CollapsibleCard` title "Quick photo" → "Quick photo or video".
3. EDIT `frontend/src/components/day-of/index.ts` — no change vs current
   master (only removes the dropped `VideoQuickCaptureCard` export from
   the prior dual-card commit).

## Verification
- [ ] Vercel preview → host Party Guide → single "Quick photo or video"
      card in right column; both buttons accept photos and videos.
- [ ] Phone capture button → OS prompts photo vs video → both upload.
- [ ] Library button → file picker accepts images and videos.
- [ ] >10MB image OR >50MB video OR >5min clip → constraint-specific
      error message.
- [ ] `npx tsc --noEmit` (frontend) passes.

# salami-58119: Allow HEIC/HEIF/AVIF photo uploads

## Goal
iPhone users upload directly from their photo library (HEIC by default) and modern Android users (AVIF) currently get silently rejected by the event-photos upload path. Expand the MIME allowlist on the photo-only path so library uploads work.

## Scope (photo path only)
- `frontend/src/lib/supabase.ts` → `uploadEventPhoto` allowlist
- `frontend/src/lib/supabase.ts` → `uploadVenuePhoto` allowlist (same bucket)
- `backend/src/routes/photo.routes.ts` → `allowedImageTypes` + error-message copy
- `supabase/migrations/20260525_salami_58119_expand_event_photos_mime_types.sql` → bucket `allowed_mime_types`

## MIMEs added
- `image/heic`
- `image/heif`
- `image/avif`

## Explicitly out of scope
- `uploadEventImage` (event-images bucket — sponsor logos, event covers, description embeds; rendered via `<img>`, HEIC support too patchy for decorative slots)
- `uploadEventVideo` / `event-videos` bucket
- `PhotoUpload.tsx` / `PhotoGallery.tsx` (no UX change)
- Constraint-hint copy (intentionally silent — HEIC/AVIF are an additive allowance)

## Risks
- HEIC `<img>` rendering: Safari handles natively, Chrome/Firefox degrade gracefully (broken thumbnail). Most galleries here are server-thumbnailed (PhotoGallery renders the stored Supabase URL via `<img>`), so non-Safari viewers may see a broken thumbnail until we add server-side transcode. Acceptable trade-off vs. silent reject.
- HEIC playback via `<video>` is far worse, but HEIC is image-only; not in play here.

## Verification
- `npx tsc --noEmit` in frontend — clean.
- `npm run build` in backend — clean.
- Manual: upload HEIC from iPhone Safari → succeeds; AVIF from Chrome → succeeds; JPEG regression → still works; oversized file → still rejected with 10MB error.
- Migration applied via Supabase MCP before merging frontend/backend code (else bucket-level reject overrides app-level allow).

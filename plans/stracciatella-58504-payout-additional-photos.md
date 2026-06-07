# stracciatella-58504 — Default-open additional-photos uploader + preview gallery on /payments

## Context
In the payments/payout submission flow, `EventPhotosCard` shows the three required role
photos (group / box stack / pizza) and, below them, an **"Add more photos (optional)"**
button. Today that button is collapsed by default and reveals only the `PhotoUpload`
dropzone — the host gets no sense of what extra photos already exist for the event.

Snax wants this section to (1) **default to open** and (2) include a **small preview
gallery of the already-uploaded additional photos** with a **"View all" button** that
opens the existing `PhotoModal` lightbox.

## Decisions (from Snax)
- **View all** → opens the existing `PhotoModal` lightbox (self-contained, no navigation away).
- **Scope** → preview shows **additional photos only** = gallery photos NOT designated as one
  of the three payout roles (`payoutRole` null or not in `['group','box_stack','pizza']`).

## Files to change
- `frontend/src/components/payouts/EventPhotosCard.tsx` (primary)
- `frontend/src/i18n/locales/en/host.json` and `de/host.json` (new `payouts.viewAllPhotos` key)

## Implementation — `EventPhotosCard.tsx`
1. **Default the uploader open**: `useState(true)` for `showAdditionalUpload` (was `false`).
   Keep the collapse/expand toggle — `PhotoUpload`'s `onClose` still collapses it, and the
   button still re-opens it.
2. **Reuse the existing fetch**: the mount `useEffect` already calls
   `getPartyPhotos(partyId, { status: 'all', limit: 100 })` to seed role slots but discards
   the list. Lift that into a `loadPhotos` `useCallback`, store the full list in a new
   `galleryPhotos` state (in addition to seeding `roles`), and call it on mount.
3. **Derive additional photos**:
   `const additionalPhotos = galleryPhotos.filter(p => !p.payoutRole || !PAYOUT_ROLES.includes(p.payoutRole as PayoutPhotoRole));`
4. **Preview gallery UI** (render above or just under the uploader, only when
   `additionalPhotos.length > 0`): a row of the first ~4–6 thumbnails (reuse the existing
   thumbnail markup pattern from this file / `RolePhotoPicker` — `img thumbnailUrl||url`,
   `video` for `mimeType` starting `video/`, `aspect-square rounded`). Add a **"View all
   (N)"** button using `t('payouts.viewAllPhotos', { count: additionalPhotos.length })`.
   Clicking a thumbnail OR "View all" sets a `lightboxPhoto` state (thumbnail → that photo;
   View all → `additionalPhotos[0]`).
5. **Lightbox**: render `<PhotoModal photo={lightboxPhoto} photos={additionalPhotos} isHost
   onClose={() => setLightboxPhoto(null)} onNavigate={setLightboxPhoto} />` when
   `lightboxPhoto` is set. (`PhotoModal` already `createPortal`s to body and supports
   prev/next; its mutation callbacks are all optional — omit them for read-only viewing.)
6. **Refresh after upload**: pass `onUploadComplete={() => loadPhotos()}` to `PhotoUpload`
   so newly uploaded additional photos appear in the preview without a page reload.

## i18n
Add to `payouts` in `en/host.json`: `"viewAllPhotos": "View all ({{count}})"` and a German
equivalent in `de/host.json` (`"Alle anzeigen ({{count}})"`). Other locales fall back to en.

## Constraints / gotchas
- Hooks must stay above any early return (this component has none today — keep it that way).
- Don't add a realtime subscription; just refetch on `onUploadComplete`.
- Match existing Tailwind theme tokens (`theme-surface`, `theme-stroke`, `#ff393a`) — no new
  raw colors. Reuse thumbnail markup already in the file rather than inventing new styling.

## Verification
- `cd frontend && npm run build` (tsc + vite) is green.
- On a Vercel preview, open an event's /payments payout flow as host:
  - The additional-photos uploader is expanded by default.
  - If the event has non-role gallery photos, a preview row + "View all (N)" shows.
  - Clicking a thumbnail or "View all" opens the lightbox with prev/next across the
    additional photos.
  - Upload a new photo → it appears in the preview row without reload.
  - Role-designated photos do NOT appear in the additional preview.

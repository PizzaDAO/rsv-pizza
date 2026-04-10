# Photo Year Tagging

## Overview
Let uploaders mark photos with the year they were originally taken, so historical/archival photos display the correct year instead of their upload date.

## How it works
- New nullable `photo_year` integer column on the `photos` table
- When set → display that year. When null → fall back to `createdAt` (current behavior)
- Uploaders can set year at upload time via a dropdown
- Hosts can edit the year on any photo via the PhotoModal detail view

## Key insight
This is on the `photos` table, NOT the `parties` table — so the 6-place `parties` update pattern doesn't apply. The update path is simpler: (1) DB migration, (2) Prisma schema, (3) backend POST, (4) backend PATCH, (5) frontend `Photo` type, (6) frontend `PhotoUploadData` type.

---

## Step-by-step implementation

### 1. Database migration (Supabase MCP — apply FIRST)
```sql
ALTER TABLE photos ADD COLUMN photo_year integer;
CREATE INDEX idx_photos_party_year ON photos (party_id, photo_year);
```

### 2. Prisma schema — `backend/prisma/schema.prisma`
Add to Photo model (after `tags`, ~line 493):
```prisma
photoYear Int? @map("photo_year")
```
Run `npx prisma generate`.

### 3. Backend POST handler — `backend/src/routes/photo.routes.ts`
- Destructure `photoYear` from `req.body` in POST `/:partyId/photos` (~line 275)
- Validate: if provided, must be integer between 1900 and current year + 1
- Include in `prisma.photo.create` data

### 4. Backend PATCH handler — `backend/src/routes/photo.routes.ts`
- Destructure `photoYear` from `req.body` in PATCH `/:partyId/photos/:photoId` (~line 398)
- Allow `null` to clear the year
- Validate same as above when not null
- Add to update data spread

### 5. Frontend `Photo` type — `frontend/src/types.ts`
```typescript
photoYear: number | null;
```

### 6. Frontend `PhotoUploadData` — `frontend/src/lib/api.ts`
```typescript
photoYear?: number;
```
Also update `updatePhoto` data param to accept `photoYear?: number | null`.

### 7. Upload form — `frontend/src/components/photos/PhotoUpload.tsx`
- Add `photoYear` state
- Add a `<select>` dropdown with "Year taken (optional)" placeholder, years from current year down to 2010
- Include in upload payload

### 8. Photo card — `frontend/src/components/photos/PhotoCard.tsx`
Show `photo.photoYear` instead of upload date when set:
```typescript
const displayDate = photo.photoYear ? `${photo.photoYear}` : formatDate(photo.createdAt);
```

### 9. Photo modal — `frontend/src/components/photos/PhotoModal.tsx`
- Display: show year prominently when set (e.g., "2019 (uploaded Jan 15, 2026)")
- Edit: add year edit section for hosts (following caption edit pattern)
- Add `onUpdateYear` prop

### 10. Gallery wiring — `frontend/src/components/photos/PhotoGallery.tsx`
- Add `handleUpdateYear` handler (follow `handleUpdateCaption` pattern)
- Pass `onUpdateYear` to PhotoModal

### 11. (Optional, defer) Year filter in gallery
- Backend: add `year` query param to GET endpoint
- Frontend: add year filter buttons to gallery

---

## Files changed

| File | Change |
|------|--------|
| DB migration (Supabase MCP) | Add `photo_year` column + index |
| `backend/prisma/schema.prisma` | Add `photoYear` to Photo model |
| `backend/src/routes/photo.routes.ts` | Accept `photoYear` in POST + PATCH |
| `frontend/src/types.ts` | Add `photoYear` to Photo interface |
| `frontend/src/lib/api.ts` | Add to `PhotoUploadData`, `updatePhoto` |
| `frontend/src/components/photos/PhotoUpload.tsx` | Year selector on upload form |
| `frontend/src/components/photos/PhotoCard.tsx` | Display year on card |
| `frontend/src/components/photos/PhotoModal.tsx` | Display + edit year |
| `frontend/src/components/photos/PhotoGallery.tsx` | Wire up year update handler |

## Deployment order
1. Supabase migration (nullable column, safe)
2. Backend deploy (`cd backend && vercel --prod`)
3. Frontend (auto via PR merge)

## Migration notes
- Existing photos get `photo_year = null` → display unchanged
- Hosts can retroactively tag old photos via PhotoModal
- No backfill needed

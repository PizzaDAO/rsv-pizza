# Photo Widget Implementation Plan

**Task ID:** diavola-85351
**Priority:** Top
**Status:** Planned

## Overview

The Photo Widget feature allows guests to upload photos from an event, view a gallery, tag photos, and enables hosts to star/feature their favorite photos. This creates a shared memory experience for pizza party attendees.

## 1. Database Schema

### New Prisma Model: `Photo`

```prisma
model Photo {
  id              String    @id @default(uuid()) @db.Uuid
  partyId         String    @map("party_id") @db.Uuid
  party           Party     @relation(fields: [partyId], references: [id], onDelete: Cascade)

  // Upload info
  url             String    // Supabase Storage public URL
  thumbnailUrl    String?   @map("thumbnail_url") // Optional smaller version
  fileName        String    @map("file_name")
  fileSize        Int       @map("file_size") // In bytes
  mimeType        String    @map("mime_type")
  width           Int?
  height          Int?

  // Uploader info (can be guest or anonymous)
  uploadedBy      String?   @map("uploaded_by") // Guest ID if known
  uploaderName    String?   @map("uploader_name") // Display name
  uploaderEmail   String?   @map("uploader_email") // For tracking
  guest           Guest?    @relation(fields: [uploadedBy], references: [id], onDelete: SetNull)

  // Organization
  caption         String?
  tags            String[]  @default([])
  starred         Boolean   @default(false) // Host can star photos
  starredAt       DateTime? @map("starred_at") @db.Timestamptz

  // Metadata
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@index([partyId, createdAt])
  @@index([partyId, starred])
  @@map("photos")
}
```

### Update Party Model

```prisma
model Party {
  // ... existing fields ...

  // Photo settings
  photosEnabled     Boolean   @default(true) @map("photos_enabled")
  photosPublic      Boolean   @default(true) @map("photos_public") // Guests can see all photos

  photos    Photo[]
}
```

## 2. Supabase Storage Setup

### Create Storage Bucket: `event-photos`

**Configuration:**
- Public bucket (for easy sharing)
- Max file size: 10MB
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- File naming: `{partyId}/{timestamp}-{random}.{ext}`

## 3. Backend API Routes

### New File: `backend/src/routes/photo.routes.ts`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/parties/:partyId/photos` | Optional | List all photos for a party |
| POST | `/api/parties/:partyId/photos` | Guest/Host | Upload a new photo |
| GET | `/api/parties/:partyId/photos/:photoId` | Optional | Get single photo details |
| PATCH | `/api/parties/:partyId/photos/:photoId` | Host only | Update photo (caption, tags, starred) |
| DELETE | `/api/parties/:partyId/photos/:photoId` | Host/Uploader | Delete a photo |
| GET | `/api/parties/:partyId/photos/download/:photoId` | Optional | Get signed download URL |

## 4. Frontend Components

### New Components Structure

```
frontend/src/components/photos/
├── PhotoGallery.tsx         # Grid display of photos
├── PhotoUpload.tsx          # Upload modal/dropzone
├── PhotoCard.tsx            # Individual photo tile
├── PhotoModal.tsx           # Full-size photo view
├── PhotoTags.tsx            # Tag input/display
├── PhotoGrid.tsx            # Masonry or grid layout
└── PhotoHostControls.tsx    # Star/delete for hosts
```

### Key Features:
- **PhotoGallery**: Grid/masonry layout, filter by tags/starred/uploader, sort options, lightbox view
- **PhotoUpload**: Drag & drop, multiple file selection, progress indicator, caption/tag input
- **PhotoCard**: Thumbnail, uploader name, star icon (hosts), tags
- **PhotoModal**: Full-size image, navigation, download, edit controls

## 5. Integration Points

### HostPage Integration
Add new tab: **Photos** alongside Settings, Guests, Pizza & Drinks

### EventPage Integration
- Gallery preview (first 4-6 starred photos)
- "View All Photos" link
- "Add Photo" button

### EventDetailsTab Integration
- Enable/disable photo uploads toggle
- Public/private gallery setting

## 6. Implementation Order

### Phase 1: Backend Foundation
1. Create Prisma migration for Photo model
2. Create Supabase Storage bucket `event-photos`
3. Create `photo.routes.ts` with basic CRUD
4. Add photo upload helper in backend

### Phase 2: Frontend Upload
1. Create `PhotoUpload.tsx` component
2. Add upload helper function in `supabase.ts`
3. Create `usePhotoUpload` hook
4. Integrate into HostPage as new tab

### Phase 3: Gallery View
1. Create `PhotoGallery.tsx` component
2. Create `PhotoCard.tsx` component
3. Create `PhotoModal.tsx` for lightbox
4. Add to EventPage for guests

### Phase 4: Host Features
1. Add starring functionality
2. Add tag management
3. Add delete capability
4. Add download functionality

### Phase 5: Polish
1. Add loading states and error handling
2. Add mobile responsiveness
3. Add upload progress indicators

## 7. Verification Steps

- [ ] Photo model created successfully in database
- [ ] Bucket `event-photos` created with correct permissions
- [ ] API endpoints return correct data
- [ ] Upload creates photo record and stores file
- [ ] Host can star/delete photos
- [ ] Gallery displays correctly on mobile and desktop
- [ ] Lightbox navigation works
- [ ] Download provides correct URL

## Critical Files

- `backend/prisma/schema.prisma` - Add Photo model
- `frontend/src/lib/supabase.ts` - Add photo upload functions
- `backend/src/routes/photo.routes.ts` - New API routes
- `frontend/src/pages/HostPage.tsx` - Add Photos tab
- `frontend/src/hooks/useImageUpload.ts` - Pattern to follow

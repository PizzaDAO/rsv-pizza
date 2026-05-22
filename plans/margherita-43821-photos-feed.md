# Plan: Public Photos Feed at `/photos`

**Task ID:** `margherita-43821-photos-feed`
**Branch:** `margherita-43821-photos-feed` (off `origin/master`)

## 1. Problem & Goal

Today there's no way to browse photos and videos across all approved RSV.Pizza/GPP parties — they're only visible on the individual event page galleries. We need a public `/photos` page that aggregates "best of" media globally, latest first, so visitors can discover events at a glance. Host-uploaded media auto-stars on upload (curation by default); guest uploads still require manual starring by the host, preserving the existing moderation model.

## 2. Approach Summary

Add one new public backend endpoint (`GET /api/photos/feed`) that joins `Photo` and `Party` and returns starred+approved photos from approved parties, cursor-paginated by `(createdAt DESC, id DESC)`. Modify `POST /api/parties/:partyId/photos` so when the uploader is the party owner or a co-host with `canEdit:true`, the photo is created with `status='approved'` and `starred:true`. Frontend adds a `PhotosFeedPage` at `/photos` (above the `/:slug` catch-all), with IntersectionObserver-driven infinite scroll over a CSS-column masonry layout, and a click-to-open lightbox modal. A new composite index supports the feed query at scale.

## 3. Backend Changes

### 3.1 photo.routes.ts — auto-star host uploads

Add `optionalAuth` to the `POST /:partyId/photos` route. Use the existing `canUserEditParty(partyId, req.userId, req.userEmail)` helper to detect host uploads and branch `initialStatus` / `initialStarred`:

```ts
router.post('/:partyId/photos', optionalAuth, async (req: AuthRequest, res, next) => {
  // ...existing validation...

  const isHostUpload = await canUserEditParty(partyId, req.userId, req.userEmail);
  const initialStatus = isHostUpload ? 'approved' : 'pending';
  const initialStarred = isHostUpload ? true : false;
  const now = new Date();

  const photo = await prisma.photo.create({
    data: {
      // ...existing fields...
      status: initialStatus,
      starred: initialStarred,
      starredAt: initialStarred ? now : null,
      reviewedAt: isHostUpload ? now : null,
      reviewedBy: isHostUpload ? (req.userId || null) : null,
    },
    include: { guest: { select: { id: true, name: true } } },
  });
  // ...
});
```

### 3.2 photo-feed.routes.ts — new file

```ts
import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database.js';

const router = Router();
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;

function parseCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== 'string' || !raw.includes('_')) return null;
  const sepIdx = raw.lastIndexOf('_');
  const ts = raw.slice(0, sepIdx);
  const id = raw.slice(sepIdx + 1);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime()) || !id) return null;
  return { createdAt: d, id };
}

router.get('/feed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const cursor = parseCursor(req.query.cursor);

    const where: any = {
      starred: true,
      status: 'approved',
      party: {
        is: {
          underbossStatus: 'approved',
          photosPublic: true,
          photosEnabled: true,
        },
      },
    };

    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
      ];
    }

    const rows = await prisma.photo.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true, url: true, thumbnailUrl: true, caption: true,
        mimeType: true, duration: true, width: true, height: true, createdAt: true,
        party: { select: { id: true, name: true, customUrl: true, inviteCode: true, city: true, country: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${page[page.length - 1].createdAt.toISOString()}_${page[page.length - 1].id}`
      : null;

    res.json({
      photos: page.map(p => ({
        id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl,
        caption: p.caption, mimeType: p.mimeType, duration: p.duration,
        width: p.width, height: p.height, createdAt: p.createdAt,
        party: {
          slug: p.party.customUrl || p.party.inviteCode,
          name: p.party.name, city: p.party.city, country: p.party.country,
        },
      })),
      nextCursor,
    });
  } catch (error) { next(error); }
});

export default router;
```

### 3.3 index.ts — mount router

```ts
import photoFeedRoutes from './routes/photo-feed.routes.js';
// ...
app.use('/api/photos', photoFeedRoutes);
app.use('/api/parties', photoRoutes);
```

### 3.4 schema.prisma — index

```prisma
@@index([starred, status, createdAt(sort: Desc), id(sort: Desc)])
```

### 3.5 Migration file content

```sql
CREATE INDEX IF NOT EXISTS "photos_starred_status_created_at_id_idx"
  ON "photos" ("starred", "status", "created_at" DESC, "id" DESC);
```

## 4. Frontend Changes

### 4.1 PhotosFeedPage.tsx — new file

Full source per plan: masonry CSS-column grid, IntersectionObserver infinite scroll, lightbox modal, react-helmet-async, cdnUrl wrapping, video poster + play overlay, Esc-to-close, retry on error, empty/loading skeleton states.

### 4.2 api.ts — add helper

```ts
export interface FeedPhoto {
  id: string; url: string; thumbnailUrl: string | null; caption: string | null;
  mimeType: string; duration: number | null; width: number | null; height: number | null;
  createdAt: string;
  party: { slug: string; name: string; city: string | null; country: string | null };
}
export interface PhotosFeedResponse { photos: FeedPhoto[]; nextCursor: string | null }
export async function getPhotosFeed(cursor: string | null, limit: number = 24): Promise<PhotosFeedResponse | null> {
  try {
    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    params.append('limit', String(limit));
    return await apiRequest<PhotosFeedResponse>(`/api/photos/feed?${params.toString()}`, { method: 'GET', requireAuth: false });
  } catch (e) { console.error('Error fetching photos feed:', e); return null; }
}
```

### 4.3 App.tsx — route

```tsx
import { PhotosFeedPage } from './pages/PhotosFeedPage';
// ...
<Route path="/photos" element={<PhotosFeedPage />} />  // MUST be above /:slug catch-all
```

## 5–10

(Migration applied first via Supabase MCP in prod; then backend ships; then frontend. No backfill. Defer Header nav link. Index, route precedence, body-parser order, co-host canEdit semantics noted as risks.)

# Social Posts Import from X (Twitter)

## Overview

Import social posts from X into the Report widget's social posts section. Posts display as embedded tweets (not plain links). Hosts find posts by searching X for their event URL, then paste URLs into the app.

## Approach

**Manual URL entry + oEmbed for display** (not X API search).

X API v2 search costs $200+/mo — disproportionate to value. Instead:
- Hosts paste tweet URLs (existing flow) or bulk-paste multiple URLs
- Backend calls Twitter's **free oEmbed API** to fetch embed HTML
- Embed HTML cached in DB, rendered on frontend with `widgets.js`
- "Search X" convenience button opens `x.com/search?q=rsv.pizza/{slug}` in a new tab

### View counts
X API v2 Basic tier ($200/mo) exposes `impression_count` via public metrics. Not included in V1 but could be added if we get API access. The oEmbed approach alone does NOT provide view counts.

## Database

### New column on `social_posts`

```sql
ALTER TABLE social_posts ADD COLUMN embed_html TEXT;
```

No new tables. Existing `social_posts` schema is sufficient with this addition.

### Prisma schema change

```prisma
model SocialPost {
  // ... existing fields ...
  embedHtml    String?  @map("embed_html")
}
```

## Backend Routes (`backend/src/routes/report.routes.ts`)

### Modified: POST `/:partyId/report/social-posts`

After receiving URL, if platform is `twitter`:
1. Normalize URL (`x.com` → `twitter.com`)
2. Call `https://publish.twitter.com/oembed?url=...&theme=dark&dnt=true`
3. Extract `author_name` for `authorHandle` (auto-populated)
4. Store `html` response as `embedHtml`
5. oEmbed failure is non-fatal — post still saved without embed

### New: POST `/:partyId/report/social-posts/bulk`

Accepts array of URLs, auto-detects platform, calls oEmbed for twitter URLs, creates all records. Makes it easy to paste multiple URLs at once.

### New: POST `/:partyId/report/social-posts/:id/refresh-embed`

Re-fetches oEmbed HTML for a single post (useful if cached version is stale or failed initially).

## Frontend Components

### New: `report/TweetEmbed.tsx`

Renders cached tweet embed:
- Render `embedHtml` via `dangerouslySetInnerHTML`
- After mount, call `window.twttr.widgets.load()` to activate Twitter widget script
- Fall back to simple link if `embedHtml` not available
- Load `platform.twitter.com/widgets.js` once globally

### Modified: `report/SocialPostsList.tsx`

- **Show tweet embeds** for Twitter posts (replace simple links with `TweetEmbed`)
- **"Search X" button** — opens `x.com/search?q=url%3Arsv.pizza/{slug}` in new tab
- **Bulk URL paste** — textarea mode, one URL per line, submit all at once
- **"Refresh Embed" button** — per-post action to re-fetch oEmbed

### Modified: `report/ReportPreview.tsx`

Render actual tweet embeds in preview/public view instead of plain links.

## Frontend Types (`frontend/src/types.ts`)

```typescript
export interface SocialPost {
  id: string;
  partyId: string;
  platform: 'twitter' | 'farcaster' | 'instagram';
  url: string;
  authorHandle: string | null;
  embedHtml: string | null;  // NEW
  sortOrder: number;
  createdAt: string;
}
```

## Frontend API (`frontend/src/lib/api.ts`)

Add: `bulkAddSocialPosts`, `refreshSocialPostEmbed`

## Files to Create

- `frontend/src/components/report/TweetEmbed.tsx`

## Files to Modify

- `backend/prisma/schema.prisma` — Add `embedHtml` to SocialPost
- `backend/src/routes/report.routes.ts` — oEmbed fetch in POST, bulk + refresh routes
- `frontend/src/types.ts` — Add `embedHtml` to SocialPost
- `frontend/src/lib/api.ts` — Add bulk + refresh API functions
- `frontend/src/components/report/SocialPostsList.tsx` — Embeds, Search X, bulk paste, refresh
- `frontend/src/components/report/ReportPreview.tsx` — Tweet embeds in public view

## Implementation Order

1. DB migration: Add `embed_html` column to `social_posts`
2. Prisma schema: Add `embedHtml` to SocialPost model
3. Backend: Enhance POST handler with oEmbed fetch + auto-extract author
4. Backend: Add bulk + refresh routes
5. Deploy backend
6. Frontend: Update SocialPost type
7. Frontend: Create TweetEmbed component
8. Frontend: Update SocialPostsList (embeds, Search X, bulk paste, refresh)
9. Frontend: Update ReportPreview (tweet embeds in public view)
10. Frontend: Add API functions

## Notes

- **Dark theme**: Pass `theme=dark&dnt=true` to oEmbed API (matches RSVPizza dark UI)
- **x.com vs twitter.com**: Normalize both URL formats in backend
- **Deleted tweets**: oEmbed HTML shows deletion message; refresh button lets hosts detect/remove stale embeds
- **Non-Twitter platforms**: Farcaster/Instagram stay as simple links for now
- **CSP**: May need to allowlist `platform.twitter.com` in Vercel headers
- **Rate limiting**: oEmbed is free but may rate-limit; caching in DB mitigates this

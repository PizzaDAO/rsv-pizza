# TBD-gpp-partners-aggregator: Cross-GPP partner-logo aggregation page + public API

**Priority**: P2
**Type**: Feature
**Branch**: `TBD-gpp-partners-aggregator` (rename when claimed)
**Preview URL**: `https://rsvpizza-git-TBD-gpp-partners-aggregator-pizza-dao.vercel.app/partners`

## Summary

Aggregate every partner across approved GPP 2026 events, deduplicate by logo + normalized name, and expose:

1. **Public JSON API** at `GET /api/gpp/partners` — consumed by globalpizza.party for a logo scroller component.
2. **Public page** at `rsv.pizza/partners` — responsive logo grid using existing `Layout`.

Backend must merge to `master` before any frontend preview works (only master deploys backend). Pattern is a direct sibling of the existing `GET /api/gpp/pizzerias` aggregator (`backend/src/routes/gpp.routes.ts:673-716`) and the `GPPPizzeriasPage`/`EventsMapPage` frontend templates.

## Data model — confirmed from code

### Where partners live

Partners are stored as `Sponsor` rows keyed per party (`backend/prisma/schema.prisma:866-925`, table `sponsors`).
The canonical fields for this feature:

- `id` (uuid)
- `partyId` (uuid, FK → parties)
- `name` (string, required)
- `logoUrl` (string, nullable) — the value we display
- `website` (string, nullable) — where the logo links
- `brandDescription` (string, nullable)
- `brandTwitter`, `brandInstagram` (string, nullable)
- `category` (string, nullable; e.g. "hardware_wallet")
- `status` (string; pipeline: todo, asked, yes, billed, paid, stuck, alum, skip)
- `sortOrder` (int, default 0; per-event display order on flyer logo row)
- `addedByUnderboss` (bool) — whether this row was bulk-added by an underboss

There is **no separate `partners` JSON column on `parties`** and **no join table**. The "partner manager" in /underboss creates a `SponsorUser` (table `sponsor_users`) which then auto-syncs into individual `Sponsor` rows on each tagged party via `backend/src/helpers/partnerSync.ts`. That helper copies `SponsorUser.coHostLogoUrl` → `Sponsor.logoUrl`. **For aggregation, query `Sponsor` directly** — it's already the materialized per-event view.

### GPP scope on `parties`

GPP membership is identified by `Party.eventType === 'gpp'` (string column, line 97 of schema). Year scoping is implicit — there is currently only one active GPP cohort (2026); old events are not re-tagged. If you need explicit year scope later, add a filter on `Party.date` >= Jan 1 2026.

### Approved GPP scoping

Per requirements, approved = `Party.underbossStatus === 'approved'`. Note that the existing `/api/gpp/events` and `/api/gpp/pizzerias` use the looser filter `underbossStatus: { notIn: ['rejected', 'hidden'] }` (which includes `pending`, `approved`, `listed`). **This plan deliberately tightens to `'approved'` only** for the partners aggregator because the marketing site logo wall should only show partners associated with vetted events. Flagged as Open Question 1 below in case product disagrees.

### Sponsor status filter (which sponsors count as "real partners")

Reuse the public-display filter already used by `/api/events/:slug` for the OneSheet sponsor row (`backend/src/routes/event.routes.ts:172-191`):

```
status IN ('yes', 'billed', 'paid') AND logoUrl IS NOT NULL
```

This excludes pipeline-only entries (todo/asked/stuck) and partner placeholders that never sent a logo. **This is a load-bearing filter — do not loosen it without product sign-off.**

### RLS / column-grant concerns

The Feb 2026 SELECT-grant audit revoked table-level SELECT on `parties` for the public role but kept all backend-app access via the service role (the express backend connects via `DATABASE_URL` with full RBAC). This endpoint runs server-side through Prisma; no RLS implications. The endpoint must **not** echo any of the privacy-sensitive columns from `parties` (only `id`, `name`, `customUrl`, `inviteCode` are emitted, all of which are already public).

`party_status_audit` (mentioned in the task brief, allegedly added 2026-05-15 via `pizzaiolo-97053`) does **not yet exist** in the schema/migrations on this branch. The aggregator does not need it — current `underbossStatus` is sufficient. Flagged as Open Question 2.

## Dedupe key

Use a two-stage normalization, applied **server-side in the aggregator** (not in SQL — keep the SQL simple and the dedupe in TypeScript so the rules are visible and testable):

1. **Primary key**: normalized `logoUrl`.
   - Trim, lowercase, strip the leading `https://` / `http://`, strip trailing `/`.
   - Why: when a partner is bulk-added by the same SponsorUser via `partnerSync.ts`, every event gets the *same* `logoUrl` string copied. Logo URL equality is the cleanest near-perfect dedupe in practice.

2. **Secondary key (fallback)**: normalized `name`.
   - `.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')` — the same normalization used for city slugs in `gpp.routes.ts:269-273`.
   - Why: handles the case where two events list the same partner with different logo CDN URLs (e.g. one uploaded to Supabase, one pointing at the partner's own CDN). Same name → same partner.

**Algorithm**: Walk every sponsor row. Compute `logoKey = normalizeUrl(logoUrl)`. If we've already seen that `logoKey`, merge into the existing aggregate (increment `eventCount`, append to `events`, **prefer the first-seen** `website`/`name`/etc.). If `logoKey` is new but `nameKey` matches an existing aggregate, merge into that one too (treat as a name-collision/different-logo case). Otherwise create a new aggregate.

**Tie-break on representative metadata**: when multiple sponsor rows map to the same aggregate but disagree on `name` / `website` / `category`, prefer the value from the row with the lowest `sortOrder` (i.e. most prominently placed on its event's flyer). If still tied, prefer the most-recent `createdAt`. Document this in a comment in the route.

## Backend design

### New endpoint: `GET /api/gpp/partners`

Path: `/api/gpp/partners` — sits alongside `/api/gpp/events` and `/api/gpp/pizzerias`. Mounted via the existing `app.use('/api/gpp', gppRoutes)` line in `backend/src/index.ts:140`. No `index.ts` change needed.

File: `backend/src/routes/gpp.routes.ts` — append a new handler after the `/pizzerias` block (after line 716, before `export default router`).

**No auth required.** No new middleware. Inherits the same global rate limit (500 req / 15 min / IP) applied at `backend/src/index.ts:93`.

### Query strategy

```ts
// pseudocode — implementation must use Prisma, not raw SQL, to match the rest of the file
const sponsors = await prisma.sponsor.findMany({
  where: {
    party: {
      eventType: 'gpp',
      underbossStatus: 'approved',  // strict — see Open Q1
    },
    status: { in: ['yes', 'billed', 'paid'] },
    logoUrl: { not: null },
  },
  select: {
    name: true,
    logoUrl: true,
    website: true,
    brandDescription: true,
    brandTwitter: true,
    brandInstagram: true,
    category: true,
    sortOrder: true,
    createdAt: true,
    party: {
      select: {
        customUrl: true,
        inviteCode: true,
        name: true,  // to derive city via "Global Pizza Party {City}" strip
      },
    },
  },
});
```

Then run the dedupe described above in-memory and emit the response. Expected scale: ~30-50 partners across ~500 events = ~5,000 sponsor rows max. Comfortable for in-memory aggregation; no need for SQL `GROUP BY`.

### Response shape

```json
{
  "partners": [
    {
      "name": "PizzaDAO",
      "logoUrl": "https://...",
      "website": "https://pizzadao.org",
      "brandDescription": "PizzaDAO ...",
      "brandTwitter": "PizzaDAO",
      "brandInstagram": "rare.pizzas",
      "category": "community",
      "eventCount": 423,
      "events": [
        { "slug": "london", "city": "London" },
        { "slug": "saopaulo", "city": "São Paulo" }
      ]
    }
  ],
  "total": 47,
  "generatedAt": "2026-05-15T12:34:56.789Z"
}
```

**Sort order**: `partners` array sorted by `eventCount DESC, name ASC`. The marketing site can re-sort or shuffle; defaulting to popularity gives a good logo scroller out of the box.

**Field decisions, with justification**:

- `eventCount` (yes, include) — lets consumers sort by popularity / sponsor-tier proxy.
- `events: [{slug, city}]` (yes, include) — enables "this partner is in 423 cities including London, São Paulo, ..." copy on the marketing site and on rsv.pizza/partners hover. Keep it minimal — slug + city only, no dates/lat/lng. This keeps the payload small (~50 partners × ~500 events × ~40 bytes ≈ 1 MB worst case; cap individual `events` arrays at 500 to be safe).
- `brandDescription`, `brandTwitter`, `brandInstagram`, `category` (yes, include) — already used by the per-event OneSheet endpoint; marketing site might want hover-cards.
- **Excluded**: `contactEmail`, `contactName`, `contactPhone`, `amount`, `notes`, `status`, `intakeToken` — these are CRM-internal and not surfaced on any current public endpoint. Do not echo them.

### Caching

Add `res.set('Cache-Control', 'public, max-age=600')` — matches the 10-minute cache on `/api/gpp/pizzerias` (line 710). Logos change less often than event metadata, so 10 minutes is plenty. Vercel's edge will honor this automatically.

No in-memory cache layer needed (the route runs on a serverless function with no persistent process to hold one); rely on edge cache.

### Errors

Wrap in the standard `try { ... } catch (err) { next(err); }` pattern used by every other handler in this file. On unexpected error return `500 { error: 'Failed to fetch partners' }`.

## Frontend page

### Route

`/partners` — confirmed available (checked `frontend/src/App.tsx`, no existing route). Add **before** the catch-all `<Route path="/:slug" element={<EventPage />} />` on line 80, e.g. right after the `/map` route on line 53.

```tsx
<Route path="/partners" element={<PartnersPage />} />
```

### Files to create

1. **`frontend/src/pages/PartnersPage.tsx`**

   - Structure modeled on `frontend/src/pages/GPPPizzeriasPage.tsx`: same `Helmet` block (title: "GPP Partners | RSV.Pizza", description: "Brands powering the Global Pizza Party 2026"), same loading/error/retry pattern, same stats badge ("47 partners across 423 cities").
   - Wrap in the standard `<Layout>` from `frontend/src/components/Layout.tsx` (per CLAUDE.md — no new design language). This gives free Header, Footer, GPPClouds, CornerLinks.
   - Body: a responsive CSS grid of logo tiles.
     - `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 p-6 max-w-6xl mx-auto`.
     - Each tile: white/transparent background card (`bg-theme-surface`), `aspect-square`, `flex items-center justify-center`, `p-4`, `rounded-2xl`, `border border-theme-stroke`.
     - Logo: `<img src={partner.logoUrl} alt={partner.name} className="max-w-full max-h-full object-contain" loading="lazy" />`.
     - Wrap each tile in `<a href={partner.website} target="_blank" rel="noopener noreferrer">` **if `partner.website` is non-null**. Otherwise render as a non-interactive `<div>`. (Decision: link out to partner site — most direct value; linking to a filtered events list is interesting but adds scope for a feature that doesn't yet exist.)
     - Below each logo: `partner.name` in `text-xs text-theme-text-faint`, and a small "in N events" badge.

   - States:
     - **Loading**: centered spinner using `Loader2` from `lucide-react`, identical to `GPPPizzeriasPage.tsx:68-77`.
     - **Error**: red error text with Retry button, identical pattern.
     - **Empty** (`partners.length === 0`): centered "No partners yet — check back soon" message. Probably never hit in practice but graceful.

2. **`frontend/src/lib/api.ts`** — add at the end of the GPP section (after `fetchGppEventsForMap`, around line 3320):

   ```ts
   export interface GPPPartner {
     name: string;
     logoUrl: string;
     website: string | null;
     brandDescription: string | null;
     brandTwitter: string | null;
     brandInstagram: string | null;
     category: string | null;
     eventCount: number;
     events: { slug: string; city: string }[];
   }

   export interface GPPPartnersResponse {
     partners: GPPPartner[];
     total: number;
     generatedAt: string;
   }

   export async function fetchGppPartners(): Promise<GPPPartnersResponse> {
     return apiRequest<GPPPartnersResponse>('/api/gpp/partners', { requireAuth: false });
   }
   ```

3. **`frontend/src/App.tsx`** — add the import and route as described above.

### Files NOT to touch

- `backend/prisma/schema.prisma` — no migration needed; all fields exist.
- `backend/src/index.ts` — `gppRoutes` already mounted at `/api/gpp`.
- `frontend/src/components/Layout.tsx` — reuse as-is.
- Any sponsor/partner CRM code — read-only access only.

## CORS / globalpizza.party consumption

### CORS confirmation

Default `ALLOWED_ORIGINS` array in `backend/src/index.ts:55-61` does **NOT** include `https://globalpizza.party` or `https://www.globalpizza.party`. The user's memory says it's already in the env-var-driven list (`process.env.ALLOWED_ORIGINS`) in production. **Verify in Vercel env vars before merging.** If missing, either:

- Add to the env var in Vercel (preferred — no code change), or
- Add `'https://globalpizza.party', 'https://www.globalpizza.party'` to the default array in `index.ts:55-61` as a belt-and-braces fallback (low risk; only affects local dev without the env var set).

The endpoint serves CORS via the existing global `cors()` middleware on line 64, so as long as the origin is in the allowlist, browser `fetch` from globalpizza.party will work with `credentials: false` (no cookie/auth needed — `requireAuth: false`).

### Consumer snippet (for the marketing-site dev)

```js
// On globalpizza.party
const res = await fetch('https://api.rsv.pizza/api/gpp/partners');
const { partners } = await res.json();

// Render a horizontal scroller, biggest sponsors first
const html = partners
  .map(p => `
    <a href="${p.website || '#'}" class="logo-scroller__item"
       target="_blank" rel="noopener" title="${p.name} — in ${p.eventCount} cities">
      <img src="${p.logoUrl}" alt="${p.name}" loading="lazy" />
    </a>
  `)
  .join('');
document.getElementById('partner-scroller').innerHTML = html;
```

That's all the marketing site needs. The 10-minute edge cache means even high traffic on globalpizza.party won't hammer the backend.

## Implementation sequence

1. Backend: add `GET /api/gpp/partners` to `backend/src/routes/gpp.routes.ts`. Commit. Merge to `master` (required — backend only deploys from master). Verify on `https://api.rsv.pizza/api/gpp/partners`.
2. Update the inline API docs HTML in `backend/src/index.ts:160-313` — add a new `<h2>Partners</h2>` block describing the endpoint, query params (none), and example response. Keep style consistent with the existing event/pizzeria docs.
3. Frontend: add `fetchGppPartners` to `lib/api.ts`, create `PartnersPage.tsx`, register route in `App.tsx`. Open PR; preview at `https://rsvpizza-git-{branch}-pizza-dao.vercel.app/partners` (note: will hit production backend, so step 1 must be merged first).
4. Verify CORS from globalpizza.party — coordinate with marketing-site dev to test.

## Resolved with Snax (2026-05-15)

1. **Filter = strict `'approved'`** — not the looser `notIn:['rejected','hidden']` used by other GPP endpoints. This is a curated logo wall; pending/community-listed events don't qualify.
2. **Logo tiles link to `partner.website`** in a new tab (`target="_blank" rel="noopener noreferrer"`). If `website` is null, render the tile as a non-interactive `<div>`.
3. **`globalpizza.party` CORS**: add `'https://globalpizza.party'` AND `'https://www.globalpizza.party'` to the hardcoded fallback array in `backend/src/index.ts:55-61` (belt-and-braces, in addition to whatever's in the Vercel env var).

## Out of scope / open questions

1. **`party_status_audit` table.** Task brief references it as added 2026-05-15 via `pizzaiolo-97053`. Not in current schema/migrations on this branch. Plan does not rely on it. If product wants to filter by "approved AT a specific point in time" (e.g. "approved as of May 1") we'd need this — out of scope for v1.

2. **GPP year scoping.** This plan implicitly scopes to "current GPP cohort" via `eventType === 'gpp'`. If old GPP events from prior years exist in DB and shouldn't surface, add a `date >= 2026-01-01` filter. Need product to confirm DB state.

3. **Sponsor-as-partner vs SponsorUser-as-partner.** This plan queries `sponsors` (the per-event materialization) because `partnerSync.ts` already copies `SponsorUser.coHostLogoUrl` into every `Sponsor.logoUrl`. Alternative would be to query `SponsorUser` directly (smaller, pre-deduplicated, no name-collision worries) and derive `eventCount` by counting parties with the matching tag. **Trade-off**: `SponsorUser`-based approach misses one-off manually-added sponsors (e.g. a local sponsor for just one event); `Sponsor`-based approach captures everything but needs dedupe. Plan picks `Sponsor` for completeness. Reconsider if dedupe edge cases become noisy.

4. **Logo URL normalization edge cases.** If the same partner has both an `https://supabase.../partners/coinbase.png` and an `https://coinbase.com/static/logo.png` floating around different events, normalization on URL alone won't dedupe them. The name-fallback handles this *if* names match exactly post-normalization. If we see real duplicates in production after launch, add a manual override map (`SPONSOR_NAME_ALIASES`) in the route.

5. **i18n.** Page strings ("partners", "in N events", "No partners yet") should ideally use `useTranslation('partner')` like `PartnerManager.tsx` does. Decide whether to add new i18n keys or hard-code English for v1. Hard-coding is fine if the marketing site is English-only.

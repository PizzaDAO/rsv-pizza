# stromboli-71593: Public /leaderboard

## Summary

A new public, anonymous-accessible page at `rsv.pizza/leaderboard` (and `rsv.pizza/gpp/leaderboard` alias) that ranks **approved Global Pizza Party events** by a composite engagement score and aggregates those scores by country. Served by a single new backend endpoint (`GET /api/leaderboard`) computed on-demand from existing tables and cached with `Cache-Control` headers — no DB schema changes, no realtime subscriptions, no precomputed columns.

**Scope is hardcoded to `underbossStatus='approved' AND eventType='gpp'`** — non-GPP events never appear.

## Decisions (with rationale)

### Composite party score formula

```
score =
   1.0 * link_rsvps         (guests with submittedVia in {'link','rsvp','api'}, status != 'INVITED', approved != false)
 + 0.3 * invite_rsvps       (guests with submittedVia = 'invite' that converted, status != 'INVITED', approved != false)
 + 2.0 * check_ins          (guests with checkedInAt IS NOT NULL)
 + 0.5 * photos             (photos.status = 'approved' only; cap 100 per party)
```

Rationale:
- **Link/organic RSVPs weighted 1.0**, **invite RSVPs weighted 0.3** — per `feedback_invite_vs_link_rsvps.md`, link/rsvp/api submissions reflect genuine demand while bulk-imported invites are easy to game.
- **Check-ins are 2x an RSVP** — they prove the party actually happened. This is the strongest anti-gaming signal we have (host must physically scan QR or click in CheckInPage).
- **Photos at 0.5, capped at 100** — proves the party happened and engaged people, but a few prolific uploaders shouldn't dominate (cap prevents one user spamming 500 photos). Only `status='approved'` photos count.
- **Host-submitted guest** (`submittedVia='host'`) is excluded — the host adds themselves automatically so it's not a real signal.
- **Pizza-order count is deliberately excluded** — too few parties use the order integration; it would disproportionately reward instrumented parties over equally-attended ones.

All metrics are computable from existing tables (`guests`, `photos`) — verified against `schema.prisma`. No new columns.

### Country score

`country_score = SUM(party.score)` over all approved parties where `parties.country` matches (case-insensitive, trimmed).

**Normalization**: lowercase + trim before grouping; display the most common original-case spelling per group. Reuse `backend/src/lib/countryCode.ts` (`getCountryCode`, from arrabbiata-42816) to also return ISO-2 code for flag rendering.

Parties with `country IS NULL` are excluded from the country leaderboard but still appear on the party leaderboard. (calzone-71208 backfilled 61 rows; ~4 placeholders remain NULL and that's fine.)

### Tiebreaker

Composite score → check-in count → link-RSVP count → earliest `createdAt` (older event wins, so the board doesn't churn as new events start scoring).

### Time window

Entire board is already GPP-only by eligibility filter. Window control toggles year:
- `?window=all` (default) — all-time GPP events.
- `?window=year` — calendar 2026, by `parties.date`. (No fallback to `createdAt`: GPP parties without a `date` set are excluded from the year view — they're effectively un-scheduled.)

UI exposes a segmented control: **All-time / 2026**.

### Caching strategy

**In-process memory cache, 5-minute TTL**, plus `Cache-Control: public, max-age=300` on the response. Matches the precedent set in `gpp.routes.ts`. Cheap, no infra, automatically per-instance on Vercel serverless.

Worst case: one ~80ms uncached request per cold-started instance every 5 min. Implementation: a `let cache: { data, computedAt }` inside the route module, recomputed when stale or when an explicit `?nocache=1` query param is passed (admin escape hatch).

Rejected alternatives:
- **(a) Compute every request** — ~80ms is acceptable but wasted under load.
- **(b) Materialized view** — overkill for a few hundred rows; needs refresh cron.
- **(d) Precomputed `parties.leaderboard_score` column** — needs schema migration, grants, cron refresh, ties score freshness to cadence. If QPS becomes a problem we graduate to this without API changes.

### Layout

**Tabs** on a single page (Parties / Countries), default to Parties. Tabs match the precedent of `HostPage` and `PartnerDashboardPage`. Single URL keeps SEO/sharing simple; tabs use `?tab=countries` query param so a permalink to the country board works.

### Pagination / display count

- Top 50 parties by default; "Show more" loads 50 more (server respects `?limit=` up to 200, `?offset=`).
- All countries shown by default (~140 distinct values per arrabbiata-42816); single page render is fine.
- Countries with score 0 (no engagement) are hidden.

### Permalink behavior

- `/leaderboard` — main page (Parties tab).
- `/gpp/leaderboard` — alias route, same component, same data. Provides a GPP-namespaced URL for marketing/sharing.
- `/leaderboard?tab=countries` (and `/gpp/leaderboard?tab=countries`) — Countries tab pre-selected.
- Each party row links to `/{customUrl || inviteCode}` (existing public EventPage).
- No `/leaderboard/parties` or `/leaderboard/countries` subroutes — would conflict with the existing `/:slug` catch-all.

## Backend changes

### New endpoint

`GET /api/leaderboard`

**Query params:**
- `window`: `'all' | 'year'` — default `'all'`. (`gpp` is implicit — board is GPP-only.)
- `limit`: number, 1–200, default 50 (parties only).
- `offset`: number, default 0 (parties only).
- `nocache`: any truthy value to bypass memory cache.

**Response shape:**

```json
{
  "window": "all",
  "computedAt": "2026-05-21T16:00:00.000Z",
  "parties": {
    "rows": [
      {
        "rank": 1,
        "id": "uuid",
        "name": "Global Pizza Party Lagos",
        "hostName": "Ada Okeke",
        "city": "Lagos",
        "slug": "lagos",
        "url": "https://rsv.pizza/lagos",
        "country": "Nigeria",
        "countryCode": "NG",
        "eventImageUrl": "...",
        "score": 142.7,
        "breakdown": {
          "linkRsvps": 87,
          "inviteRsvps": 20,
          "checkIns": 18,
          "photos": 24
        }
      }
    ],
    "total": 421,
    "limit": 50,
    "offset": 0
  },
  "countries": {
    "rows": [
      {
        "rank": 1,
        "country": "Nigeria",
        "countryCode": "NG",
        "partyCount": 12,
        "score": 873.4
      }
    ],
    "total": 73
  }
}
```

Both arrays in one response so a single fetch hydrates both tabs.

### Files touched

- `backend/src/routes/leaderboard.routes.ts` — **new**. Single GET handler + cache.
- `backend/src/index.ts` — register `app.use('/api/leaderboard', leaderboardRoutes)` near the other public-prefixed routes, before any `/:slug` catch-alls.
- `backend/src/lib/countryCode.ts` — already exists from arrabbiata-42816; reuse `getCountryCode()`.

**Query strategy** (single Prisma query feeding the aggregator):

```ts
const where = {
  underbossStatus: 'approved',
  eventType: 'gpp',
  ...(window === 'year' && { date: { gte: jan1_2026, lt: jan1_2027 } }),
};

const parties = await prisma.party.findMany({
  where,
  select: {
    id: true, name: true, customUrl: true, inviteCode: true, city: true,
    country: true, eventImageUrl: true, createdAt: true, date: true,
    user: { select: { name: true } },          // for hostName fallback
    hosts: { select: { name: true, hidden: true }, orderBy: { sortOrder: 'asc' } },
    guests: {
      select: { submittedVia: true, status: true, approved: true, checkedInAt: true },
    },
    photos: {
      where: { status: 'approved' },
      select: { id: true },                    // count after fetch (need status filter)
    },
  },
});
```

`hostName` resolution: first non-hidden cohost in `hosts` by `sortOrder`, else `party.user.name`, else `null`. Mirrors how EventPage shows host attribution.

Compute scores in JS (~1000 parties × ~50 guests = 50k objects, sub-100ms). Cache the final result for 5 minutes.

### Migration / schema changes

**None.** All inputs are existing columns:
- `parties.underbossStatus`, `parties.country`, `parties.eventType`, `parties.date`, `parties.createdAt`.
- `guests.submittedVia`, `guests.status`, `guests.approved`, `guests.checkedInAt`.
- `photos.status`.
- `co_hosts.name`, `co_hosts.hidden`, `co_hosts.sortOrder`; `users.name`.

**Column grants**: none needed (no new columns). The endpoint runs as the backend service role; no anon Postgres grants are involved because the API never exposes the DB directly to the browser.

## Frontend changes

### New route

- `frontend/src/pages/LeaderboardPage.tsx` — new page component.
- `frontend/src/App.tsx` — add **two routes** pointing at `LeaderboardPage`, **before** the catch-all `<Route path="/:slug" element={<EventPage />} />`:
  - `<Route path="/leaderboard" element={<LeaderboardPage />} />`
  - `<Route path="/gpp/leaderboard" element={<LeaderboardPage />} />`
  Match the existing comment style ("must come before /:slug") used for `/map`.

### Components

**Reuse:**
- `Layout` — page wrapper (Header + Footer + CornerLinks).
- `Helmet` — title/description for SEO.
- React Router `Link` — row links to event pages.
- `lucide-react` icons (Trophy, MapPin, Loader2).
- Segmented-control pattern from `HostPage` tab bar.
- Loading + error states modeled on `GPPPizzeriasPage`.

**Net-new (justify, local to page):**
- A small `LeaderboardRow` sub-component (event image + rank + name + host name + score + breakdown chip row) — local to `LeaderboardPage.tsx`, not extracted to `components/` until used elsewhere.
- A `<CountryFlag code={countryCode} />` helper using `https://flagcdn.com/{cc}.svg` — local to the page.

### Files touched

- `frontend/src/pages/LeaderboardPage.tsx` — new.
- `frontend/src/App.tsx` — one new route + import.
- `frontend/src/lib/api.ts` — add `fetchLeaderboard(window?, limit?, offset?)` + `LeaderboardResponse`, `LeaderboardPartyRow`, `LeaderboardCountryRow` types. Mirrors `fetchGppEventsForMap` pattern. Uses `apiRequest(..., { requireAuth: false })`.

### CornerLinks / Header surfacing

Optional follow-up (mention but punt): add a "Leaderboard" entry to `Footer` or `CornerLinks`. The feature works without it (direct URL share + SEO), so this is not in the critical path for stromboli-71593.

## Verification checklist

- [ ] Approved-only filter works — set `underbossStatus='pending'` on one event in staging and confirm it disappears.
- [ ] GPP-only filter works — a non-GPP approved event should NOT appear, even with high engagement.
- [ ] Score-0 parties hidden from parties tab.
- [ ] Country sum equals SUM of constituent party scores (unit-test on the in-route aggregator).
- [ ] Host name renders correctly — falls back through co-host → user → null.
- [ ] Both `/leaderboard` and `/gpp/leaderboard` render the same page.
- [ ] Page loads <2s on prod data volume (~1000 approved GPP parties, ~140 countries). Warm hits sub-50ms.
- [ ] Mobile responsive — single column rows below `sm`, tabs collapse to full width.
- [ ] No realtime subscriptions added — grep for `supabase.channel` in the new code must return zero hits.
- [ ] No new DB columns — `git diff backend/prisma/schema.prisma` empty.
- [ ] No CORS regression — `/api/leaderboard` inherits the existing `cors()` middleware.
- [ ] Vercel preview at `https://rsvpizza-git-stromboli-71593-leaderboard-pizza-dao.vercel.app/leaderboard` shows data (because previews share prod backend, the new endpoint must be deployed via `master` before the preview's leaderboard works — per CLAUDE.md).
- [ ] Unit tests in `backend/src/routes/leaderboard.routes.test.ts` cover: weights produce expected score; invite RSVPs weighted at 0.3; photo cap applied; pending parties excluded; non-GPP events excluded; country normalization case-insensitive; window=year filter applied; score-0 parties hidden.

## Resolved decisions (from Snax review 2026-05-21)

1. ✅ Composite weights: `link=1.0, invite=0.3, checkin=2.0, photo=0.5` (pizza_count dropped).
2. ✅ Hide score-0 parties from the parties tab entirely.
3. ✅ "Year" window = calendar 2026 by `parties.date` (no `createdAt` fallback — un-dated GPP events drop from year view).
4. ✅ Dedicated `/gpp/leaderboard` URL alias added alongside `/leaderboard`.
5. ✅ Show host name on each row (co-host first, then `user.name`).
6. ✅ Exclude `submittedVia='host'` from scoring.
7. ✅ Only count `photos.status='approved'`.
8. ✅ Drop pizza/order count from the formula entirely.
9. ✅ Entire leaderboard is GPP-only — `eventType='gpp'` hardcoded into the eligibility filter alongside `underbossStatus='approved'`. Non-GPP parties never appear.

## Out of scope

- Any new DB column or migration (deferred to follow-up if perf becomes an issue).
- Materialized view, cron-refreshed score column.
- Realtime/live-updating leaderboard.
- Surfacing leaderboard rank inside `EventPage` ("this party is #7 worldwide").
- A `/leaderboard/parties/:id` deep link — rows already link to `/{slug}`.
- Authenticated/private leaderboards (host-only views, partner-tag leaderboards).
- Region-level rollup (between country and global).
- Translations (i18n) — English-only at launch, matching `EventsMapPage` precedent.

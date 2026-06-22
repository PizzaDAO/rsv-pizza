# ciabatta-58918 — Filters for /partners (admin/UB only)

## Goal
Add a filter bar to the `/partners` page, visible **only to admin / underboss / graphics-admin** viewers (public continues to see the plain logo wall). Filters:
1. **Search by name** (substring over partner name; also description/socials)
2. **Category** (e.g. `hardware_wallet`, `software_wallet`, `cex`, `blockchain`, `dex`, `community`, ...)
3. **Sort** (most events / A–Z / Z–A / newest)
4. **City / event** (partner sponsored a given city)
5. **Region** (PAYMENTS_REGION_LABELS buckets)
6. **Country**

Filters 1–4 are achievable **frontend-only** with today's payload. Filters 5–6 (**region, country**) require a **backend payload change** because the partner record does not currently carry country/region.

## Current state (verified)
- Page: `frontend/src/pages/PartnersPage.tsx` — loads all partners via `fetchGppPartners()`, renders a responsive logo grid; admins/UB/graphics-admin get a clickable pill → events modal. Role flags already resolved: `roles.isAdmin/isUnderboss/isGraphicsAdmin`, combined as `canClick` (`PartnersPage.tsx:77`). **Reuse `canClick` to gate the filter bar.**
- Route: `frontend/src/App.tsx` — `<Route path="/partners" element={<PartnersPage />} />` (before `/:slug`).
- Type: `GPPPartner` in `frontend/src/lib/api.ts` — `{ name, logoUrl, website, brandDescription, brandTwitter, brandInstagram, category, eventCount, events: { slug; city; sponsorId }[] }`. **No country/region.**
- Backend: `GET /api/gpp/partners` in `backend/src/routes/gpp.routes.ts:1073` — selects `party.{customUrl, inviteCode, name}` only; builds `events[]` as `{ slug, city, sponsorId }`. The `party` model has `country` and `region` (used on /payments: `row.party.country`, `party.region === 'usa'`).
- Reuse patterns from /payments:
  - `frontend/src/components/TriStateFilterDropdown.tsx` — searchable include/exclude dropdown (used for tag/country on /payments).
  - `frontend/src/components/payments-admin/paymentsUrlState.ts` — `filtersToSearchParams` / `searchParamsToFilters` diff-against-defaults URL serialization pattern.
  - `frontend/src/utils/regions.ts` — `PAYMENTS_REGION_LABELS`, country→region mapping (reuse for the region filter).
  - `IconInput` (Search icon) for the search box; `Checkbox` for any toggles.

## Backend change (required for region + country) — must deploy to prod first
In `backend/src/routes/gpp.routes.ts` `/partners` handler:
1. Add to the `party` select: `country: true`, `region: true`.
2. Extend the per-event object pushed into `events[]` to `{ slug, city, sponsorId, country, region }` (both nullable). Update the `Aggregate.events` interface type accordingly.
3. (Optional convenience) Add aggregated distinct sets on the response: `countries: string[]`, `regions: string[]` per partner — or let the frontend derive them from `events[]`. Deriving on the frontend keeps the backend diff minimal; recommend **derive on frontend** to avoid widening the response contract.

> ⚠️ Preview deploys share the prod backend (CLAUDE.md). The new fields must be live on the master backend before the preview branch can filter by them. No DB migration needed — `country`/`region` already exist on `party`. Sequence: merge → backend auto-deploys from master (~1 min) → preview works.

## Frontend changes
1. **`frontend/src/lib/api.ts`** — extend `GPPPartner.events[]` element type to include `country: string | null; region: string | null`.
2. **New `frontend/src/components/PartnersFilterBar.tsx`** (modeled on PayoutsFilterBar, much simpler):
   - `IconInput` search box (Search icon) — substring over name (+ description, twitter, instagram).
   - Category dropdown — options derived from `Array.from(new Set(partners.map(p => p.category).filter(Boolean)))`, single-select `all | <category>`.
   - Sort dropdown — `events_desc` (default, current backend order) | `name_asc` | `name_desc` | `eventcount_asc`.
   - City filter — `TriStateFilterDropdown` (or single-select) over distinct cities from `partners.flatMap(p => p.events.map(e => e.city))`.
   - Region filter — `TriStateFilterDropdown` over `PAYMENTS_REGION_LABELS` keys present in the data.
   - Country filter — `TriStateFilterDropdown` over distinct countries from events.
   - An "active filter count" badge + a Clear-all button (match PayoutsFilterBar UX).
3. **New `frontend/src/pages/partnersUrlState.ts`** — `filtersToSearchParams` / `searchParamsToFilters` (copy the diff-against-defaults approach from `paymentsUrlState.ts`). Persist: `q`, `category`, `sort`, `city`, `regionInc/regionExc`, `countryInc/countryExc`.
4. **`PartnersPage.tsx`** wiring:
   - Add `const [searchParams, setSearchParams] = useSearchParams()`; lazy-init a `filters` state from URL via a `useRef` captured once on mount (PaymentsAdminPage pattern). Sync `filters → setSearchParams(..., { replace: true })`.
   - Compute `visiblePartners = useMemo(...)` applying search + category + city/region/country include/exclude, then sort. A partner matches a city/region/country filter if **any** of its `events[]` matches (include) and **no** event matches an exclude.
   - Render `<PartnersFilterBar .../>` **only when `canClick`**; render the grid over `visiblePartners`. Update the header count (`uniqueEventCount` / partner count) to reflect the filtered set, or show "X of Y partners".
   - Empty-state message when filters match nothing.

## Out of scope (note, don't silently drop)
- Saved views (`SavedViewsMenu`) — could be added later (scope `'partners'`); not in this pass unless requested.
- Public-facing filters — explicitly admin/UB-only per decision.

## Testing / verification
- Local: load `/partners` as admin → filter bar visible; as logged-out → no filter bar, plain grid.
- Search narrows by name; category/city/region/country narrow correctly (any-event match semantics); sort reorders; Clear resets; URL reflects state and survives refresh/share.
- Confirm region/country only populate after the backend field addition is deployed (or test against local backend).

## Sequencing
1. Branch `ciabatta-58918-partners-filters` off `origin/master` (worktree).
2. Backend payload change + frontend changes in one PR (frontend gracefully treats missing country/region as null until backend deploys).
3. Merge → backend auto-deploys from master → verify on preview/prod.

## Files
- `backend/src/routes/gpp.routes.ts` (partners handler)
- `frontend/src/lib/api.ts` (GPPPartner type)
- `frontend/src/pages/PartnersPage.tsx`
- `frontend/src/components/PartnersFilterBar.tsx` (new)
- `frontend/src/pages/partnersUrlState.ts` (new)
- Reuse: `TriStateFilterDropdown.tsx`, `utils/regions.ts`, `IconInput`, `Checkbox`

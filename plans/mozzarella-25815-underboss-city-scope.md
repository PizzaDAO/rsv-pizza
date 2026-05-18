# mozzarella-25815 — Scope underboss access to specific cities

## Goal
Let admins scope an underboss (UB) to a specific set of cities, in addition to
or in lieu of regions. Region-only UBs keep current behavior; city-scoped UBs
see only their cities; mixed-scope UBs see the union (additive).

## Decisions
1. **City key format:** `lower(trim(city_name))` — same as `city_statuses.city_key`.
2. **No `parties.city_key` column.** Use Prisma `name: { contains: 'Global Pizza Party ' + cityName, mode: 'insensitive' }`.
3. **Cities are additive to regions** — UB matches if event.region ∈ regions OR `cityKeyFromName(event.name)` ∈ cities.
4. **Cities tab is strict** — non-admin UB with cities-only sees only those cities; mixed-scope UB sees region-implicit + explicit cities.
5. **No backfill of existing UBs** — they remain region-only until an admin edits.
6. **`partyAccess.ts` tightened** — `canUserEditParty` and `canUserAccessTab` now require scope match (not just `isUnderboss(email)`).

## Implementation summary

### Database
- New migration: `supabase/migrations/20260518_underboss_cities.sql`
  - Adds `underbosses.cities TEXT[] NOT NULL DEFAULT '{}'` + GIN index.
  - Service-role only — no column-level grant needed.

### Backend
- `backend/prisma/schema.prisma` — added `cities String[] @default([])` to `Underboss` model.
- `backend/src/helpers/underbossScope.ts` (new) — `UnderbossScope`, `cityKeyFromPartyName`, `getUnderbossScope`, `partyMatchesScope`, `buildScopedWhereClause`.
- `backend/src/middleware/underbossAuth.ts` (new) — extracted shared `requireUnderbossAuth` middleware. Authorizes when UB has at least one region OR city.
- `backend/src/helpers/partyAccess.ts` — `canUserEditParty` and `canUserAccessTab` now check `partyMatchesScope(party, scope)` rather than just `isUnderboss`.
- `backend/src/routes/underboss.routes.ts` — all 17 affected endpoints updated:
  - `GET /me` — returns `cities`.
  - `GET /:region`, `/:region/events`, `/:region/events/:partyId`, `/:region/stats` — replaced region-only `whereClause` with `buildScopedWhereClause`. Single-event endpoint returns 404 (not 403) for out-of-scope to avoid existence leak.
  - `PATCH /events/bulk-status`, `DELETE /events/bulk-delete`, `PATCH /events/bulk-event-tags` — reject with `{ error: 'OUT_OF_SCOPE', outOfScopeIds }` if any partyId is outside scope.
  - `PATCH /event/:partyId/host-status`, `/status` (underboss branch), `/tags`, `/expected-guests`, `/notes` — call `assertPartyInScope` first.
  - `PATCH /city-statuses` — city-only UBs can update only their cities; region-only UBs allowed (city→region mapping lives in the sheet, not the backend).
  - `POST /admin/create` — accepts `cities[]`; requires regions or cities; backfills co-host on matching events.
  - `PATCH /admin/:id` — accepts `cities[]`; mirrors region-diff co-host sync for cities (additive: only removes co-host when no remaining scope still matches).
  - `GET /admin/list` — includes `cities`.
  - `POST /admin/backfill-cohosts` — matches events via `partyMatchesScope` instead of region-only.
  - `GET /funnel-stats` — scope filter includes both regions and cities.
- `backend/src/routes/telegram.routes.ts` — removed duplicate middleware (now imports shared); `POST /broadcast` rejects with 400 if any group is outside the UB's city scope (region-only UBs are permitted all groups per v1).

### Frontend
- `frontend/src/lib/api.ts` — `createUnderboss`/`updateUnderboss` accept `cities?: string[]`; `UnderbossMeResponse` includes `cities`.
- `frontend/src/types.ts` — `UnderbossAdmin.cities` added.
- `frontend/src/components/underboss/CityScopePicker.tsx` (new) — searchable multi-select chip picker sourced from `fetchSheetCities()`.
- `frontend/src/components/underboss/index.ts` — exports `CityScopePicker`.
- `frontend/src/components/underboss/CitiesTable.tsx` — strict city-only filter for cities-only UBs.
- `frontend/src/pages/UnderbossDashboard.tsx` — access gate accepts cities-only UBs; new Cities filter pill; add-UB modal includes `CityScopePicker`.
- `frontend/src/pages/AdminPage.tsx` — create form + per-row edit include `CityScopePicker`; scope display shows `+ N cities` summary.
- `frontend/src/i18n/locales/en/admin.json` — added strings ("Cities", "Search cities…", etc.).

## Critical sequencing (incident context)
- 2026-05-17 `arugula-38633` outage: Prisma schema merged before DB column existed → 500s.
- **MUST apply the migration to production BEFORE merging the PR.** Migration file is committed for repo history, but the actual DB ALTER must be run via `mcp__supabase-pizzadao__apply_migration` (or Dashboard SQL editor) before the backend deploys from master tip.

## Verification (manual)
- Login as a test UB with `cities=['Lagos','Ibadan']`, no regions:
  - Events list shows only "Global Pizza Party Lagos" and "Global Pizza Party Ibadan".
  - Cities tab shows only those two cities.
  - PATCHing host-status on an event outside scope returns 404.
  - Telegram broadcast to a non-Lagos/Ibadan group returns 400 OUT_OF_SCOPE.
- Login as a mixed-scope UB (regions=['usa'], cities=['Tokyo']):
  - Sees all USA events + Tokyo GPP event.
  - Cities tab shows USA cities + Tokyo.
- Login as a region-only UB: behavior unchanged from before.
- Admin create + edit modals: cities multi-select works, scope summary updates.

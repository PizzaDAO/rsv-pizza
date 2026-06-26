# rigatoni-58919 — "side" (PizzaDAO conference side-event) create flow

Clone-and-adapt of the GPP27 create flow for PizzaDAO conference **side events** at
`rsv.pizza/side`. Admin/UB-gated, hidden behind a `SIDE_PUBLIC` env flag until launch.

## What a "side" event is (vs GPP)
- **NOT city-based.** Host enters the event's own **name**, **date + start/end time**,
  and **venue** (LocationAutocomplete). The public slug is derived from the **event name**
  (`slugFromName`, same NFD/lowercase/alphanumeric normalization as GPP's `citySlugFromCityName`),
  with a numeric `-2`, `-3`… suffix on collision.
- **Full payout machinery kept** (cap, receipts, payouts) but **NO city tiers** — the
  reimbursement cap is admin/UB-set in the form, clamped to the configured ceiling
  (`private.reimbursement_tiers.ceilingUsd`, fallback **625**). GPP's budget-suggestion /
  tier helpers were NOT cloned.
- **Admin/UB-gated** create (`assertSideAuthorized`) + **`SIDE_PUBLIC`** launch env
  (`isSidePublic()` → `process.env.SIDE_PUBLIC === 'true'`).
- **Side-specific agreement** in a new `side_agreement_clauses` table (mirror of
  `gpp_agreement_clauses`), same acknowledgment flow.

## Files created
- `backend/src/helpers/side.ts` — `SIDE_TAG='side-prelaunch'`, `isSidePublic()`,
  `slugFromName()`, `isSideHidden()`, `assertSideAuthorized()` (throws `SIDE_FORBIDDEN`).
  No tier/year/computeReimbursementCap helpers.
- `backend/src/routes/side.routes.ts` — `/api/side` endpoints:
  `GET /agreement`, `POST /events`, `PATCH /parties/:id/budget`,
  `POST /parties/:id/agreement/accept`, `GET /parties/:id/publish-status`,
  `POST /parties/:id/publish`. All `requireAuth` + `assertSideAuthorized`.
  Scope `region`/`city` are inferred from the venue's country/countryCode
  (side events aren't city-based, so `city` is set to the country surrogate).
- `backend/prisma/migrations/20260622000000_add_side_agreement_clauses/migration.sql` —
  CREATE TABLE + index + 3 placeholder v1.0 seed clauses (code-of-conduct,
  reimbursement-rules, hosting-requirements; markdown bullets + bold; requires_ack true).
  Final copy is DB-editable.
- `frontend/src/pages/SideCreatePage.tsx` — 2-step wizard (Details → Review & confirm),
  **standard dark theme** via `Layout` (no GPP clouds/confetti). Step 1: name, host name,
  email, telegram, venue (LocationAutocomplete), date + start/end time, TimezonePickerInput.
  Step 2: admin/UB cap (IconInput) + agreement clauses (reused `renderClauseBody`/`renderInline`)
  + publish gates. Reuses GPP admin/UB gate effect. Only reusable components, placeholders not labels.

## Files modified (minimal shared-file edits)
- `backend/src/index.ts` — import + mount `sideRoutes` at `/api/side`.
- `backend/src/lib/eventTags.ts` — add `'side-prelaunch'` to `INTERNAL_EVENT_TAGS`
  (the public `'side'` taxonomy tag stays public).
- `backend/src/routes/event.routes.ts` — import `isSideHidden`; add a parallel hide-gate
  after the GPP block so a tagged-but-unpublished side event 404s for non-admin/out-of-scope
  viewers while `SIDE_PUBLIC !== 'true'`. Side events resolve via the NORMAL customUrl/inviteCode
  lookup (no `?year=`), so only the gate was added.
- `backend/prisma/schema.prisma` — add `SideAgreementClause` model (mirror of `GppAgreementClause`,
  `@@map("side_agreement_clauses")`).
- `frontend/src/lib/api.ts` — `fetchSideAgreement`, `createSideEvent`, `patchSideBudget`,
  `acceptSideAgreement`, `fetchSidePublishStatus`, `publishSideEvent` + `Side*` interfaces.
- `frontend/src/App.tsx` — import + `<Route path="/side" element={<SideCreatePage />} />`
  (before the `/:slug` catch-all).

## POST /api/side/events request body
```jsonc
{
  "name": "PizzaDAO @ Devcon",        // required → event name + slug source
  "hostName": "Jane Host",            // required
  "email": "jane@example.com",        // required
  "telegram": "@janehost",            // required
  "timezone": "America/New_York",     // optional, default America/New_York
  "date": "2027-05-20",               // optional YYYY-MM-DD (event-local)
  "startTime": "18:00",               // optional HH:MM 24h
  "endTime": "21:00",                 // optional HH:MM 24h (default = start + 3h)
  "formattedName": "Venue, City, US", // optional (venue) — from LocationAutocomplete
  "lat": 40.0, "lng": -74.0,          // optional
  "country": "United States",         // optional → drives region/scope
  "countryCode": "US",                // optional → drives region/scope
  "reimbursementCapUsd": 500,         // optional, clamped to ceiling (else 0/pending)
  "agreementVersion": "1.0",          // required
  "acceptedClauseIds": ["<uuid>"]     // required (all requiresAck clauses)
}
```
Response: `{ success, event:{id,name,inviteCode,customUrl,city,region}, eventPageUrl, hostPageUrl }`.

## Launch / deploy notes
- Run the migration in prod BEFORE merging the Prisma schema change (backend auto-deploys
  from master quickly). The created table + seed clauses must exist before `/api/side/*` runs.
- Set `SIDE_PUBLIC=true` (backend env) + redeploy to make side events public at launch.
- EventPage badge intentionally skipped — side events use the standard dark theme.

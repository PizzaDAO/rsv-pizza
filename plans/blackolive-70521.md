# blackolive-70521: Add event tags

**Priority:** P2. **Spec in TASKS.md:** none beyond "add event tags".
**Planned against:** `origin/master` @ `0d40c24f` (2026-11-17).

---

## Decisions (Snax, 2026-11-18)

1. **Public host tags** (option 1): host-chosen, guest-visible "what kind of party is this" tags.
2. **Curated list**, the starter list in Step 1 as written (20 keys). Hosts can't type their own.
3. **Max 5 per event.**
4. **Who can set them:** owner, full co-hosts, and restricted co-hosts whose `allowedTabs` includes `details`.
5. **Admin/underboss override:** a later phase (Phase 2), not v1.
6. **One global list for v1.** Per-series vocabularies come later (Phase 3).
7. **Phase 0 (host `event_tags` lockdown): DONE**, shipped in #1349 and #1368.

v1 shipped as one PR (backend + frontend together; the prod column must be applied first, see
"Migration + anon exposure"). Not in v1: the AI assistant `labels` field (the assistant's patches
are applied client-side through `updateParty`, so it needs its own pass), `/map`, SeriesLandingPage
chips, `/underboss` column, create-flow picker.

---

## Goal

Hosts can label their event with a few tags from a fixed, translated list. The tags:
- show as chips on the public event page;
- can be filtered on `/events` (search), `/map`, `/map/all` and series landing pages;
- can be counted in admin and sponsor reporting ("38 family-friendly parties in 12 countries").

Ship the smallest useful slice first: data plus host editor plus event-page chips plus the
`/events` filter.

## What already exists (important: do not build on top of it blindly)

- **`parties.event_tags text[]`** (Prisma `eventTags`, `schema.prisma:130`) plus **`parties.event_type`**.
  This column is heavily used as an **admin/system control channel**. Its consumers:
  - partner auto-co-host sync and partner dashboards/reports
    (`helpers/partnerSync.ts`, `sponsor-user.routes.ts`, `report.routes.ts`, `consolidatedReport.ts`,
    `photo-feed.routes.ts`, `PartnerCitiesFlyer.tsx`);
  - payouts state (`go`, `prepay`, `paid`, `missed`, `refund`, `nonhub`, `nonpres`, numeric `200`,
    `k40` caps; see `admin-payout.routes.ts`, `helpers/reimbursementCap.ts`, `services/refundTag.ts`);
  - fraud (`possible-scam`; see `hostTrust`, `hostTrackRecord`);
  - pre-launch gates (`gpp2027`, `side-prelaunch`; see `helpers/gpp27.ts`, `helpers/side.ts`,
    `helpers/eventVisibility.ts`);
  - behaviour switches (`swc*`, `ethconf`, regional opt-in A/B in `useRSVPForm.ts` and
    `optinAbRegions.ts`, `RsvpCheckboxList` required_tags, `avax` flyer template, `PrintTab` SWC
    assets, `StandWithCryptoCard`, `reimbursementOptions` tag rules);
  - series stamping (`EventSeries.publicTags` is copied into `event_tags` on create, see
    `party.routes.ts:356` and `gpp.routes.ts:371`).
- `backend/src/lib/eventTags.ts` and `frontend/src/lib/eventTags.ts` hold the
  `INTERNAL_EVENT_TAGS` / `publicTags()` filter, applied at public payload boundaries.
  Note: the frontend copy is missing `side-prelaunch`; the backend copy is missing the `k\d+` pattern.
- Admin tag UIs already exist:
  - `/underboss` EventTable tri-state tag filter, bulk add/remove, inline pill (`EventRow.tsx`);
  - `/payments` tag filter and custom tags (`PayoutsFilterBar`, `PayoutsByPartyTable`, `PayoutReviewModal`);
  - `/map` moderator tag filter (`EventsMapPage.tsx:44,154`).
- `parties.host_tags jsonb` is a **dead** underboss column (pepperoni-93577 moved the inline pill
  to `event_tags`). It is anon-sensitive. **Do not reuse it.**
- There is **no host-facing tag UI**. `event_tags` is never rendered on the public event page.
  The AI event assistant (`eventEditSchema.ts:277`) can edit `event_tags`. The host Payments
  tab writes `prepay` into it (`PrepayCheckbox.tsx`).
- Discovery surfaces:
  - `/events` (`EventsSearchPage.tsx` + `utils/eventSearch.ts`, client-side filtering over
    `/api/gpp/events?curated=1`, or `/api/series/:slug/events` on brand builds);
  - `/map`, `/map/all`, `/map/swc` (`/api/gpp/events`);
  - `SeriesLandingPage` (`/api/series/:slug/events`).
  All of them list only GPP/series events. There is no general "all parties" discovery.
- Prior plans: `plans/slice-63335-underboss-tag-filter.md` and
  `plans/pepperoni-93577-inline-tag-pill-fix.md`, both admin `event_tags`. Nothing host-facing.

**Conclusion:** host tags must **not** go into `event_tags`. Mixing host-writable labels into a
column that drives payouts, partner reports and RSVP behaviour is exactly the class of bug
pepperoni-93577 hit, and it would let hosts flip control switches.

## Approach (recommended)

### Data model: new column, curated keys

- New column **`parties.labels text[] NOT NULL DEFAULT '{}'`**. Prisma name `labels`, `@map("labels")`.
  The UI calls them "Tags". The code uses "labels" so nobody confuses them with `event_tags`.
  - Alternative names: `topics`, `party_tags`. Avoid anything containing `tag` alone. `host_tags`
    is already taken (dead).
- Values are **stable lowercase slug keys** from a curated list (e.g. `family-friendly`). Display
  text comes from i18n, so tags translate and stay filterable across locales.
- Normalization happens on the server. For each value: trim, lowercase, then drop it if it's not
  in the allowlist. Then dedupe, keep the allowlist order (stable display), and cap at
  **5**. Unknown keys are dropped silently (so an old client never 400s the whole save). Over
  the limit returns 400 `VALIDATION_ERROR`.
- **GIN index** `idx_parties_labels_gin ON parties USING gin (labels)`, for later server-side
  `labels @> ARRAY[...]` filters. Cheap and additive.
- Starter allowlist (Snax to edit; keys are final once shipped, because renaming means a
  data migration):
  `family-friendly, kid-friendly, all-ages, 21-plus, outdoor, live-music, dj, workshop, talks,
  networking, hackathon, meetup, students, women-in-web3, vegan-options, gluten-free-options,
  free, wheelchair-accessible, art, gaming`.
- **Single source of truth:** `shared` code is not used across frontend and backend today
  (`eventTags.ts` is mirrored by hand). Follow that precedent:
  - `backend/src/lib/eventLabels.ts` exports `EVENT_LABEL_KEYS`, `MAX_EVENT_LABELS = 5` and
    `normalizeLabels()`;
  - `frontend/src/lib/eventLabels.ts` mirrors the keys plus an optional lucide icon per key;
  - a test on each side asserts the key list matches a JSON fixture (copy the pattern used by
    `scripts/parties-anon-columns.json` vs `SAFE_PARTY_COLUMNS`). Simplest version:
    `scripts/event-labels.json`, read by both tests.

**Alternatives considered:**
- *Free-form host tags in `event_tags` plus host write allowlist*: rejected. It collides with
  the control channel, can't be translated, invites spam and slurs on public pages, and
  fragments filters (`vegan` / `Vegan` / `vegan-friendly`).
- *Free-form in a new column*: needs moderation, can't be translated, and makes filter
  dropdowns with 400 one-off values. It could be added later as "custom tag (admin-approved)"
  if wanted.
- *Both curated and free-form*: same issues; defer.
- *Separate `tags` + `party_tags` join tables*: over-built for about 20 static keys. A `text[]`
  plus allowlist matches the existing `event_tags` / `available_toppings` pattern and Prisma
  `has` / `hasSome`.
- *Per-series allowlist in DB now*: defer to Phase 3. Add `event_series.label_keys text[]`
  only if Snax wants brand vocabularies.

### Who can set them

- **Host (owner)**, **full co-hosts**, and **restricted co-hosts whose `allowedTabs` includes
  `details`**. Super admins are covered via `canUserEditParty`.
  - Today the generic PATCH only checks `canUserEditParty`, not tab permissions. For `labels`,
    add an explicit check: if `labels !== undefined`, require
    `canUserAccessTab(id, email, userId, 'details')` (`helpers/partyAccess.ts:142`). If it
    fails, drop the field silently, mirroring `taxFormRequired`, so the rest of the save still
    succeeds. Don't 403 the whole PATCH.
- **Admins/underbosses (Phase 2):** a read-only chip column, plus a filter in `/underboss`
  EventTable using the existing tri-state filter pattern. Editing is via the event's host view
  (they already have edit access via `canUserEditParty` / underboss scope). No new admin write
  endpoint in v1.
- **AI event assistant:** add `labels` to `eventEditSchema.ts` as a `string[]` field whose
  description lists the allowed keys. `validatePatch` runs `normalizeLabels`. This also keeps
  crust-55886 (natural-language edits) consistent. Small; v1 is fine, or Phase 2.

### API changes (backend)

1. `schema.prisma` (Party): `labels String[] @default([]) @map("labels")`, next to
   `eventTags` with a comment pointing to this plan.
2. `party.routes.ts` PATCH `/:id`: destructure `labels`, run the tab check, set
   `labels: normalizeLabels(labels)` in the update `data`, and validate the max (400).
3. Party create endpoints (`party.routes.ts` POST, `gpp.routes.ts`, `gpp27.routes.ts`,
   `side.routes.ts`, `lib/brandCreate.ts`): **no change in v1**. Tags are set after creation
   from the details tab. Phase 2 adds an optional picker on NewEventPage.
4. Public payloads, adding `labels` to the select and the response:
   - `event.routes.ts` public event (`select` around `:94`, response around `:386`), consumed
     by `EventPage` via `getEventBySlug`;
   - `gpp.routes.ts` `gppEventSelect` (`:536`) plus `formatGppEvent`, consumed by `/events`
     and the maps;
   - `series.routes.ts` `GET /:slug/events`, consumed by brand `/events` and SeriesLandingPage.
   No `publicTags()`-style filtering is needed: every key is public by construction.
5. Optional (Phase 2): `GET /api/gpp/events?labels=a,b` filters server-side with
   `labels: { hasEvery: [...] }`. v1 filters client-side, like the rest of `/events`, so this
   isn't needed yet.
6. Host editor view `GET /api/parties/:id` already returns all columns (findUnique without
   select), so `labels` arrives automatically.

### Migration + anon exposure (ordering matters)

New folder `backend/prisma/migrations/20261118_party_labels/migration.sql` (bump the date to
the day of implementation):

```sql
-- blackolive-70521: host-chosen public event tags (curated keys). Distinct from event_tags
-- (admin/system control channel). Additive. NOT applied by the PR: apply to prod BEFORE merging
-- (backend/scripts/apply-party-labels.cjs).
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "labels" TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "idx_parties_labels_gin" ON "parties" USING GIN ("labels");
GRANT SELECT ("labels") ON "parties" TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
```

- Add `backend/scripts/apply-party-labels.cjs` (copy `apply-parties-has-password.cjs`:
  dry-run by default, `--apply`, verifies via `information_schema`).
- **Apply to prod BEFORE merging** (CLAUDE.md, incident arugula-38633). Prisma SELECTs every
  declared field, so merging `schema.prisma` first 500s every Party query. Preview deploys
  share the prod DB and backend, so preview testing also needs the column applied first.
  The backend endpoints won't be live on preview until master deploys anyway; see Verify.
  CI `migrations-applied.yml` and `schema-drift.yml` will fail the PR until it's applied. That
  is expected and a useful gate.
- **Anon:**
  - The column is public by design. Grant it (in the migration) so the CI check stays green
    whether or not the column-lockdown is live.
  - Add `labels` to `SAFE_PARTY_COLUMNS` (`frontend/src/lib/supabase.ts:1069`) **and**
    `scripts/parties-anon-columns.json`, **only after the GRANT is in prod**. The CI
    `rls-anon-exposure.yml` check fails otherwise, and every anon party read would 42501.
    Needed because RSVPPage and the host `PizzaContext` load parties directly from Supabase
    with SAFE_PARTY_COLUMNS.
  - Do **not** add it to `anon-sensitive-columns.json`. The name doesn't match C3 sensitive
    patterns (email/wallet/token/...), so no allowlist entry is needed.
- No realtime publication change. No RLS policy change (parties' existing policies cover it).
- Map the field in the frontend types: `DbParty.labels?: string[]`, `Party.labels: string[]`
  in `types` and in the `PizzaContext` `dbPartyToParty` mapper, `updateParty()` `labels`
  passthrough (`supabase.ts:2219`, sends `labels` to PATCH), `PublicEvent.labels`,
  `GPPEventMapItem.labels`, `SearchableEvent.labels`, `PublicSeriesEvent.labels`.
  Also update `frontend/src/__tests__/field-sync.test.ts`.

### UI

**Host editing (v1):** in `EventDetailsTab.tsx`, inside the "Options" section, add a "Tags"
row: a wrap of toggle chips, one per allowed key (icon plus translated label), selected state
styled with theme classes. Clicking toggles. Disable unselected chips at 5 and show helper text
(`text-xs text-white/40`) "Pick up to 5". This is chip buttons, not an input, so the
IconInput/Checkbox rules don't apply, and there's no `<label>` above the field (CLAUDE.md
placeholder rule). Saves via the tab's existing `updateParty` save flow (`:381`). Extract it as
`components/EventLabelPicker.tsx` so Phase 2 can reuse it on NewEventPage.

**Public display (v1):** `components/EventLabelChips.tsx`, small read-only chips. On
`EventPage.tsx`, render them under the date/location block; no render when empty. Each chip
links to the events search pre-filtered: ``Link to={`/events?tags=${key}`}``. A relative
path keeps white-label builds on their own domain, so never hardcode `rsv.pizza`.

**Discovery (v1):** on `/events` (`EventsSearchPage.tsx` + `utils/eventSearch.ts`):
- add `tags: string[]` to `EventSearchFilters`, parsed from `?tags=a,b`;
- `filterEvents` keeps events whose `labels` contain **all** selected tags (AND);
- render a chip row of the tags present in the loaded events, with counts, toggleable and
  wired to URL params; reuse `EventLabelChips` in selectable mode;
- show chips on each result card.

**Phase 2:**
- `/map` and `/map/all` (public chip filter; the moderator `tagFilter` stays on `event_tags`);
- SeriesLandingPage chips;
- `/underboss` EventTable labels column plus filter;
- NewEventPage / GPP27CreatePage / SideCreatePage optional picker;
- AI assistant field.

**Phase 3 (reporting):**
- consolidated report and partner report "events by tag" breakdown (`consolidatedReport.ts`,
  `report.routes.ts`) using `unnest(labels)` group-by;
- optional per-series vocabulary (`event_series.label_keys`, empty = global list), editable
  in `AdminSeriesPage`;
- server-side `?labels=` filter if `/events` outgrows client-side filtering.

### i18n (8 locales: de, en, es, fr, ja, ko, pt, zh)

- New keys in `frontend/src/i18n/locales/*/event.json`:
  - `labels.title` ("Tags"), `labels.helper` ("Pick up to 5"),
    `labels.maxReached`, `labels.filterAll`;
  - `labels.keys.<key>` for every allowed key.
- Add them to **all 8 locales** in the same PR. `i18n/__tests__/i18n-keys.test.ts` enforces
  key parity, so the build fails if a locale is missing one.
- `EventsSearchPage` is currently hardcoded English ("Find events"). Only the new strings use
  `t()`; translating the whole page is out of scope.
- The label key must never be shown raw. Fall back to the English text, never the slug.

### White-label

- There is no brand-specific vocabulary in v1. The global list works for every brand.
  Components use theme classes (`text-theme-text`, `bg-theme-surface`, ...) so brand themes
  apply automatically.
- Links are relative (`/events?tags=...`). No `rsv.pizza` literal anywhere; `brand-check.yml`
  enforces this. Use `BRAND` / `brandUrl()` from `frontend/src/config/brand.ts` if an absolute
  URL is ever needed (e.g. OG/share).
- Brand `/events` uses `/api/series/:slug/events`, so `labels` must be added to that endpoint
  (step 4 above). Otherwise filters silently show nothing on brand sites.
- Avoid tags with crypto/brand meaning in the global list. Brand-specific ones belong to the
  Phase 3 per-series override.

## Files to change (v1)

Backend:
- `backend/prisma/schema.prisma`: Party `labels`
- `backend/prisma/migrations/2026MMDD_party_labels/migration.sql` (new)
- `backend/scripts/apply-party-labels.cjs` (new)
- `backend/src/lib/eventLabels.ts` (new) plus `eventLabels.test.ts` (new)
- `backend/src/routes/party.routes.ts`: PATCH destructure/validate/tab-check/write
- `backend/src/routes/party.routes.test.ts`: PATCH cases
- `backend/src/routes/event.routes.ts`: public select and response
- `backend/src/routes/gpp.routes.ts`: `gppEventSelect` plus `formatGppEvent`
- `backend/src/routes/series.routes.ts`: `/:slug/events`
- (optional v1) `backend/src/lib/eventEditSchema.ts`: `labels` field plus allowlist entry

Shared/CI:
- `scripts/event-labels.json` (new, canonical key list read by both tests)
- `scripts/parties-anon-columns.json`: add `labels` (after the prod GRANT)

Frontend:
- `frontend/src/lib/eventLabels.ts` (new) plus test
- `frontend/src/lib/supabase.ts`: `DbParty.labels`, `SAFE_PARTY_COLUMNS` (after the GRANT),
  `updateParty` passthrough
- `frontend/src/types` (Party), `frontend/src/contexts/PizzaContext.tsx` mapper
- `frontend/src/lib/api.ts`: `PublicEvent`, `GPPEventMapItem`/`GPPEventApiResponse`,
  `PublicSeriesEvent`, `fetchPublicEventsForSearch` mapping
- `frontend/src/components/EventLabelPicker.tsx` (new), `EventLabelChips.tsx` (new)
- `frontend/src/components/EventDetailsTab.tsx`: picker in Options
- `frontend/src/pages/EventPage.tsx`: chips
- `frontend/src/pages/EventsSearchPage.tsx`, `frontend/src/utils/eventSearch.ts` plus its test: tag filter
- `frontend/src/i18n/locales/{de,en,es,fr,ja,ko,pt,zh}/event.json`
- `frontend/src/__tests__/field-sync.test.ts`

## Step-by-step implementation (v1)

1. Snax confirms the open questions and the key list. Write `scripts/event-labels.json`.
2. Write the migration plus `apply-party-labels.cjs`. **Dry-run, then apply to prod** (service
   role / `DATABASE_URL` from `backend/.env`, sandbox disabled). Verify the column, index and
   grant via `information_schema.column_privileges`.
3. Backend: `eventLabels.ts` plus tests, then the schema field, PATCH handling, and the three
   public payloads. Run `npm --prefix backend test` and `npm --prefix backend run build`.
4. Frontend data plumbing: types, mapper, `updateParty`, api.ts mappings, SAFE_PARTY_COLUMNS
   plus `parties-anon-columns.json`.
5. Frontend UI: picker in EventDetailsTab, chips on EventPage, `/events` filter, i18n in all
   8 locales.
6. Tests (below), `npm --prefix frontend test`, `npm --prefix frontend run build`, then the
   hooks lint (`lint.yml` config).
7. `/ship`. Verify on the preview after the backend is live (see Verify).

## Tests

- `backend/src/lib/eventLabels.test.ts`: normalize (trim, lowercase, dedupe, unknown dropped,
  order stable); `> MAX` is detected; keys match `scripts/event-labels.json`; **no label key
  collides with `isInternalTag()` or with known `event_tags` control tags** (guard against a
  future key like `go` / `paid`).
- `party.routes.test.ts` (PATCH):
  - owner sets labels and they are normalized;
  - 6 labels returns 400;
  - a restricted co-host without `details` has labels silently dropped while other fields
    still save;
  - setting `labels` never touches `eventTags`;
  - `eventTags` guarded-tag behaviour is unchanged.
- `event.routes` / `gpp.routes` / `series.routes` tests (or extend the existing ones): `labels`
  is present in public payloads.
- `frontend/src/utils/eventSearch.test.ts`: tags filter (AND), URL param round-trip, empty
  tags means no filtering.
- `frontend/src/lib/eventLabels.test.ts`: keys match the JSON; every key has an i18n entry in
  every locale (or rely on `i18n-keys.test.ts` parity plus the en check).
- `field-sync.test.ts`: `labels` maps from DbParty to Party.
- CI: `rls-anon-exposure` (SAFE_PARTY_COLUMNS readable), `migrations-applied`,
  `schema-drift`, `brand-check`, `typecheck`, `tests`, `lint` (hooks).

## How to verify (Vercel preview)

Preview: `https://rsvpizza-git-blackolive-70521-tags-pizza-dao.vercel.app` (branch
`blackolive-70521-tags`).

Previews share the prod backend, and **the backend only deploys from master**. Until master
deploys, PATCH ignores `labels` and public payloads lack it. So either:
- (a) run the backend locally against prod DB and point the preview/localhost
  `VITE_API_URL` at it for testing; or
- (b) ship in two PRs: **PR1** is backend plus migration (inert, additive), merged after the
  prod apply; **PR2** is the frontend, verified on preview against the live backend.
  Recommended: (b), the same pattern the series work used.

Checks on preview (after PR1 is live):
1. As host, open the event, then Details, then Options, then Tags: pick 3 and save. Reload:
   the 3 are still selected. Try a 6th: it's disabled and the helper text shows.
2. Public event page (logged out, incognito): chips show in the current locale. Switch to
   `ja` / `de`: the labels are translated. Click a chip: it lands on `/events?tags=<key>` with
   the filter on.
3. `/events`: the tag chip row shows counts; selecting 2 tags ANDs them; the URL updates and
   survives a refresh.
4. As a co-host restricted to `guests` only: the picker isn't shown, and a crafted PATCH with
   `labels` doesn't change them.
5. Regression: on `/underboss` the tag filter, bulk tags and `/payments` tags still behave the
   same, and `event_tags` on the test party is unchanged after editing labels (check in
   Supabase).
6. A brand build (e.g. the doge preview / `VITE_BRAND_SERIES_SLUG` set): `/events` shows tags
   for series events; no `rsv.pizza` links.
7. The browser console is clean; anon party loads (RSVPPage) don't 42501.
8. `/mobile-check` on EventPage and `/events` (the chip wrap on narrow screens).

## Risks

- **Schema-before-column outage:** merging `schema.prisma` before the prod ALTER 500s every
  Party query. Mitigation: apply first, plus the CI `migrations-applied` gate, plus the
  two-PR split.
- **SAFE_PARTY_COLUMNS before GRANT:** every anon party read 42501s. Mitigation: GRANT in the
  same migration, applied first; CI `rls-anon-exposure`.
- **Confusion with `event_tags`:** a future dev writes labels into `event_tags` or vice versa.
  Mitigation: the distinct name `labels`, comments in the schema and both `eventLabels.ts`
  files, and the collision test.
- **Key renames later** need a data migration (`array_replace`). Mitigation: settle the list
  in Step 1, and prefer adding keys over renaming.
- **Client-side filtering scale:** `/events` already loads up to 2000 events; tags add a few
  bytes each. Fine for GPP scale; Phase 3 adds server-side filtering if needed.
- **Cache:** `/api/gpp/events` is `public, max-age=300`, so new tags take up to 5 minutes to
  appear on `/events` and maps. Acceptable; mention it to hosts only if asked.
- **Untranslated keys:** if a key is added to the list without all 8 translations, CI parity
  catches it.

## Phase 0 (DONE in #1349 and #1368): lock down host writes to `event_tags`

This isn't required for labels, but it was found during this investigation. PATCH
`/api/parties/:id` accepts any `eventTags` from any editor. Only `go`, `possible-scam` and
numeric/`k` caps are guarded (`party.routes.ts:781-830`, `lib/eventTags.ts isGuardedTag`).

Proposed fix: for non-admin/non-underboss editors, compute
`diff = symmetricDifference(current, next)` and allow it only if
`diff ⊆ HOST_WRITABLE_EVENT_TAGS = {'prepay'}` (the host Payments-tab checkbox). Reject other
changes with 403 `FORBIDDEN_TAG`, the same way as `go`. Also:
- remove `event_tags` from the AI assistant's host-editable fields in `eventEditSchema.ts`;
- sync the frontend/backend `INTERNAL_EVENT_TAGS` mirrors (`side-prelaunch`, `k\d+`).

Note that `event_tags` is anon-readable, so internal tags like `possible-scam` are visible via
a direct Supabase anon query. Fixing that means splitting control tags into a non-granted
column. It's out of scope here; log it as a follow-up for Snax to prioritise.

## Phased rollout summary

| Phase | Scope | PRs |
|---|---|---|
| 0 (separate task) | Host-write guard on `event_tags`, mirror sync | 1 small |
| 1 (this task, v1) | Column, migration, PATCH, public payloads (PR1); picker, event-page chips, `/events` filter, i18n (PR2) | 2 |
| 2 | Map and series chips/filters, `/underboss` column and filter, create-flow picker, AI assistant field | 1-2 |
| 3 | Reporting breakdowns (consolidated/partner), per-series vocabularies, server-side filter | as needed |

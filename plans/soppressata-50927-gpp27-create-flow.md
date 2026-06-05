# soppressata-50927 — GPP27 admin-gated create flow + year-aware URLs + budget approval

## Goal
A **new, admin/underboss-gated** `/gpp27` page that creates Bitcoin Pizza Day **2027**
events, improving on the 2026 `/gpp` flow. The created events live at
`https://rsv.pizza/{city}?year=2027`. The flow's defining feature is **clear
reimbursement communication**: hosts are told we reimburse **pizza only**, and are
shown a **pre-approved spend amount** sized to their expected attendance.

Status: **Doing** (sheet row to be backfilled — `sheets-claude create` perms).

## Relationship to other work
- **Sibling of `diavola-49271-gpp27-dashboard.md` ("Doing").** That plan rebuilds the
  **host-facing** GPP27 dashboard and introduces a 3-stage attendance model, adding
  `target_attendance` + `expected_attendance` columns, with the existing
  `estimated_attendance` becoming the **day-of/actual** number.
- **This plan must REUSE diavola's attendance columns, not duplicate them.** If diavola
  hasn't landed those columns yet, coordinate ordering (see Slice 0). "Last year's
  estimated attendance" in the budget formula = the **2026 event's `estimated_attendance`**
  (the day-of actual headcount), NOT a planning target.
- Do **not** touch the live 2026 `/gpp` flow or `GPPLandingPage.tsx` behavior. Build a
  parallel page.

## Confirmed design decisions (from Snax)
1. **URL scheme:** `/{city}?year=2027` (standard `?year=` query param). Bare `/{city}`
   resolves to the **latest year** for that city; older years reachable via explicit
   `?year=2026`. Year is derived from `parties.date` (`date.getFullYear()`) — **no new
   `year` column**.
2. **Access:** the **whole 2027 flow is gated** (both `/gpp27` AND the resulting
   `/{city}?year=2027` event pages) to **admins + the relevant underboss** until launch.
3. **Budget (pre-approved spend), set by admin OR underboss**, pre-filled & editable:
   - `suggested = perHeadRate(tier) × expectedAttendance`
   - `perHeadRate`: **tier 1 → $10, tier 2 → $8, tier 3 → $6**, via existing
     `getCityTier(city)` in `frontend/src/utils/sponsorshipPricing.ts:56`.
   - `expectedAttendance = max( lastYearEstimatedAttendance, 0.40 × currentRsvpCount )`.
   - Stored to `parties.reimbursementCapUsd`.
   - **New-city fallback** (no 2026 event for that city): last-year term = 0, so the
     suggestion starts at $0 and the admin/underboss types the figure in manually.

## Verified facts (quote-checked against schema/code)
- `frontend/src/utils/sponsorshipPricing.ts:56` — `getCityTier(cityName): 1|2|3`
  (hardcoded `TIER_1_CITIES`/`TIER_2_CITIES`, normalized-substring match, else tier 3).
- `backend/prisma/schema.prisma` — `estimatedAttendance Int? @map("estimated_attendance")`
  (line ~87). `reimbursementCapUsd Decimal? @map("reimbursement_cap_usd")` (~248),
  `budgetTotal`/`budgetEnabled` (~150-151). **No `year` column** — derive from `date`.
  `eventType String?`, `eventTags String[]`, `city String?`.
- `backend/src/helpers/underbossScope.ts` — `partyMatchesScope(party, scope)`; allows
  admin OR matching `region`/`city` (case-insensitive). **Selects feeding it must include
  `city`** (see memory `party_match_scope_select`).
- Create path today: `POST /api/gpp/events` → `backend/src/routes/gpp.routes.ts` (~249-629);
  sets `eventType:'gpp'`, `eventTags:['Global Pizza Party','wpc','ens']`, auto `customUrl`
  from normalized city, default date May 22 6–9pm local, coHosts (PizzaDAO + host + region UBs).
- Public event resolution: `backend/src/routes/event.routes.ts` (~13-100) tries
  `inviteCode` then `customUrl` exact match. Frontend `/:slug` → `EventPage.tsx`
  (App.tsx ~135). **`customUrl` is unique + regex `^[a-z0-9-]+$` (no slashes).**

## The hard part — year-aware slug resolution
2026 already owns `customUrl='austin'`; the 2027 event **cannot reuse it** (unique col).
So resolution can no longer be "slug → the one party."

**Approach:**
- Give the 2027 GPP party a **unique** internal `customUrl` (e.g. `{citySlug}` if free,
  else `{citySlug}27`), but resolve the **public** `/{city}?year=2027` by **city + year**,
  not by exact customUrl.
- Backend `GET /api/events/:slug` gains an optional `?year=YYYY`:
  1. Compute `citySlug` from `:slug` (strip a trailing 2-digit year if present; else use as-is).
  2. If `year` present → find the GPP party where normalized-city-slug == citySlug AND
     `eventType='gpp'` AND `EXTRACT(YEAR FROM date) = year`.
  3. If no `year` → **latest-year wins**: among GPP parties matching that citySlug, pick the
     max `date` year. (Once 2027 exists, bare `/austin` resolves to 2027.)
  4. Back-compat: still fall through to the existing exact `inviteCode`/`customUrl` match so
     all current non-GPP and 2026 links keep working.
- Frontend `EventPage` reads `searchParams.get('year')` and passes it to the events fetch.
  Share/canonical links for 2027 events render as `/{city}?year=2027`.
- GPP event volume is small (hundreds); a `WHERE eventType='gpp'` scan with a normalized-city
  compare is fine. If perf matters, add an index on `(event_type, date)` — no new column
  required. **Decision: derive citySlug in code (reuse the existing normalizer), do NOT add a
  `city_slug` column** unless the implementer finds the scan unacceptable.

⚠️ Do **not** relax the `customUrl` regex to allow slashes — `?year=` keeps slugs slash-free
and avoids touching validation/sanitization across the codebase.

## Slice plan

### Slice 0 — Data prerequisite (coordinate with diavola-49271)
- Confirm `estimated_attendance` exists (it does) and that diavola's
  `target_attendance`/`expected_attendance` columns are present (or will be). This plan only
  **reads** `estimated_attendance` (last year) and **writes** `reimbursementCapUsd`; it adds
  **no** new columns. If diavola lands its columns later, no blocker here.

### Slice 1 — Year-aware event resolution (backend + EventPage)
- Extend `GET /api/events/:slug` with optional `?year=` per "The hard part" above; add the
  latest-year default and keep exact-match back-compat.
- `EventPage.tsx`: read `?year=`, thread through the fetch; emit canonical `/{city}?year=2027`
  links where the page builds share URLs.
- **Verify by executing** the year query against the DB before calling done
  (memory `verify_raw_sql_by_executing`): test bare slug, `?year=2026`, `?year=2027`.

### Slice 2 — Admin/underboss-gated `/gpp27` create page
- New route `/gpp27` in `App.tsx` **before** the `/:slug` catch-all → new
  `GPP27CreatePage.tsx`.
- Gate: `fetchAdminMe()` → if not admin, check underboss scope. For underbosses, the page
  is usable but the city/budget they can act on is scoped via `partyMatchesScope` (server-
  enforced too — never trust the client). Non-admin/non-UB → Access Denied (reuse the
  AdminPage pattern: spinner → `<AccessDenied/>` → panel).
- Create endpoint: a new `POST /api/gpp27/events` (or a `year:2027` param on the existing
  GPP create) that mints the 2027 party with a **unique** customUrl (year-suffixed on
  collision), `eventType:'gpp'`, 2027 date defaults (May 22 2027 6–9pm local), and the same
  coHost seeding. **Server-side auth gate** on this endpoint (admin OR `partyMatchesScope`).
- **Whole-flow gating:** until launch, the resolver (Slice 1) and the event page must hide
  2027 events from non-admin/non-UB viewers (e.g. a `gpp27_gated` app-config flag or a
  `eventTags` marker checked server-side). Flip to public at launch.

### Slice 3 — Budget approval UI + computation
- In the create/review UI, show the **pre-filled, editable** suggested cap:
  `getCityTier(city)` → $10/$8/$6 × `expectedAttendance`, where
  `expectedAttendance = max(lastYear estimated_attendance, 0.40 × rsvpCount)`.
  - `lastYear`: look up the 2026 GPP party for the same city (citySlug match, year 2026),
    read its `estimated_attendance`. New city → 0.
  - Display the inputs transparently (last-year #, RSVP #, tier, per-head rate) so the
    admin/UB understands the number.
- On save, write `reimbursementCapUsd` (admin/UB may override the suggestion).
- **Field plumbing** if any new party field surfaces in PATCH: update BOTH `updateParty`
  (`supabase.ts`) AND `updatePartyApi` (`api.ts`) whitelists, `dbPartyToParty` in
  `PizzaContext.tsx`, `safeColumns`/`SAFE_PARTY_COLUMNS`, `types.ts`, and `PublicEvent` if
  it must show publicly (memory: `two_patch_field_lists`, `publicevent_separate_type`).
  This slice mostly reuses existing `reimbursementCapUsd`, so plumbing should be minimal.

### Slice 4 — "Pizza only" host messaging
- In the host-facing 2027 flow (coordinate placement with diavola's GPP27 dashboard), show a
  prominent, persistent statement: **"We reimburse pizza only"** + **"You're approved to
  spend up to $X"** (the `reimbursementCapUsd`), tied to expected attendance.
- **First-time hosts / new cities** (no 2026 event → cap starts at $0 pending review) MUST
  still be told up front that this is a **reimbursement model — you pay, then we reimburse
  pizza only** (not an upfront grant). Do NOT hide the reimbursement message when the cap is
  unset/$0; instead show the "pizza only, reimbursement-based" copy with an "amount pending
  review" state so the host isn't surprised later. This is the highest-risk
  miscommunication case — make the copy unconditional, the dollar amount conditional.
- **Set the timeline expectation (merged canonical wording):** "Reimbursement typically
  takes **~7 days after you submit your receipt + photos**; **up to 2 weeks after May 22** to
  be fully processed." Surface this both up front (in the pizza-only / approved-amount
  callout) and again at/near the receipt-submission step so the host knows the clock starts at
  submission. Keep this identical to agreement clause 2.
- Reuse existing components (no raw markup): `IconInput`, `Checkbox`, callout styling.
  Beware GPP-theme text-color overrides for white-on-color text
  (`gpp_theme_text_white_override`) and portal/modal theme gaps.
- i18n: add `en` keys; other 7 locales fall back (follow-up), matching diavola's approach.

### Slice 5 — City Host Agreement + publish gating (REQUIRED before page can go public)
GPP27 hosts must sign off on a **City Host Agreement** before their RSVP page can be
published. **Two hard publish gates:**
1. **All agreement checkboxes acknowledged.**
2. **A valid merch delivery address has been provided** (reuse the existing shipping/kit
   address concept — see `backend/src/routes/shipping.routes.ts` / `KitRequestForm` — do NOT
   invent a new address field; verify whether a usable address already lives on the party or
   the kit record).

**The agreement clauses are DATA, not hardcoded JSX.** Store the checkbox items as rows in
the database so they can be edited/re-ordered/re-versioned without a deploy.

- **New table** `gpp_agreement_clauses` (or reuse the existing `app_config` table — there's a
  `20260421_app_config.sql` migration + `marinara-71630-private-config.md`; verify which fits
  before adding a table). Suggested columns:
  `id`, `version` (text), `sort_order` (int), `body` (text, may contain the `{tier amount}`
  token), `requires_ack` (bool, default true), `active` (bool). Seed with the 7 clauses below.
- **Backend** `GET /api/gpp27/agreement` → returns the active clauses (ordered) + current
  `version`. Frontend renders one `Checkbox` per clause (no raw `<input>`), interpolating
  `{tier amount}` client-side from `getCityTier(city)`.
- **Host acknowledgment** persisted on the party: `agreement_accepted_at TIMESTAMPTZ` +
  `agreement_version` (text). Storing the version means a future clause edit (new version)
  re-prompts hosts who signed an older version. Optionally store the accepted clause ids
  (jsonb) if legal wants per-item proof — default: timestamp + version only.
- Adding party columns → apply migration before merge, plumb through the two PATCH whitelists
  + `dbPartyToParty` + `safeColumns` + `types.ts` (memory: `two_patch_field_lists`).

**Publish gate enforcement:** the "publish / go public" action (and the public resolver for
2027 events, Slice 1/2) must refuse to expose the page until BOTH gates pass — enforced
**server-side**, not just disabled in the UI. Server checks `agreement_accepted_at` is set
for the **current** active version AND a valid merch address exists.

**Seed content for `gpp_agreement_clauses` (verbatim — these are DB rows, NOT inline strings):**

> **City Host Agreement**
> Before your RSVP page can be published, you must confirm the following:
>
> ☐ I understand that the reimbursement amount is limited to a maximum of **{tier amount}**
> USD per person, up to a total maximum reimbursement of **$625 USD**.
> _Example: If I submit valid proof showing 10 attendees at the party, I can receive up to
> 10 × {tier amount} USD reimbursement._
>
> ☐ I understand that reimbursements via credit card, bank transfer, or crypto typically
> take ~7 days after I submit my receipt + photos, and up to 2 weeks after May 22 to be
> fully processed.
>
> ☐ I understand that proof of the event is required for reimbursement. This includes:
> - Group photos showing the attendees
> - A photo of the pizza boxes / pizza stack
> - A 30-second video of the group shouting "Pizza for free!" or a similar phrase
> - Photos documenting the use of PizzaDAO merch (signs, table tents, flyers)
>
> ☐ I understand that reimbursement may be cancelled if fraud, fake attendance, manipulated
> media, or other dishonest behavior is discovered.
>
> ☐ I understand that my RSVP page can only go public after a valid merch delivery address
> has been provided.
>
> ☐ I understand that a receipt from the pizzeria is required for reimbursement.
>
> ☐ I understand that any additional expenses beyond pizza costs are not covered by PizzaDAO.

**`{tier amount}` token** = the host city's per-person rate from `getCityTier(city)`
(**$10 / $8 / $6** for tier 1 / 2 / 3) — the SAME rate that drives the budget suggestion
(Slice 3). Interpolate it into checkbox 1 and the example so the host sees their real number.

**$625 total cap:** the per-event reimbursement ceiling communicated here is **$625**. The
approved `reimbursementCapUsd` (Slice 3 = tier × expectedAttendance) must therefore be
**clamped to $625** — for large events the $625 ceiling binds (e.g. tier-1 $10 caps out at
62.5 attendees). Reconcile Slice 3's stored cap with this $625 ceiling.

## Copy reconciliation (RESOLVED by Snax)
- **Timeline — MERGED.** Canonical wording everywhere (Slice 4 callout + agreement clause 2):
  **"Reimbursement typically takes ~7 days after you submit your receipt + photos; up to 2
  weeks after May 22 to be fully processed."** Use this unified phrasing on both surfaces; the
  seeded `gpp_agreement_clauses` clause 2 below should carry the merged wording, not the
  original "up to 2 weeks after May 22" alone.
- **$625 ceiling — CONFIRMED.** $625 is the absolute per-event reimbursement ceiling.
  `reimbursementCapUsd` (Slice 3 = `tier × expectedAttendance`) is **clamped to $625**; for
  larger events the $625 ceiling binds and overrides the attendance formula.
- **Proof requirements** in the agreement (group photo, pizza-stack photo, 30-sec "Pizza
  for free!" video, merch-usage photos, pizzeria receipt) extend the existing payout proof
  set (`PayoutDocument.kind` = receipt/pizza/event). The agreement only *communicates* the
  requirement here; if we want to *enforce* video/merch uploads in the payout flow, that's a
  follow-up touching the receipt-submission UI + `PayoutDocument`.

## Migration / deploy ordering (memory gotchas)
- This plan adds **no DB columns** (reuses `reimbursementCapUsd` + `estimated_attendance`).
  If that changes, **apply migration BEFORE merging** the Prisma change
  (`apply_migration_before_merging_prisma_changes`), apply via Supabase MCP or
  `pg`+`DATABASE_URL` (no auto-apply in this repo), and verify table name casing.
- **Backend auto-deploys from master push** — new endpoints go live ~1 min after merge.
  Preview frontends hit the **production backend**, so the new `/api/gpp27/*` +
  `?year=` resolver must be on master before previews can exercise them.
- Keep the whole-flow gate **on** until launch so 2027 events don't leak publicly.

## Key files
- `frontend/src/App.tsx` (~71 `/gpp`, ~118 `/admin`, ~135 `/:slug`) — add `/gpp27` route.
- `frontend/src/pages/GPPLandingPage.tsx` — 2026 reference (do NOT change behavior).
- `frontend/src/pages/AdminPage.tsx` — admin-gate pattern to mirror (`fetchAdminMe`).
- `frontend/src/pages/EventPage.tsx` — add `?year=` handling.
- `frontend/src/utils/sponsorshipPricing.ts:56` — `getCityTier` (reuse for per-head rate).
- `backend/src/routes/gpp.routes.ts` (~249-629) — create flow reference / new 2027 endpoint.
- `backend/src/routes/event.routes.ts` (~13-100) — year-aware resolver.
- `backend/src/helpers/underbossScope.ts` — `partyMatchesScope` (server-side gate; select `city`).
- `backend/prisma/schema.prisma` — `estimated_attendance`, `reimbursement_cap_usd`, `date`,
  `event_type`, `city`.
- `plans/diavola-49271-gpp27-dashboard.md` — sibling host-dashboard plan (attendance columns).

## Open items to confirm before/at implementation
- Non-zero floor for brand-new cities' suggested budget? (currently: starts at $0, manual entry).
- Exact gating mechanism for hiding 2027 events pre-launch (app-config flag vs eventTag) —
  implementer's call, server-enforced.
- Whether to extend the existing `POST /api/gpp/events` with `year` vs a new `/api/gpp27/events`.

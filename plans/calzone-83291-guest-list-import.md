# calzone-83291 — Bulk-import guest lists from Luma / Meetup / Eventbrite / CSV

**Priority:** P2
**Branch:** `calzone-83291-guest-list-import`
**Base:** `origin/master`

---

## 1. Goal

A host running an event on Luma, Meetup, or Eventbrite (50–500 RSVPs) wants to also use rsv.pizza for check-in, the vouch flow, and the global-party count. From their host page Guests tab, they should be able to:

1. Click **Import guests**.
2. Upload a `.csv` (exported from Luma / Meetup / Eventbrite) **or** paste rows directly.
3. See a preview with auto-detected column mapping (which CSV column → name / email / status), with per-row duplicate warnings against existing guests.
4. Choose a landing status (Approved / Pending / Checked-in).
5. Confirm → rows insert as `guests` rows on this party, attributed to the originating platform.

A single unified flow auto-detects the source platform from the CSV headers; manual mapping is the fallback for unknown layouts. No separate buttons per platform.

---

## 2. UX flow

The import button lives on the Guests tab, next to the existing **Export CSV** link (right side of the "Guests" header in `GuestList.tsx`, line ~342-348). The Export CSV link is currently the only top-right action on this section — placing Import next to it keeps the symmetric pair (Import ↔ Export) and matches a host's mental model.

Clicking it opens a full-screen modal (same primitive as `InviteGuestsModal.tsx`, but with the project-standard `bg-black/60 backdrop-blur-sm` backdrop per CLAUDE.md rather than the existing `bg-black/50`):

```
┌────────────────────────────────────────────────────────────┐
│  Import guests                                          ✕  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  STEP 1 — Source                                           │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Upload CSV/XLSX │  │  Paste rows      │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                            │
│  STEP 2 — Preview                                          │
│  Detected: Luma  ·  124 rows  ·  3 duplicates  ·  2 errors │
│                                                            │
│  Column mapping:                                           │
│   Name      ← [Name           ▼]                           │
│   Email     ← [Email          ▼]                           │
│   Status    ← [Approval Status▼]   (optional)              │
│                                                            │
│  Land imported guests as: ( ) Pending  (•) Approved        │
│                            ( ) Checked-in                  │
│                                                            │
│  ┌──┬──────────────┬────────────────────┬──────────────┐   │
│  │☑ │ Name         │ Email              │ Notes        │   │
│  ├──┼──────────────┼────────────────────┼──────────────┤   │
│  │☑ │ Alice Sun    │ alice@x.com        │ ✓ valid      │   │
│  │  │ Bob Lee      │ bob@y.com          │ ↻ duplicate  │   │
│  │  │ (blank)      │ broken@            │ ⚠ bad email  │   │
│  │☑ │ Carla Pé     │ carla@z.com        │ ✓ valid      │   │
│  └──┴──────────────┴────────────────────┴──────────────┘   │
│                                                            │
│  ⚠ This import will push your guest count past             │
│    max_guests (80). Proceed anyway?                        │
│                                                            │
│  [ Pick different file ]              [ Import 119 ▶ ]     │
└────────────────────────────────────────────────────────────┘
```

After confirm, a sending state shows progress, then a results summary: "Imported X · Skipped Y duplicates · Z errors", with a collapsible error list. Closing the modal triggers a `loadParty()` refresh — the realtime publication on `guests` will also pick up new rows automatically.

---

## 3. Backend endpoint spec

### `POST /api/parties/:partyId/guests/import`

Mounted in `backend/src/routes/party.routes.ts` (host-auth router, not the public v1 router — this is a UI-driven action, not a partner-API integration). Mirrors the existing host-add-guest pattern at `party.routes.ts:695-750`.

**Auth:** Bearer token. Host owner, co-host with `canEdit` + `'guests'` in `allowedTabs`, or super-admin. Same checks as `POST /api/parties/:id/guests`:

```ts
const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
if (!canEdit) throw new AppError('Party not found', 404, 'NOT_FOUND');
const canAccessGuests = await canUserAccessTab(id, req.userEmail, req.userId, 'guests');
if (!canAccessGuests) throw new AppError('You do not have access to the guests tab', 403, 'TAB_ACCESS_DENIED');
```

**Request body:**
```ts
{
  guests: Array<{
    name: string;
    email?: string | null;
    status?: 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN';
    approved?: boolean | null;
  }>;
  sourcePlatform: 'luma' | 'meetup' | 'eventbrite' | 'csv';
}
```

**Limits:**
- `guests.length` must be 1..2000 (hard cap). Frontend soft-warns at 500.
- Each `name` required, non-empty, trimmed.
- `email` optional but if present must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.

**Logic** (modelled on `v1/guests.ts:623-790` bulk-invite):

1. Validate `sourcePlatform` against the allowlist `['luma', 'meetup', 'eventbrite', 'csv']`.
2. Prefetch existing emails for the party (`prisma.guest.findMany({ where: { partyId }, select: { email: true } })`), build a `Set` of lowercase emails.
3. Build the `submittedVia` value: `'import-' + sourcePlatform` → `'import-luma'`, `'import-meetup'`, `'import-eventbrite'`, `'import-csv'`. See section 6.
4. Walk rows; for each:
   - If `email` already in the set (or duplicated within the input), push to `skipped` with reason `'duplicate'` — continue.
   - If validation fails, push to `errors` with the row index + reason.
   - Otherwise stage a `prisma.guest.create` payload.
5. Chunk inserts at 50 rows per `prisma.$transaction([...])`, with a `await new Promise(r => setTimeout(r, 100))` between chunks. This both keeps the WAL bursts bounded (see section 10) and stays under Postgres statement size limits.
6. For each created guest, push the id into `createdGuestIds`.
7. Return:
   ```ts
   { inserted: number; skipped: Array<{ email: string; reason: string }>; errors: Array<{ index: number; reason: string }>; createdGuestIds: string[] }
   ```
8. Fire a single `triggerWebhook('guest.imported', { partyId, count: inserted, source: sourcePlatform }, req.userId!)` after the loop — one webhook per import, not per row, to avoid spamming webhook consumers.

**Per-row create payload** (must match the existing host-add path at `party.routes.ts:729-741`, plus the import-specific fields):

```ts
{
  name: row.name.trim(),
  email: row.email ? row.email.toLowerCase() : null,
  dietaryRestrictions: [],
  likedToppings: [],
  dislikedToppings: [],
  likedBeverages: [],
  dislikedBeverages: [],
  submittedVia: `import-${sourcePlatform}`, // e.g. 'import-luma'
  partyId,
  status: row.status ?? 'CONFIRMED',
  approved: row.approved ?? (row.status === 'INVITED' ? null : true),
  checkedInAt: row.status === 'CHECKED_IN' ? new Date() : null,
  checkedInBy: row.status === 'CHECKED_IN' ? req.userEmail : null,
}
```

The `status` vs `approved` pairing follows the existing `architecture_guests_status_approved_dual_state` rule:
- Landing status **Pending** → `status: 'CONFIRMED'`, `approved: null`
- Landing status **Approved** → `status: 'CONFIRMED'`, `approved: true`
- Landing status **Checked-in** → `status: 'CONFIRMED'`, `approved: true`, `checkedInAt: now()`

If `requireApproval` is false on the party, "Pending" is hidden from the UI; default lands as Approved.

---

## 4. Database changes

**None.** This is the preferred outcome. The existing `Guest` model (`backend/prisma/schema.prisma:217-277`) carries everything we need:

- `submittedVia` (text) carries the platform via the `import-<platform>` value (section 6).
- `status`, `approved`, `checkedInAt`, `checkedInBy` already exist.

We deliberately do **not** add a new `imported_from` column (see Tradeoffs below).

### Tradeoff: not adding `imported_from`

The alternative is a new nullable `imported_from VARCHAR` column on `guests` to record the originating platform separately from `submittedVia`. The case for it:
- Cleaner separation of "how the row entered our system" (submittedVia) from "what external system it came from".
- Easier to query "all Luma-imported guests" without `LIKE 'import-%'`.

The case against (the choice here):
- A new column triggers the **7-place footgun** from `CLAUDE.md`: Prisma schema, SQL migration, backend POST destructure, backend PATCH destructure, backend GET select list, frontend type, frontend api.ts wrapper. Not worth the surface area for what is effectively a flavor of `submittedVia`.
- `submittedVia LIKE 'import-%'` is fine for the one place that filters on it (the fake-detection scorer), and any other query that wants the platform just splits on the hyphen.

If a future feature needs the platform as a first-class field, add the column then; don't pre-add it.

---

## 5. `submitted_via` decision

**Proposed values:**
- `'import-luma'`
- `'import-meetup'`
- `'import-eventbrite'`
- `'import-csv'`

`submittedVia` is a freeform `TEXT` column with no DB-level constraint (verified at `backend/prisma/schema.prisma:239` — just `String @default("link")`). The "allowlist" is therefore a code-level convention spread across consumers. The places to update:

| File | What to change |
|------|----------------|
| `backend/src/lib/fakeDetection.ts` (already on master per `feedback_invite_vs_link_rsvps`) | **Do NOT add `import-*`** to the `['link', 'rsvp', 'api']` allowlist — imported guests must not count toward fake-event heuristics (section 10). |
| `backend/src/swagger.ts:182` | Expand the `submittedVia` description string with the new values. |
| `backend/src/routes/v1/guests.ts:170` | The public API selects `submittedVia: true`; no change required. |

No other allowlist needs updating. The frontend never filters by `submittedVia` value today (verified — the 5 hits in `frontend/src/lib/supabase.ts` only set or pass through the field).

---

## 6. Frontend files

### New files

| Path | Purpose |
|------|---------|
| `frontend/src/components/ImportGuestsModal.tsx` | The modal: upload / paste, preview table, column mapping, confirm. Uses `IconInput`, `Checkbox`, `bg-black/60 backdrop-blur-sm` + `z-50` backdrop. |
| `frontend/src/lib/guestImport/parsers.ts` | Platform-specific header detection + row mapping. Exports `detectPlatform(headers): 'luma' \| 'meetup' \| 'eventbrite' \| 'csv'` and `parseRows(text, platform, mapping?): ParsedRow[]`. |
| `frontend/src/lib/guestImport/headerProfiles.ts` | Canonical header sets per platform (section 7). |
| `frontend/src/lib/guestImport/parsers.test.ts` | Unit tests for each platform's header detection + status mapping. |

### Edited files

| Path | Change |
|------|--------|
| `frontend/src/components/GuestList.tsx` | Add an "Import" button next to the Export CSV link (line ~342-348). Open `ImportGuestsModal` on click. After import success, call `loadParty(party.inviteCode)`. |
| `frontend/src/lib/api.ts` | Add `importGuestsApi(partyId, { guests, sourcePlatform })` wrapper after `addGuestApi` (line ~306). Return type matches the backend response shape. |
| `frontend/src/lib/csvParser.ts` | **Extend** the existing parser. Add a `parseCsvWithHeaders(text): { headers: string[]; rows: string[][] }` export alongside the existing `parseCsv` — the import flow needs raw header access for platform detection; the existing `bulk-invite` flow keeps using `parseCsv`. |
| `frontend/src/i18n/locales/en/host.json` (+ other locales) | Add strings: `guests.importButton`, `guests.import.title`, `guests.import.uploadCta`, `guests.import.pasteCta`, `guests.import.previewSummary`, `guests.import.landAsLabel`, `guests.import.errorOverMax`, etc. |

The XLSX path: do **not** add an XLSX parser library (e.g. `xlsx`/`SheetJS`) — it's ~1MB and we don't need it. Show "Save as CSV from Excel/Google Sheets first" in the upload helper text. The Luma/Meetup/Eventbrite exports are all CSV-native. (Tradeoff: if hosts complain, revisit by gating xlsx behind dynamic `import()` so it's not in the main bundle.)

---

## 7. CSV format research per platform

Header profiles (case-insensitive match — store in `headerProfiles.ts`). These reflect each platform's standard export as of late 2025/early 2026; verify on a live test export before merging:

### Luma (`lu.ma/event/manage/<id>/guests` → Export CSV)
Canonical headers (subset we care about):
- `name` — full name
- `email`
- `approval_status` — `approved`, `pending_approval`, `declined`, `waitlist`
- `ticket_type` — usually `Free` or named tier
- `checked_in_at` — ISO timestamp or empty
- `created_at` — registration time

**Detection:** presence of `approval_status` **AND** `email` headers.

**Status mapping:**
- `approved` → `status: 'CONFIRMED'`, `approved: true`
- `pending_approval` → `status: 'CONFIRMED'`, `approved: null`
- `waitlist` → `status: 'WAITLISTED'`, `approved: null`
- `declined` → skipped (don't import declined guests)
- if `checked_in_at` is non-empty → also set `status` to checked-in handling

### Meetup (event organizer dashboard → Export attendees)
Canonical headers:
- `Name`
- `User ID`
- `Email Address`
- `RSVP` — `Yes` / `No` / `Waitlist`
- `Guests` — additional plus-one count
- `RSVPed on`

**Detection:** presence of `RSVP` **AND** `User ID` headers.

**Status mapping:**
- `Yes` → Approved
- `Waitlist` → Waitlisted
- `No` → skipped

Plus-ones (the `Guests` integer column) are out of scope for v1 — the row counts as the primary RSVPer only, with a note in the UI explaining we don't create separate rows for plus-ones. Could be a v2 feature.

### Eventbrite (Manage Attendees → Export → "Attendee Summary")
Canonical headers:
- `Order #`
- `First Name`
- `Last Name`
- `Email`
- `Ticket Type`
- `Attendee Status` — `Attending`, `Checked In`, `Not Attending`

**Detection:** presence of `Order #` **AND** `Attendee Status` headers.

**Status mapping:**
- `Attending` → Approved
- `Checked In` → Approved + `checkedInAt: now()` (we lose the original time but preserve the fact)
- `Not Attending` → skipped

Name field: concatenate `First Name` + `Last Name`.

### Generic CSV
Fallback when none of the above signatures match. Look for any header containing `email` (case-insensitive) for the email column, any containing `name` for the name column. Show the full column-mapping dropdowns so the host can override.

Required minimum: at least one column matching email-pattern (rows with valid `@`). If we can't find one, the preview shows: "Couldn't find an email column. Map one manually below."

### Verification of headers
Since the prompt allows web-searching, **verify the Luma / Meetup / Eventbrite header lists against a real export before merging**. If they've changed since this plan was written, update `headerProfiles.ts` accordingly. The detection logic uses an `every(required => headers.includes(required))` check, so adding/removing optional fields won't break detection.

---

## 8. Backend files

### Edited

| Path | Change |
|------|--------|
| `backend/src/routes/party.routes.ts` | Add the `POST /:id/guests/import` route after the existing `POST /:id/guests` route (~line 750). Use the same auth pattern (`canUserEditParty` + `canUserAccessTab('guests')`). |
| `backend/src/routes/party.routes.test.ts` | Add tests: success path, duplicate skipping, validation errors, auth/cohost denial, max-row cap. |
| `backend/src/swagger.ts` | Add the new endpoint to the OpenAPI spec; expand the `submittedVia` description with `import-*` values. |

### New

None. The endpoint is small enough to live inline in `party.routes.ts` next to the existing host-add-guest path. A helper file would be over-engineering.

### NOT touched

- `backend/src/routes/v1/guests.ts` — this is the public/API-key v1 router, not where host-UI endpoints live. Bulk-invite happens to live there because it was originally designed as an API endpoint and the host UI piggybacks. The new import endpoint is exclusively for the host UI and should live with the other host-only guest mutations in `party.routes.ts`.
- `backend/prisma/schema.prisma` — no schema changes.

---

## 9. Dedup, capacity, file-size, error-handling rules

### Dedup
- **Scope:** within the party (`partyId` + lowercase email).
- **Strategy:** prefetch all existing emails for the party into a `Set`, check against it as we iterate the input. Also dedup within the input batch by adding each email to the same set as it's accepted (prevents duplicate emails inside one CSV from creating two rows). Same pattern as `v1/guests.ts:664-672`.
- **Default:** skip duplicates. Report them in `skipped[]` with reason `'duplicate'`.
- **"Update existing" opt-in:** out of scope for v1. Note in plan as a follow-up.

### Capacity (`max_guests`)
- **Policy:** accept, with a warning in the preview UI. The host knows their venue; if they import 600 RSVPs against a `max_guests: 80` party, they probably want to either (a) bump max_guests or (b) waitlist the extras — neither of which we want to force at import time.
- **UI:** show an inline warning banner above the Import button in the preview: "This import will push your confirmed-guest count to N, past your max of M. The first M will land as approved; the rest will be waitlisted." (v1 simpler form: just warn and let them all land as the chosen status. Auto-waitlist-overflow is a v2.)
- **No server-side enforcement** — the existing host-add-guest endpoint doesn't enforce max_guests either, so we stay consistent.

### File size
- **Soft limit:** 500 rows. UI shows a yellow banner: "Large imports may take 30+ seconds. Consider splitting."
- **Hard limit:** 2000 rows. UI blocks confirm with: "Files over 2000 rows must be split into multiple imports." Backend enforces the same cap and returns 400 if exceeded.
- **File-byte limit:** 2 MB on the upload. Browser-side check before parse.

### Error handling
- **Malformed rows:** shown per-row in the preview with a status badge (`⚠ bad email`, `⚠ missing name`). Host can leave them unchecked and continue — the request body only includes checked rows.
- **Server-side validation failures:** returned in `errors[]` with row index + reason; UI re-opens the preview with those rows flagged.
- **Whole-batch failures (network/auth):** show toast with retry button. Idempotency is handled naturally by dedup — re-running the import won't double-create.

---

## 10. Realtime / fake-detection / cohost-permission interactions

### Realtime publication
`guests` is in `supabase_realtime`. A 500-row import = 500 WAL events fan out to every subscribed page.

**Decision: accept the burst.** The realtime subscriber set for a given party's `guests` table is essentially just the host(s) viewing that party's HostPage — typically 1-3 sessions. We're chunking inserts at 50 rows with 100ms gaps anyway (section 3), which spreads 500 inserts over ~1s and gives the browser time to coalesce updates.

**Mitigations baked in:**
- Chunked transactions of 50 rows with 100ms pauses between chunks. Trivial to add and bounds the burst.
- The host's own HostPage runs the import, so they already expect a refresh.

**Flag:** if we later observe perf issues on hosts with many concurrent dashboard tabs, switch to a single batched insert with `prisma.guest.createMany({ skipDuplicates: false, data })` and accept the realtime fire-hose for 1 second.

### Fake-detection scorer
`backend/src/lib/fakeDetection.ts` (currently lives on master per the `feedback_invite_vs_link_rsvps` memory; verify by `grep` after rebasing) filters direct RSVPs with:

```ts
return guests.filter(g => ['link', 'rsvp', 'api'].includes(g.submittedVia));
```

**Do NOT add `import-*` to this allowlist.** Imported rows are by definition not direct RSVPs into rsv.pizza — they're externally-sourced. Including them would let a host "fake" engagement by importing a CSV. The scorer should continue to only consider rows that came in through real RSVP channels.

This is the same reason `host`, `host-checkin`, and `invite` are already excluded.

### Cohost permissions
The new endpoint reuses the existing `canUserAccessTab(partyId, ..., 'guests')` check — meaning any co-host who already has access to the Guests tab can import. No new tab name, no new permission. Co-hosts without the `'guests'` tab in `allowedTabs` (see `partyAccess.ts:17-36`) get a 403.

The frontend gates the Import button identically by checking `allowedTabs` — same pattern used elsewhere in `GuestList.tsx`.

---

## 11. Deploy ordering

This feature is **backend-first** because preview frontends share the production backend (per `CLAUDE.md` note on preview deploys).

1. **No DB migration needed** (section 4). Skip.
2. **Merge backend changes to master first.** The new `POST /api/parties/:partyId/guests/import` endpoint must be live in production before any frontend (preview or prod) can hit it. This means the backend PR can land on its own ahead of the frontend, and the existing host-add-guest endpoint stays unchanged — no risk to current behavior.
3. **Merge frontend changes to master second.** Now the Import button + modal are wired up. Vercel auto-deploys.
4. **Verify on a preview URL** before promoting to production (section 13).

If we ever need to roll back: revert the frontend PR (Import button disappears, no user-visible effect on existing data). The backend endpoint can stay deployed harmlessly — it's auth-gated and not called by anything else.

---

## 12. Tests to add

### Backend (`backend/src/routes/party.routes.test.ts`)

- `POST /api/parties/:id/guests/import`:
  - Inserts N guests with correct `submittedVia` value (e.g. `'import-luma'`).
  - Sets `status` + `approved` correctly per landing-status param (Pending → null, Approved → true).
  - Skips rows whose email already exists on the party (case-insensitive).
  - Dedups within the input batch (two rows with the same email → one insert).
  - Returns 400 if `guests` is empty, > 2000, or `sourcePlatform` is unknown.
  - Returns 403 for a co-host without `'guests'` in `allowedTabs`.
  - Returns 404 for non-owner non-cohost users.
  - Calls `triggerWebhook` once (not per row).

### Frontend (`frontend/src/lib/guestImport/parsers.test.ts`)

- `detectPlatform()`:
  - Returns `'luma'` for headers containing `approval_status` + `email`.
  - Returns `'meetup'` for headers containing `RSVP` + `User ID`.
  - Returns `'eventbrite'` for headers containing `Order #` + `Attendee Status`.
  - Returns `'csv'` otherwise.
- `parseRows()`:
  - Maps Luma `approval_status: pending_approval` → `{ status: 'CONFIRMED', approved: null }`.
  - Maps Eventbrite `Attendee Status: Checked In` → row carries `checkedIn: true` flag.
  - Concatenates Eventbrite First + Last name correctly.
  - Skips rows with empty email (or flags them, per UI).
  - Survives a Luma export with extra columns we don't care about.

### Frontend component test (optional, nice-to-have)

- `ImportGuestsModal.test.tsx`:
  - Renders preview after file upload.
  - Disables Import button when 0 rows are checked.
  - Shows max-capacity warning when total > `party.maxGuests`.

---

## 13. Verification checklist (Snax QA)

1. **Backend on master, frontend preview** (`https://rsvpizza-git-calzone-83291-guest-list-import-pizza-dao.vercel.app/host/<party-slug>`):
   - [ ] On the Guests tab, an "Import" button appears next to "Export CSV".
   - [ ] Co-host without guests-tab access does NOT see the button (test by viewing a party where Snax is a cohost with limited tabs).
2. **Upload a real Luma export** (any host should have one):
   - [ ] Preview detects "Luma" in the summary line.
   - [ ] Name + Email columns are auto-mapped (no manual action).
   - [ ] Pending-approval rows are shown as pending in the preview.
   - [ ] Duplicates against the existing guest list are flagged with `↻ duplicate` and auto-unchecked.
3. **Upload a real Meetup export**:
   - [ ] Preview detects "Meetup".
   - [ ] `RSVP: Waitlist` rows show as Waitlisted in the preview.
   - [ ] `RSVP: No` rows are filtered out (not shown, or shown disabled with reason).
4. **Upload a real Eventbrite export**:
   - [ ] Preview detects "Eventbrite".
   - [ ] First+Last name concatenated correctly (e.g. "Carla Pé").
5. **Upload an arbitrary CSV with only `Name,Email`**:
   - [ ] Preview falls back to "Generic CSV" and lets Snax manually pick columns.
6. **Confirm the import** (~50 rows):
   - [ ] Modal shows "Imported 47, Skipped 3 duplicates, 0 errors".
   - [ ] Guest list refreshes immediately (realtime).
   - [ ] New guests have `submittedVia = 'import-luma'` (or whichever) — verify in Supabase via SQL: `select submitted_via, count(*) from guests where party_id = '<id>' group by 1;`.
   - [ ] `status` + `approved` match the chosen landing status.
7. **Try a 2500-row CSV**:
   - [ ] Frontend blocks confirm with the "split into multiple imports" message.
8. **Capacity warning**:
   - [ ] Importing past `max_guests` shows the orange banner in preview, but Import still works.
9. **Fake-detection sanity** (back-end):
   - [ ] Confirm that scoring for this party in the underboss dashboard does NOT shift after the import (imported rows excluded from the link/rsvp/api heuristic). Compare before/after `count(*) where submitted_via in ('link','rsvp','api')`.
10. **Realtime burst:**
    - [ ] Open two host tabs side-by-side; run a 500-row import in one; confirm the other tab updates without freezing.

---

## Tradeoffs (recap)

- **Single endpoint vs. per-platform endpoints:** chose single; auto-detect lives in the frontend. Keeps the backend surface area tiny and the platform allowlist in one place. Alternative: per-platform `/import/luma`, `/import/meetup`, etc., would let server-side parsing handle quirks, but for v1 the platform-specific logic is just header-mapping which is trivially client-side.
- **`submittedVia='import-luma'` vs. new `imported_from` column:** chose the string-suffix approach (section 4). Cheaper, fewer footguns. Revisit if we ever need to query imported guests as a first-class collection.
- **XLSX support:** deliberately punted (section 6). CSV-only for v1.
- **Plus-ones (Meetup):** deliberately punted (section 7). Single row per RSVPer.
- **"Update existing" dedup mode:** deliberately punted (section 9). Skip-only for v1.
- **Realtime chunking vs. single `createMany`:** chose chunked transactions (section 10). Slight latency cost for a much smoother realtime experience.

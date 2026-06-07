# tigella-58513 — GPP events capped at 3 hours

**Priority:** Medium
**Branch:** `tigella-58513-gpp-3h-cap`

## Feature
GPP events (`eventType === 'gpp'`) may not be longer than **3 hours**. GPP creation already
defaults to a 3h block (start 6pm / end 9pm / `duration: 3`), but a host can currently stretch
the end time in the Event Time editor to make a 5h+ GPP event — nothing validates duration.

When a host tries to save a GPP event longer than 3h, **block the save** and show:

> Ask your underboss @{handle} if you want an exception.

…where `@{handle}` is the regional underboss Telegram handle resolved from the event's country.

### Decisions (Snax)
- **Reject, don't clamp.** Show the "ask your underboss for an exception" message instead of
  silently snapping the end time back.
- **No backfill.** Existing GPP events already > 3h are left as-is; enforcement is on new edits only.

## How event time is stored / edited (architecture findings)
- `Party.date` = start (timestamptz), `Party.endTime` (timestamptz), `Party.duration` = **Float hours**
  (`backend/prisma/schema.prisma`). The duration column is the source of truth the UI displays from.
- **Frontend editor:** `frontend/src/components/EventDetailsTab.tsx`
  - `saveDateTime()` (`:594`) parses the start/end date+time pickers in the event timezone, computes
    `calculatedDuration = (end - start) / 3600_000`, then `saveField('dateTime', { date, duration, timezone })`.
  - The same Event Time modal already has **GPP-specific locks**: start *date* input `disabled` for gpp
    (`:1359`), end-date `max` (`:1388`). So gpp start is pinned; the 3h rule effectively caps the **end time**.
  - `saveDateTime()` is called from BOTH the Done button (`:1419`) and the click-outside backdrop
    handler (`:1338`) — both currently close the modal unconditionally afterward.
- **Backend save:** `PATCH /api/parties/:id` in `backend/src/routes/party.routes.ts` persists
  `date` / `endTime` / `duration` (`:722-724`) with **no duration validation**. This same endpoint is
  what the **NL Event Assistant** (arancini-58492) writes through, so a backend guard covers that path too.
- **Underboss handle resolver already exists:** `getUnderbossContact(country)` in
  `frontend/src/utils/underbossContacts.ts:101` returns `{ handle: '@username', url: 't.me/...' }` from a
  hardcoded country→Telegram map (already used on `PayoutsTab.tsx`). Reuse it — do NOT build a new lookup.
  The `Underboss` DB model has **no** username/telegram field, so this country map is the canonical handle source.

> Re-verify against origin/master before building (parent branch may be behind):
> (a) `saveDateTime()` still computes `calculatedDuration` the same way; (b) the gpp start-date lock /
> end-date `max` are still the only gpp time constraints; (c) `getUnderbossContact` signature unchanged;
> (d) the PATCH handler still has no duration guard.

## Constant
Define one shared limit so frontend + backend agree:
`GPP_MAX_DURATION_HOURS = 3` (use a tiny epsilon when comparing: `dur > GPP_MAX_DURATION_HOURS + 1e-6`,
so an exactly-3.0h block from floating-point ms math is never falsely rejected).

## Frontend (`EventDetailsTab.tsx`)
1. Add a `dateTimeError: string | null` state, rendered inside the Event Time modal (above the Done
   button, red text — clone the existing `imageError` styling). Clear it whenever the pickers change.
2. **Make `saveDateTime()` return a boolean** (`true` on success, `false` when blocked/failed).
   After computing `calculatedDuration`, before calling `saveField`:
   ```ts
   if (party?.eventType === 'gpp' && calculatedDuration != null
       && calculatedDuration > GPP_MAX_DURATION_HOURS + 1e-6) {
     const handle = getUnderbossContact(party.country)?.handle;
     setDateTimeError(
       handle
         ? `GPP events are limited to 3 hours. Ask your underboss ${handle} if you want an exception.`
         : `GPP events are limited to 3 hours. Ask your underboss if you want an exception.`
     );
     return false;
   }
   ```
   (`handle` already includes the leading `@`.)
3. **Gate modal-close on success** in both callers:
   - Done button (`:1419`): `const ok = await saveDateTime(); if (ok) setShowDateTimeModal(false);`
   - Backdrop click-out (`:1328`): only `saveDateTime()` when values changed, and **keep the modal open
     if it returns false** so the host sees the message (don't auto-dismiss a rejected save).
4. Add a small always-on helper note in the modal for gpp events ("GPP events are limited to 3 hours.",
   `text-xs text-white/40`) so the rule is visible before they hit it.
5. **Reuse, don't reimplement:** import `getUnderbossContact` (already in the utils file). Put
   `GPP_MAX_DURATION_HOURS` in a shared spot (e.g. `frontend/src/utils/dateUtils.ts` or a small consts file)
   if the backend can't share it.

## Backend (`party.routes.ts`, `PATCH /api/parties/:id`) — authoritative guard
The frontend block is UX only; the backend is the real enforcement (and covers the NL Assistant path).

1. The handler already fetches prior party state for the cap audit — ensure the **`eventType`** (and
   existing `date`) are available; select them if not already loaded.
2. Compute the **effective new duration** from the incoming payload:
   - if `duration` is provided → use it;
   - else if both `date` and `endTime` are provided → `(new Date(endTime) - new Date(date)) / 3600_000`;
   - else (time not being changed) → skip the check.
3. If the event is gpp and the effective duration `> 3 + 1e-6`, **return 400** with a machine code, e.g.
   `{ error: 'GPP_DURATION_EXCEEDED', message: 'GPP events are limited to 3 hours.' }`, before `prisma.party.update`.

### Privileged override (so the "exception" is actually grantable)
The message tells hosts to ask their underboss for an exception — so **admins and scoped underbosses must
be able to bypass** the cap. The route already has `req.userEmail`, `resolveCapActorKind(...)`, and
`underbossScope` helpers. Apply the guard only when the editor is a plain host; skip it when
`actorKind === 'admin'` or the requester is an underboss whose scope covers this party.
> Confirm during build exactly how actor kind is resolved in this handler and that scoped-underboss
> identity is cheaply available; if it isn't, fall back to **admin-only bypass** for v1 and note it.

- **DB: NONE.** Pure validation. Per `CLAUDE.md`, the backend guard must be on **master** before it
  takes effect on preview branches (previews share the prod backend).

## Out of scope / notes
- **No backfill** (Snax decision). Existing > 3h gpp events keep their length until edited.
- The end-date `max` in the modal is a **stale hardcode** (`'2026-05-23'`, but GPP27 is 2027) — not this
  task's concern, but worth a separate cleanup ticket.
- GPP27 create defaults (`gpp27.routes.ts`: 6pm/9pm/duration 3) already satisfy the rule — no change.

## Test plan
- Host edits a gpp event end time to 5h → save blocked, message shows correct `@handle` for the country
  (and the generic fallback when the country isn't in the map). Modal stays open.
- Host sets exactly 3h → saves fine (epsilon).
- Non-gpp event set to 5h → saves fine (rule is gpp-only).
- API/curl `PATCH` a gpp party with `duration: 5` as a plain host → 400 `GPP_DURATION_EXCEEDED`;
  as admin/scoped-underboss → 200.
- NL Assistant instruction "make the party 5 hours" on a gpp event → backend rejects.

## Ship checklist
- [ ] Branch `tigella-58513-gpp-3h-cap` off `origin/master`, draft PR for Vercel preview.
- [ ] Re-verify the four origin/master assumptions above before coding.
- [ ] Merge to master so the backend guard is live (frontend preview alone can't enforce it).
- [ ] **Sheet row needs creating/backfill** — `tigella-58513` is a locally-picked id (sheets-claude
      create currently 403s); ask Snax to add the row.

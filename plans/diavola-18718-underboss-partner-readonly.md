# diavola-18718 — Underboss-added partners are read-only for hosts

**Priority:** P2
**Branch:** `diavola-18718-underboss-readonly`
**Worktree:** `.claude/worktrees/diavola-18718-underboss-readonly/`

## Problem

Partners that get bulk-created on a host's event via the `/underboss` auto-sync (where `Sponsor.addedByUnderboss === true`) are global resources and shouldn't be host-editable. Today the backend half-protects them — contact fields are stripped on GET and ignored on PATCH for non-privileged users — but hosts can still:

- Edit `name`, `website`, `brandDescription`, `logoUrl`, `status`, `amount`, etc.
- Change pipeline status via the inline status pill in `SponsorList`.
- Delete the partner outright (no DELETE gate at all).
- See edit/trash icons in the UI with no indication these are global.

Snax wants these partners **fully read-only** for hosts. The full unlock stays with `/underboss` (`isUnderboss` or `super_admin`).

## Approach

Two layers, both required:

1. **Backend (authoritative gate)** — return `403` on PATCH and DELETE when the sponsor has `addedByUnderboss=true` and the caller is not super-admin / underboss. Drop the now-redundant contact-field stripping in PATCH.
2. **Frontend (affordance)** — hide edit/delete actions and lock the status pill on underboss-added rows for non-privileged users; show a "Global Partner" indicator with a hint that it's managed via `/underboss`.

GET responses are left as-is — sponsors still appear in the host's list (read-only) so they show on the flyer / brand-desc list and the host knows they're confirmed.

## Files to modify

### Backend

**`backend/src/routes/sponsor.routes.ts`**

1. Add a small helper near the top (or inline in each handler):
   ```ts
   const userIsPrivileged = await isSuperAdmin(req.userEmail) || await isUnderboss(req.userEmail);
   ```
2. **PATCH `/:partyId/sponsors/:sponsorId`** (line 533): after the `existingSponsor` fetch, if `existingSponsor.addedByUnderboss && !userIsPrivileged` → throw `new AppError('Underboss-added partners are read-only — manage via /underboss', 403, 'PARTNER_READONLY')`. Then remove the existing `stripContactFields` logic and `!stripContactFields &&` guards on lines 598–614 (no longer reachable).
3. **DELETE `/:partyId/sponsors/:sponsorId`** (line 635): after the `existingSponsor` fetch, same 403 gate.
4. **GET `/:partyId/sponsors/:sponsorId`** (line 496) and **GET `/:partyId/sponsors`** (line 11): leave the contact-info stripping as-is. Hosts still see the row, but contact info stays hidden.

### Frontend

**`frontend/src/components/sponsors/SponsorCRM.tsx`**

1. Add `isPrivileged` state (default `false`). On mount, call `fetchUnderbossMe()` (already exported from `lib/api.ts`) and set `isPrivileged = result.isAdmin || result.isUnderboss`. Tolerate non-2xx (treat as not privileged).
2. Pass `isPrivileged` into `<SponsorList ... isPrivileged={isPrivileged} />`.
3. In `handleEdit` (line 203): early-return if `sponsor.addedByUnderboss && !isPrivileged` (belt-and-suspenders — button will already be hidden).
4. In `handleStatusChange` (line 223): same early-return.
5. In `handleDelete` (line 184): same early-return.
6. `handleFormSubmit` (line 109) — also early-return for safety if user somehow opened the form for an underboss-added sponsor while non-privileged.

**`frontend/src/components/sponsors/SponsorList.tsx`**

1. Add `isPrivileged?: boolean` to `SponsorListProps` (default `false`).
2. In the actions cell (lines 350–376), wrap edit and delete buttons in `{(!sponsor.addedByUnderboss || isPrivileged) && (...)}`. When the buttons are hidden, render a `Lock` icon (lucide, `text-purple-400`, `title={t('sponsors.globalPartnerReadOnly')}`) so the row doesn't look broken. Clicking the lock should open a **read-only details modal** for the partner — re-use `PartnerForm` if practical by adding a `readOnly` prop that disables every input/submit button, OR render a simpler read-only summary panel showing name, brand description, website, logo, status, and amount. Either approach is fine — pick whichever is less invasive. Modal close behavior follows existing patterns (backdrop click + `z-50`).
3. In the status `<select>` (lines 235–245): when `sponsor.addedByUnderboss && !isPrivileged`, render the status as a static pill (re-use `STATUS_CONFIG` styling) instead of an editable select. Keep dimensions consistent with the select to avoid layout shift.
4. Keep the existing "Global partner" label in the Contact cell (line 318) — it's complementary.

**`frontend/src/i18n/locales/en/host.json`** (and any peer locale files if the agent has time, but EN is the only must-have):

- Add `sponsors.globalPartnerReadOnly`: `"Global partner — managed via /underboss"` (or similar concise copy).

### No DB changes

`addedByUnderboss` already exists on the `Sponsor` model (migration `20260510_add_added_by_underboss.sql`, Prisma `schema.prisma:910`). No new column, no Supabase migration, no `dbPartyToParty` updates — `Sponsor` doesn't flow through `PizzaContext`.

## Verification

1. **Backend types compile & lint**: `cd backend && npm run typecheck` (or `npx tsc --noEmit`).
2. **Frontend types compile**: `cd frontend && npm run typecheck`.
3. **Manual test on Vercel preview** (`https://rsvpizza-git-diavola-18718-underboss-readonly-pizza-dao.vercel.app`):
   - Pick a GPP event with at least one underboss-added partner (any tag-matched partner that auto-synced).
   - **As a normal host** (not Snax — log in as a non-underboss email if possible; otherwise simulate by checking against `isUnderbossMe()`): visit `/host/{slug}` → Partners tab.
     - The underboss-added partner row appears, but edit and trash icons are gone and the status pill is non-interactive. Lock icon visible.
     - Direct PATCH via `curl` to `/api/parties/.../sponsors/{id}` returns `403 PARTNER_READONLY`.
     - Direct DELETE returns `403`.
   - **As Snax (super-admin/underboss)**: same partner is still fully editable, edit/delete icons present, status pill interactive, PATCH/DELETE succeed.
   - Non-underboss-added partners on the same event remain fully editable for hosts.

## Acceptance

- Host sees underboss-added partner in the list but cannot edit, delete, or change its status.
- Backend rejects host PATCH/DELETE with 403.
- Super-admin / underboss workflow is unchanged.
- No regression on host-created partners.

## Notes for implementation agent

- Branch from `master`. Use the worktree path above.
- Frontend uses `IconInput`, `Checkbox`, etc. but this task doesn't introduce new inputs — no new form fields needed.
- `fetchUnderbossMe()` already exists in `frontend/src/lib/api.ts:2516`. The endpoint is auth-required; if the user isn't logged in it'll throw — wrap the call in a try/catch and default `isPrivileged=false`.
- The flyer-regen logic in `handleFormSubmit` / `handleDelete` / `handleStatusChange` (calls to `triggerFlyerRegen`) is unaffected — those code paths simply won't run for read-only partners.
- Per `[[architecture_two_checklist_renderers]]`-style audit instinct: search for any other component that renders/edits sponsors before declaring done. Likely just `SponsorList` and `PartnerForm`, but grep `addedByUnderboss` across `frontend/src` for completeness.
- Open a **draft** PR. Title: `feat(diavola-18718): underboss-added partners read-only for hosts`. PR body should include the verification checklist above.

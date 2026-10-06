# bucatini-58546 — Inline-edit estimated attendance on /payments by-city rows

## Goal
On the `/payments` admin page, the per-city ("by-party") row shows a read-only
"Est. {n}" sub-line (host-estimated attendance). Make that value EDITABLE inline
for admins and scoped underbosses, exactly mirroring the existing inline
reimbursement-cap editor (`CapInlineEditor`) on the same row.

## Why this is frontend-only (no migration, no backend change)
- `estimatedAttendance` is `Int?` on the `Party` model (`@map("estimated_attendance")`).
  The column already exists in prod. **No migration.**
- `PATCH /api/parties/:id` (`backend/src/routes/party.routes.ts`) already accepts
  `estimatedAttendance` and writes it. Its auth gate is `canUserEditParty`, which
  grants edit to super_admin, party owner, canEdit co-hosts, and — for GPP events —
  admins + scoped underbosses. `/payments` shows GPP cities, so admins + scoped
  underbosses can already PATCH this field.
- This is the **same path** the existing `CapInlineEditor` uses (`updatePartyApi`),
  so auth/scope behavior is identical to the cap editor already shipping on this row.
- `frontend/src/lib/api.ts` already has `updatePartyApi(partyId, data)` and
  `UpdatePartyData.estimatedAttendance?: number | null`.

## Files touched (frontend only)
1. **NEW** `frontend/src/components/payments-shared/EstimatedAttendanceInlineEditor.tsx`
   — clone of `CapInlineEditor.tsx`. Differences: integer validation
   (`Number.isInteger(n) && 0 <= n <= 1000000`, empty clears to null),
   `<IconInput type="number" step="1">`, no `$` prefix on display, saves via
   `updatePartyApi(partyId, { estimatedAttendance: value })`, title
   "Edit estimated attendance", error "Enter a whole number 0–1000000".
2. `frontend/src/components/payments-shared/index.ts` — export the new editor
   from the barrel (the cap editor is imported from `../payments-shared`).
3. `frontend/src/components/payments-admin/PayoutsByPartyTable.tsx` — import the
   editor; replace the read-only `Est. {row.party.estimatedAttendance ?? '—'}`
   with the inline editor (kept the `Est.` prefix + `title`, wrapped in a span
   with `onClick stopPropagation` so editing doesn't toggle the row expand);
   added optional prop `onEstimatedAttendanceUpdated?: (partyId: string) => void`
   and destructured it.
4. `frontend/src/pages/PaymentsAdminPage.tsx` — wired
   `onEstimatedAttendanceUpdated={() => refresh()}` at both
   `<PayoutsByPartyTable>` usages, next to the existing `onCapUpdated`.

## No migration needed
The `estimated_attendance` column and the PATCH endpoint already exist in prod.

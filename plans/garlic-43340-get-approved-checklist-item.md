# garlic-43340 — Add "Get Approved" checklist item (auto-complete on underboss_status review)

## Problem
The host dashboard checklist currently has no item that surfaces "your event needs to be reviewed by an underboss." Hosts have no in-app reminder/deadline for this milestone. Add a new default checklist item titled "Get Approved" with a deadline of 2026-05-19 that auto-checks as soon as an admin or underboss assigns ANY non-pending status to the event (approved / rejected / listed / hidden) — i.e. the underboss has acted on it, from the host's perspective the item is "done."

## Background
- Defaults live in `checklist_defaults` (see `supabase/migrations/20260320_create_checklist_defaults.sql`). They are seeded into per-event `checklist_items` on first dashboard load (`backend/src/routes/checklist.routes.ts`, GET handler L13-119; seed handler L122-205).
- Once an event has been seeded, the GET handler does NOT re-seed when new defaults are added (`defaultCount >= expectedCount` short-circuits). So adding a new default requires explicit backfill into existing GPP events' `checklist_items`.
- Auto-completion is driven by string keys in `AutoCompleteStates` (frontend `types.ts` L964-970) that match `autoRule` on each item. Backend computes these states in `checklist.routes.ts` L94-100.
- Two renderers consume the same data: `GPPDashboardTab.tsx` (dashboard card) and `ChecklistTab.tsx` (standalone tab). Both already use `autoCompleteStates[autoRule]` for `isAuto` items, so adding a new auto-rule key surfaces in both with no per-renderer change. (See memory note `architecture_two_checklist_renderers.md`.)
- Deadline display already exists in both renderers: GPPDashboardTab.tsx L273-283 and ChecklistItemRow.tsx L97-104. No new UI needed.

## Completion rule (exact logic)
Auto-complete when an admin/underboss has assigned any non-pending status. Computed server-side:

```ts
underboss_reviewed: !!party?.underbossStatus && party.underbossStatus !== 'pending'
```

This evaluates true for `'approved'`, `'rejected'`, `'listed'`, `'hidden'`; false for `'pending'` and `null`/`undefined`. Matches the de-facto "an underboss has touched this" semantic and is consistent with existing usage in `frontend/src/components/underboss/EventTable.tsx` L186-189 which treats those four as terminal statuses.

## Files to modify

### Database (new migration)
1. **`supabase/migrations/<date>_add_get_approved_checklist_default.sql`** (new file)
   - Insert the new row into `checklist_defaults`:
     ```sql
     INSERT INTO checklist_defaults (name, due_date, is_auto, auto_rule, link_tab, sort_order) VALUES
       ('Get Approved', '2026-05-19', true, 'underboss_reviewed', NULL, 10)
     ON CONFLICT (name) DO NOTHING;
     ```
   - Backfill into all already-seeded GPP events (one-shot, idempotent):
     ```sql
     INSERT INTO checklist_items (id, party_id, name, due_date, is_auto, auto_rule, link_tab, sort_order, is_default, completed, created_at, updated_at)
     SELECT gen_random_uuid(), p.id, 'Get Approved', '2026-05-19'::date, true, 'underboss_reviewed', NULL, 10, true, false, now(), now()
     FROM parties p
     WHERE p.event_type = 'gpp'
       AND NOT EXISTS (
         SELECT 1 FROM checklist_items ci
         WHERE ci.party_id = p.id AND ci.name = 'Get Approved'
       );
     ```
   - `link_tab` is `NULL` because there is no host-facing tab for "approval status" — the row is informational only. The dashboard card already has approved/rejected/listed/hidden status callouts (`GPPDashboardTab.tsx` L136-209) which serve as the explanatory surface.

### Backend
2. **`backend/src/routes/checklist.routes.ts`**
   - L43-46: extend the `prisma.party.findUnique` `select` to include `underbossStatus: true`.
   - L94-100: add `underboss_reviewed` to the `autoCompleteStates` object:
     ```ts
     const autoCompleteStates = {
       event_created: true,
       party_kit_submitted: !!partyKit,
       venue_added: !!party?.address,
       budget_submitted: budgetItemCount > 0,
       team_built: teamBuilt,
       underboss_reviewed: !!party?.underbossStatus && party.underbossStatus !== 'pending',
     };
     ```

### Frontend
3. **`frontend/src/types.ts`**
   - L964-970: add `underboss_reviewed?: boolean;` to the `AutoCompleteStates` interface. (Mark optional to match the `team_built?` pattern, so an older backend deploy doesn't break the type contract.)

4. **`frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx`**
   - L45-56: add `'Get Approved': ShieldCheck` (or another Lucide icon already imported elsewhere — `CheckCircle` is already imported but reused for the leading "done" indicator; pick `ShieldCheck` and add to the import on L3) to the `ICON_MAP`. The new item will otherwise fall back to the `ClipboardCheck` default (L78) which is acceptable but generic.
   - No other change needed: the existing `dbItems.map` (L66-87) handles the new item generically — `isAuto && autoRule` lookup against `autoStates` already covers `underboss_reviewed`, and `dueDate` rendering (L273-283) is generic. Sort-by-due-date (L81-86) will place 2026-05-19 in chronological order relative to "Throw the Party" (2026-05-22).

5. **`frontend/src/components/checklist/ChecklistTab.tsx`** and **`frontend/src/components/checklist/ChecklistItemRow.tsx`**
   - No code changes required. Both components already render any `isAuto` item with an `autoRule` looked up against `autoCompleteStates` (ChecklistTab.tsx L20-25, ChecklistItemRow.tsx L15-20). The row's "Auto" pill, disabled checkbox, due-date display, and overdue color all auto-apply.

### No translation changes
Item `name` is stored verbatim in the DB and rendered as-is. The other 10 defaults are also English literals. No i18n keys are added.

### No admin UI changes
The admin AdminPage editor for `checklist_defaults` (`backend/src/routes/admin.routes.ts` POST L338-397) hard-codes `isAuto: false` and does not accept `autoRule` — so admins cannot create auto-rules through the UI today. That's why this item ships as a SQL migration. Out of scope: extending admin UI to author auto-rules.

## Why this is purely additive (no breaking changes)
- New auto-rule key is optional on `AutoCompleteStates`, so an older frontend reading from a newer backend gets an extra field it ignores (safe). A newer frontend reading from an older backend gets `undefined`, falls through `?? false`, and the item shows as not-done — degrading gracefully.
- New default row is `ON CONFLICT DO NOTHING` and the backfill is `WHERE NOT EXISTS` — both rerunnable.
- No existing field changes, no removed code paths.

## Deployment order
1. Deploy DB migration (insert default + backfill into existing GPP events' `checklist_items`).
2. Deploy backend (adds `underboss_reviewed` to computed `autoCompleteStates`).
3. Deploy frontend (icon map entry + type extension).

Steps 2 and 3 are independent of each other but BOTH require step 1. Between steps 1 and 2, the new row appears in everyone's checklist but auto-complete returns `undefined` → shows as unchecked. That's acceptable for a short interval.

Note (from CLAUDE.md): Vercel previews talk to the production backend, so the frontend preview will only show the auto-complete behavior after the backend is deployed to master. Keep the PR draft until backend ships.

## Verification (on Vercel preview, after backend + DB shipped)
1. As a GPP host with an event in `underboss_status = 'pending'`, open the dashboard. The "Get Approved" row should appear in the "Event Setup" card, **unchecked**, with the date "May 19" displayed at the right.
2. Open the standalone `/checklist` tab for the same event. The row should appear with the disabled checkbox (Auto pill visible), unchecked, with "Due May 19" beneath the title.
3. In Supabase SQL editor (or via the underboss UI for that party), set `underboss_status = 'approved'`. Reload both surfaces — the row should now show as **checked** with strikethrough.
4. Repeat step 3 with `'rejected'`, `'listed'`, `'hidden'` — each value should leave the row checked.
5. Set `underboss_status = 'pending'` (or `NULL` if possible) — the row should flip back to unchecked.
6. After 2026-05-19 passes, if still unreviewed, the date text turns red (overdue), matching the existing overdue treatment of other items (GPPDashboardTab.tsx L277-279, ChecklistItemRow.tsx L99-100).
7. SQL spot-check on a sample of GPP parties: `SELECT party_id, completed FROM checklist_items WHERE name='Get Approved' LIMIT 20;` — every GPP party should have a row; `completed` will be `false` (auto-complete is derived, not persisted).

## Out of scope
- Persisting the auto-complete state to `checklist_items.completed` / `completed_at` (the system never persists computed auto-states; auto-checked is recomputed every fetch — leave it that way).
- An admin UI to create future auto-rule items (would need extending POST `/api/admin/checklist-defaults` to accept `isAuto`/`autoRule` and a safe-list validator).
- Surfacing `party_status_audit` provenance on the host side (out of scope; service-role only per memory `architecture_party_status_audit`).
- Notifying the host when underboss_status changes (separate concern).

### Critical Files for Implementation
- supabase/migrations/<new>_add_get_approved_checklist_default.sql (NEW)
- backend/src/routes/checklist.routes.ts
- frontend/src/types.ts
- frontend/src/components/gpp-dashboard/GPPDashboardTab.tsx

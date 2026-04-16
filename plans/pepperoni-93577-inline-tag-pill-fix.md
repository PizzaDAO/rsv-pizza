# pepperoni-93577 — Inline event tag pill writes to wrong column

**Priority**: High (silently breaks partner sync)

## Problem

The per-row inline tag pill editor in `EventRow.tsx` (`HostTagsPills`) writes tags into `parties.host_tags` (a jsonb column). But:
- The partner "events tagged" count in `PartnerManager` reads from `parties.event_tags` (text[]).
- The bulk action menu (Actions → Add Tag) writes to `event_tags` and triggers partner co-host/sponsor sync.
- The two columns silently diverged. Snax inline-tagged 6 events with `ownthedoge`; partner UI showed 0.

## Root cause references

- Inline editor: `frontend/src/components/underboss/EventRow.tsx:127-230` (`HostTagsPills`)
- API: `frontend/src/lib/api.ts:2408` (`updateHostTags`)
- Backend: `backend/src/routes/underboss.routes.ts:736-762` writes `hostTags`
- Bulk editor: `frontend/src/components/underboss/EventTable.tsx:364-399` calls `bulkUpdateEventTags`
- Bulk backend: `backend/src/routes/underboss.routes.ts:582-685` writes `eventTags` + runs partner sync
- Count reader: `backend/src/routes/sponsor-user.routes.ts:48-58`

## Fix

Convert the inline pill editor to use `bulkUpdateEventTags([eventId], [tag], 'add'|'remove')`. This:
- Writes to `event_tags` (the column the partner UI reads)
- Triggers the existing partner-sync side effects (co-host/sponsor records)
- Reuses the already-tested bulk endpoint — no new backend route needed

## Files to modify

1. **`frontend/src/components/underboss/EventRow.tsx`**
   - In `HostTagsPills` (~lines 127–230):
     - Change the data source from `event.hostTags` → `event.eventTags`
     - In `addTag`: replace `await updateHostTags(eventId, newTags)` with `await bulkUpdateEventTags([eventId], [cleaned], 'add')`
     - In `removeTag`: similar — `bulkUpdateEventTags([eventId], [tag], 'remove')`
     - Update the imports: drop `updateHostTags`, add `bulkUpdateEventTags`
   - In the EventRow JSX where `HostTagsPills` is rendered: change the `tags` prop to use `event.eventTags` instead of `event.hostTags`. Also update the tag-display line ~391 if it reads `hostTags`.

2. **`frontend/src/components/underboss/EventTable.tsx`** (or wherever the events are loaded for the table)
   - Likely no change; events already include `eventTags`. Verify the row data flowing into `EventRow` has `eventTags`.

3. **`frontend/src/lib/api.ts`**
   - Optional: deprecate or remove `updateHostTags` if no longer used. Grep first to be sure.

4. **Do NOT delete the `host_tags` column or the backend route** in this PR — leave them as no-ops in case anything else still references them. Add a TODO comment noting the column can be dropped after a future cleanup.

## Verification

1. Open `/underboss` Vercel preview
2. Find any event, click the inline tag pill, add a tag like `testtag-fix-verify`
3. Refresh `/underboss` → in the Partners tab, create a partner with that same tag → should immediately show 1 event tagged
4. Remove the tag via the inline pill → count drops to 0
5. The bulk action menu (select rows → Actions → Add Tag) should still work as before
6. Browser console should be clean

## Notes

- The DB backfill (host_tags → event_tags merge) was already applied in the same session as this task. Don't re-do it.
- Tags should be lowercased on insert (already done in `HostTagsPills.addTag` via `tag.trim().toLowerCase()` — preserve that).

# slice-63335 — Underboss Events tab: filter by partner tag

**Priority**: Medium

## Goal

Add a tag filter to the /underboss Events tab so admins can filter the event list to only events with a chosen partner tag (or set of tags).

## Existing patterns to mirror

- Filter pill row lives in `frontend/src/components/underboss/EventTable.tsx:248-293`
- Existing filters use the three-state `FilterPill` (include / exclude / neutral) at lines 42-84
- A simpler `<select>` dropdown is used for country (line ~270)
- Filter state is held in `EventTable` and applied in the filter logic block at lines 100-162

## Recommended UI

A compact dropdown labeled `Tag: All` next to the country dropdown — same look. Multi-select would be nicer but the country dropdown sets the precedent for a single-pick `<select>`. Keep it single-select for v1.

Options come from the union of all distinct `event_tags` across the loaded events (computed client-side from the events array — no extra API needed).

```tsx
<select
  value={tagFilter}
  onChange={(e) => setTagFilter(e.target.value)}
  className="..."  /* match country select styling */
>
  <option value="all">Tag: All</option>
  {availableTags.map(tag => (
    <option key={tag} value={tag}>Tag: {tag}</option>
  ))}
</select>
```

`availableTags` is computed via `useMemo` from `events.flatMap(e => e.eventTags)` deduped + sorted alphabetically.

## Filter logic

In the existing filter pipeline (around lines 100–162), add:
```ts
if (tagFilter !== 'all' && !event.eventTags?.includes(tagFilter)) return false;
```

## "Clear filters" handling

The existing `hasActiveFilters` and "Clear filters" button at the end of the filter row should also clear `tagFilter` back to `'all'`.

## Files to modify

- `frontend/src/components/underboss/EventTable.tsx` — add `tagFilter` state, `availableTags` memo, the `<select>` in the filter row, the filter check, and the clear-filters reset

## Verification

1. Open `/underboss` Vercel preview Events tab
2. Tag dropdown should list all tags currently assigned to events
3. Pick `swc` → only `swc`-tagged events visible
4. Pick `ownthedoge` → only ownthedoge events visible
5. "Clear filters" link resets the tag dropdown to "All"
6. Combining with country / progress filters should still work

## Notes

- This must be merged AFTER pepperoni-93577 (inline tag pill fix) so that inline-tagged events show up properly in the dropdown options. (It still works without that fix, but only inline-tagged events would be invisible — which is the bug being fixed elsewhere.)
- No backend changes required.

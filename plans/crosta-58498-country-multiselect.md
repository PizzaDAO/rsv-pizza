# crosta-58498 — Multi-select (tri-state) Country filter in /underboss EventTable

## Goal
Make the **Country** filter in the `/underboss` events table behave like the
**Tags** filter shipped in `provola-58497` (PR #891): a dropdown button that opens
a panel where each country can be set to *include* / *exclude* / *neutral*
(thumbs-up / thumbs-down toggle), instead of the current single-select `<select>`.

## Model to mirror
The tri-state Tags dropdown already in `EventTable.tsx`:
- State: `tagIncludes`, `tagExcludes`, `tagTouchOrder`, `showTagFilter`
- Helpers: `getTagFilterState(tag)`, `setTagFilterState(tag, next)`
- `orderedTags` (active/floated first, then alphabetical)
- Button with active-count badge + panel with Clear + per-row ThumbsUp/ThumbsDown

## Semantics note (the one necessary deviation)
Tags use AND for includes (`tagIncludes.every(tag => e.eventTags?.includes(tag))`)
because an event has many tags. **Country is single-valued per event**, so multiple
required countries with AND would always match zero. Therefore:
- **include** = event.country is ANY of the selected (OR): `countryIncludes.includes(e.country)`
- **exclude** = event.country is NONE of the selected: `!countryExcludes.includes(e.country)`

## Files
1. `frontend/src/components/underboss/EventTable.tsx`
   - Remove the single-select country `<select>` (the `regionFilter` one, gated by `showRegion`).
   - Add state mirroring tags: `countryIncludes`, `countryExcludes`, `countryTouchOrder`, `showCountryFilter`.
   - Add `getCountryFilterState` / `setCountryFilterState` (copy tag helpers).
   - Add `availableCountries` = `Array.from(new Set(events.map(e=>e.country).filter(Boolean))).sort()`.
   - Add `orderedCountries` mirroring `orderedTags`.
   - Replace the country branch of the filter `useMemo` with the OR-include / NOT-exclude logic above; update its deps array (drop `regionFilter`, add `countryIncludes`, `countryExcludes`).
   - Remove `regionFilter` / `setRegionFilter` state ONLY IF it is not used anywhere else in the file; if it is used elsewhere (search the whole file), leave that other usage intact and only replace the country dropdown + country-filter predicate.
   - Render the country dropdown with the SAME markup/classes as the tag dropdown, still gated behind `showRegion`. Keep it positioned where the old country `<select>` was (before the Tag dropdown).
   - Update `hasActiveFilters` to count `countryIncludes.length > 0 || countryExcludes.length > 0` instead of `regionFilter !== 'all'`.
   - Update the Clear-filters handler to reset `countryIncludes`/`countryExcludes`/`countryTouchOrder` instead of `setRegionFilter('all')`.
   - Reuse imported icons `ThumbsUp`, `ThumbsDown`, `ChevronDown`, `React` (already imported for tags).

2. i18n — `frontend/src/i18n/locales/<loc>/partner.json` for all 8 locales (`de en es fr ja ko pt zh`), in the `eventTable` object next to the `tagsFilter*` keys. Add:
   - `countryFilterLabel` (e.g. EN "Country")
   - `countryFilterClear` (reuse the tagsFilterClear wording, e.g. EN "Clear")
   - `countryFilterInclude` (EN "Include country")
   - `countryFilterExclude` (EN "Exclude country")
   Translate naturally per locale (match the tone/translations already used for the `tagsFilter*` keys in that locale). Leave the now-unused `countryAll` key in place (harmless) — do not reorder existing keys.

## Out of scope
- No backend changes (filtering is client-side in EventTable, same as the tag filter).
- Do not touch any other page's country filter (EventsMapPage, GraphicsDashboard, etc.).

## Verify
- `cd frontend && npx tsc -b --noEmit` (or the project's typecheck) passes.
- Manually reason through: selecting two countries to *include* shows events from either; excluding one hides it; Clear resets; active-count badge matches.

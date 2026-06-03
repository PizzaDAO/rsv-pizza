# tomino-71824 — Move Print Materials header above Event Poster

**Status:** Done — merged as PR #797
**Branch:** `tomino-71824-print-header-top`

## Goal
In the in-event host Print tab, the "Print Materials" header (title +
"Download print-ready materials for your event" + "Browse the PizzaDAO Figma →"
link) rendered *below* the GPP "Event Poster" and "Roll-Up Banner" sections,
because the header lived inside `PrintContent`. Move it to the top of the Print
tab, above the Event Poster. The `/shipping` view (`PrintMaterials`) must keep
its header at the top, unchanged.

## Implementation
File: `frontend/src/components/print/PrintTab.tsx`

1. Extracted the header markup into a new `PrintHeader` component (placed just
   above `PrintContent`), preserving classNames, the Figma href, target/rel, and
   text verbatim.
2. `PrintContent` gained a `showHeader` prop (default `true`); the inline header
   `<div>` was replaced with `{showHeader && <PrintHeader />}`.
3. `PrintTab` now renders `<PrintHeader />` as the first child (above the
   `eventType === 'gpp'` Poster/Roll-Up block) and passes `showHeader={false}`
   to `PrintContent` to avoid duplication.
4. `PrintMaterials` (`<PrintContent showAllSwc />`) left unchanged — relies on
   the `showHeader` default, so its header stays at the top.

## Notes
- See `architecture_print_app_sections` — PrintTab adds GPP-only Poster/Rollup
  on top; `PrintMaterials` is the `/shipping` mode and shares `PrintContent`.
- Header now appears exactly once per view. `tsc --noEmit` clean.

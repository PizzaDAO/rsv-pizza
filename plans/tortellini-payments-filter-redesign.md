# tortellini — Redesign the /payments dashboard filter section

## Context

The Host Payments admin dashboard (`/payments`) crams its entire filter
surface into a flat, dense block (see the current layout):

- **Row 1:** 10 status pills (All, Pending, Approved, Queued, Paid, Rejected,
  Failed, Withdrawn, Completed, Closed).
- **Row 2:** Search · Party ID · Methods · Regions · Tags · Country · Sort —
  seven controls jammed into a 9-column grid. "Sort: Newest first" gets clipped.
- **Row 3:** From/To dates · five hide/show checkboxes · Reset.
- **A separate row *below* the bar:** the View toggle (By city / By payment /
  Payments) + Saved Views.

Two structural problems drive the redesign:

1. **The View toggle sits below the filters, yet governs which filters appear.**
   The tri-state Tags/Country dropdowns, the Regions multi-select, and all five
   hide/show toggles only render in **By city** view (`viewMode === 'by-city'`,
   wired in `PaymentsAdminPage.tsx:1261-1300`). A control that changes the whole
   filter set should come first, not last.
2. **Silent default hiding.** Four of the five toggles are **on by default**
   (`hideClosed`, `hideScams`, `hideUsCities`, `hasReceipts` — see
   `DEFAULT_FILTERS`, `PaymentsAdminPage.tsx:101`). The default view hides closed,
   scam-flagged, and US cities plus anything with no receipts, and nothing on
   screen makes that obvious.

**Outcome:** a compact, scannable filter header where the view mode is the
primary control, advanced filters live behind one "Filters" button, and active
filters (including the default-on hides) are visible and one-click removable.

### Decisions (confirmed with Snax)
- **Layout:** compact always-visible bar + a grouped **Filters panel** popover.
- **Toggles:** consolidate the five hide/show checkboxes into one **Visibility**
  group (inside the panel), keeping current defaults.
- **View mode:** promote the By city / By payment / Payments selector to the
  **top** of the section as the primary control.

### Critical constraint — presentation-only
This is a pure **UI restructuring** over the existing `AdminPayoutFilters`
shape (`frontend/src/types.ts`). No filter values, defaults, or semantics
change. Therefore **do not touch**: `paymentsUrlState.ts`, `paymentsFilterOptions.ts`,
`paymentsUrlState.test.ts`, `lib/api.ts` query builder, or any backend. The URL
remains shareable and the existing round-trip test keeps passing. **No backend,
no DB, no migration.**

## New layout

The filter section becomes a single cohesive card, top → bottom:

1. **Mode + Views header row**
   `[ By city | By payment | Payments ]`  (segmented control, moved up from
   below) … right-aligned: row-count label ("52 cities") + `Views ▾`
   (`SavedViewsMenu`).
2. **Search + Filters + Sort row**
   `🔍 Search hosts & parties` (grows) · `⚙ Filters (N)` button · `Sort ▾`.
   The Party-ID search is a power field → moved **into** the Filters panel.
3. **Status pills row** — unchanged set; still hidden in the Payments-ledger
   view (`showStatusTabs === false`).
4. **Active-filter chips row** — one removable chip per active, non-default
   filter (method, each region, each tag include/exclude, each country
   include/exclude, date range, and each ON visibility toggle). Clicking ✕
   resets that field to its default; a "Reset all" appears when any chip is
   present. This is what makes the default-on hides visible.

**Filters panel** (popover anchored to the `⚙ Filters` button; full-width
bottom sheet on `<640px`). Opaque background using `bg-theme-header` (the token
used by `SavedViewsMenu` / `TimePickerInput`, and the one we standardized on in
PR #1017). Grouped sections:
- **Attributes:** Method (`<select>`), Region multi-select (admin only,
  `showRegionsFilter`), Tags (tri-state in by-city, single `<select>` elsewhere),
  Country (tri-state, by-city only), Party ID.
- **Date range:** From / To.
- **Visibility** (by-city only): the five consolidated toggles — Hide closed /
  Hide possible scams / Hide US cities / Show unsubmitted cities / Has submitted
  receipts — as a labeled `Checkbox` group.
- **Footer:** "Reset filters" + "Done".

## Implementation

All changes are frontend-only and centered on the payments-admin filter bar.

### 1. `frontend/src/components/payments-admin/PayoutsFilterBar.tsx` (main rework)
- Restructure JSX into the four rows above. Keep the component as the single
  filter surface but accept new props so `PaymentsAdminPage` stays the state
  owner:
  - `viewMode` + `onViewModeChange` — render the segmented control (move the
    markup from `PaymentsAdminPage.tsx:1309-1360`).
  - `rowLabel?: string` — the "52 cities" / "…" count (currently `visibleRowLabel`).
  - `savedViews` slot: simplest is a `savedViewsSlot?: React.ReactNode` prop so
    the page passes its configured `<SavedViewsMenu .../>` straight through
    (avoids threading `scope`/`currentParams`/`onApply` and re-deriving URL
    params inside the bar).
- **Reuse** the existing click-outside pattern (`regionsRef` + `useEffect`,
  lines ~228-246) for the Filters popover open/close. Add it as a new
  `filtersOpen` state. **Place all new hooks above any early return**
  (CLAUDE.md hooks-rules gate — `eslint.hooks.config.js` runs in CI).
- **Reuse** `countActiveFilters` (already in this file) for the `(N)` badge.
- Replace the existing mobile-only `expanded`/"Filters (N)" collapse
  (regina-89172) — the new panel supersedes it on all viewports.
- The status pill strip, the `<select>` Method/Sort, `TriStateFilterDropdown`
  (Tags/Country), the Regions multi-select, the date inputs, and the `Checkbox`
  toggles are all **kept as-is** and relocated into their new rows/panel
  sections — minimal change to each control, only their container moves.

### 2. New `frontend/src/components/payments-admin/activeFilterChips.ts` (helper)
- Pure function `getActiveFilterChips(filters, opts): { key, label, onRemove }[]`
  that mirrors `countActiveFilters`' field list and returns a removable
  descriptor per active filter. Visibility toggles render their human label
  ("Hide US cities", etc.). `onRemove` produces the reset patch for that field
  (e.g. `{ country: 'all' }`, `{ hideUsCities: false }`, `{ tagIncludes: [], ... }`).
- Keep it React-free and next to `paymentsFilterOptions.ts` so the chip list and
  the count can't drift.

### 3. New `frontend/src/components/payments-admin/FiltersPanel.tsx` (optional extraction)
- PayoutsFilterBar is already large; extracting the popover body
  (Attributes / Date range / Visibility groups + footer) keeps it readable.
  Receives `filters`, `update`, and the same `show*` capability flags.
- If extraction balloons the diff, inline it in PayoutsFilterBar instead — the
  grouping/markup is what matters, not the file boundary.

### 4. `frontend/src/pages/PaymentsAdminPage.tsx`
- Pass `viewMode`, `setViewMode`, `visibleRowLabel`, and a `savedViewsSlot`
  (the existing `<SavedViewsMenu .../>`) into `<PayoutsFilterBar>`.
- **Remove** the now-duplicated standalone view-toggle + count + SavedViews row
  (the `<div className="flex items-center justify-between …">` block at
  ~1309-1372). Leave the `viewMode === 'payments'` breadcrumb (~1375) where it is.
- All existing capability flags (`showTriStateFilters`, `showHide*Toggle`,
  `showTbdToggle`, `showReceiptsToggle`, `showRegionsFilter`, `showStatusTabs`)
  stay wired exactly as today.

### Reused components / utilities
- `Checkbox`, `IconInput`, `TriStateFilterDropdown` (per CLAUDE.md reusable-
  component rules — no raw inputs/checkboxes).
- `SavedViewsMenu` (relocated via slot, not rewritten).
- `SORT_OPTIONS` / `SORT_LABEL`, `STATUS_TABS`, `METHOD_OPTIONS` (already in
  PayoutsFilterBar).
- `bg-theme-header` for the opaque popover (matches PR #1017 convention).

## Verification

Frontend-only → verify on the Vercel preview for the branch
(`https://rsvpizza-git-tortellini-payments-filter-redesign-pizza-dao.vercel.app/payments`).

1. **View mode is primary:** segmented control is at the top; switching to
   By payment / Payments correctly hides the by-city-only filters; Payments
   view still hides the status strip.
2. **Filters panel:** `⚙ Filters (N)` opens the grouped popover; setting Method,
   Region, Tags, Country, Party ID, dates, and each Visibility toggle all apply;
   panel is opaque in both dark and GPP light themes; on a narrow viewport it
   renders as a usable bottom sheet; click-outside / Done closes it.
3. **Active chips:** every non-default filter (including the four default-on
   hides) shows a chip; ✕ removes just that filter; "Reset all" clears everything
   to `DEFAULT_FILTERS`; the `(N)` badge matches the chip count.
4. **URL + Saved Views unchanged:** apply filters → URL query updates and is
   shareable/reloadable; create/apply a Saved View still works; regional portals
   (`/payments/latam` etc.) still hard-scope and Reset doesn't widen them.
5. **Regressions:** run `npm --prefix frontend test` (or vitest) — the
   `paymentsUrlState.test.ts` round-trip must still pass (proof nothing in the
   filter shape changed). Confirm the hooks-rules lint job is green
   (`frontend/eslint.hooks.config.js`).

## Out of scope / notes
- The `purpose` filter (`salumi-89172`) exists in the type but isn't rendered in
  the current bar; leave it unrendered unless we want to add it (separate ask).
- Whether to *also* surface the default-on visibility toggles as chips (done
  here, for transparency) vs. relying solely on the panel's count badge is the
  one spot where the chosen "consolidate into a menu" and "compact bar + chips"
  answers overlap — flag for Snax to confirm during review.

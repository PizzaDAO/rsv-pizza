import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import { TriStateFilterDropdown } from '../TriStateFilterDropdown';
import type { AdminPayoutFilters, PayoutMethod, PayoutStatus } from '../../types';
import { PAYOUT_METHOD_LABELS } from '../payments-shared';
import {
  PAYMENTS_REGION_DISPLAY_ORDER,
  PAYMENTS_REGION_LABELS,
  PAYMENTS_REGION_SCOPES,
  type PaymentsRegionPortal,
} from '../../utils/regions';
// panuozzo-92114: canonical filter VALUE lists live in the React-free options
// module so PayoutsFilterBar and the URL (de)serializer can't drift.
import type { SortValue, StatusTabValue } from './paymentsFilterOptions';
import type { ViewMode } from './paymentsUrlState';
import { getActiveFilterChips } from './activeFilterChips';

interface PayoutsFilterBarProps {
  filters: AdminPayoutFilters;
  onChange: (next: AdminPayoutFilters) => void;
  onReset: () => void;
  /**
   * tortellini: the By city / By payment / Payments segmented control is now
   * the primary control at the TOP of the filter section (moved up from a
   * standalone row below the bar). The parent stays the state owner.
   */
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** tortellini: row-count label ("52 cities" / "…") shown in the header row. */
  rowLabel?: string;
  /**
   * tortellini: the parent's configured `<SavedViewsMenu>` element, rendered
   * in the header row. Passed as a slot so the bar doesn't have to re-thread
   * `scope`/`currentParams`/`onApply` or re-derive URL params.
   */
  savedViewsSlot?: React.ReactNode;
  /**
   * mascarpone-49102: distinct event-tag values across the currently-loaded
   * payouts (flattened from each `party.eventTags` array). Derived in
   * `PaymentsAdminPage`. Sorted ascending.
   */
  availableTags: string[];
  /**
   * cornetto-58510: distinct `party.country` values across the loaded by-city
   * rows. Powers the tri-state Country dropdown (by-city view only). Sorted.
   */
  availableCountries: string[];
  /**
   * cornetto-58510: when true (by-city view), replace the single-select Tag
   * dropdown with tri-state Tag + Country dropdowns (client-side filtering).
   * When false (by-payment / ledger), keep the legacy single-select Tag select.
   */
  showTriStateFilters?: boolean;
  /**
   * pinsa-92103: when true, render the "Hide closed cities" checkbox.
   * Only meaningful on the by-city view (`paymentsClosedAt` lives at the
   * party level), so the parent controls visibility. Defaults to false.
   */
  showHideClosedToggle?: boolean;
  /**
   * stracchino-92108: when true, render the "Hide possible scams" checkbox.
   * By-city view only, mirroring showHideClosedToggle. Defaults to false.
   */
  showHideScamsToggle?: boolean;
  /**
   * provatura-92107: when true, render the "Hide US cities" checkbox. By-city
   * view + admin dashboard only (regional portals are region-scoped). Defaults
   * to false.
   */
  showHideUsToggle?: boolean;
  /**
   * tigella-58512: when true, render the "Show TBD (no submission)" checkbox.
   * By-city view only (the synthetic rows it reveals only exist on the
   * by-party endpoint). OFF by default — turning it on asks the backend to
   * inject approved `tbd`-tagged events that have submitted nothing yet.
   * Defaults to false.
   */
  showTbdToggle?: boolean;
  /**
   * pancetta-92103: when true, render the Regions multi-select dropdown
   * (admin /payments). Hidden on regional sub-portals (which are already
   * hard-scoped by their `regionFilter` prop). Defaults to false.
   */
  showRegionsFilter?: boolean;
  /**
   * coppa-92106: when false, the status tab strip + sort dropdown are
   * hidden. Used by the new Payments-ledger view mode, which forces
   * `status=paid,completed` + `sort=paid_at_desc` server-side. Defaults to
   * true (existing behavior).
   */
  showStatusTabs?: boolean;
  /**
   * farinata-58532: when true, render the "Has submitted receipts" checkbox.
   * By-city view only (keys off `aggregates.totalReceiptCount` on by-party
   * rows). OFF by default — turning it on narrows the list to cities with at
   * least one submitted receipt. Defaults to false.
   */
  showReceiptsToggle?: boolean;
}

// ciabatta-92110: `'closed'` is a party-level pseudo-status (filters on
// parties.payments_closed_at), so the tab value type widens beyond PayoutStatus.
// panuozzo-92114: values are validated against STATUS_TAB_VALUES in
// paymentsFilterOptions.ts (the URL serializer's source of truth) — keep this
// list and that one in sync.
const STATUS_TABS: Array<{ value: StatusTabValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  // gnocchi-92104: 'queued' = wire request sent, awaiting settlement. Sits
  // between Approved and Paid so admins can spot in-flight wires that need
  // settlement follow-up.
  { value: 'queued', label: 'Queued' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
  // ravioli-82931: surface soft-withdrawn rows in admin for transparency.
  { value: 'withdrawn', label: 'Withdrawn' },
  // provolone-92103: 'completed' rows are the close-out terminal state used
  // by Mark-Party-Paid's "mark pending complete" mode. Distinct from 'paid'
  // (a direct payment record) but treated like paid for cap math.
  { value: 'completed', label: 'Completed' },
  // ciabatta-92110: party-level pseudo-status — filters the queue (list AND
  // by-city) to cities the admin has explicitly closed out
  // (parties.payments_closed_at set), not on payout.status.
  { value: 'closed', label: 'Closed' },
];

const METHOD_OPTIONS: Array<{ value: PayoutMethod | 'all'; label: string }> = [
  { value: 'all', label: 'All methods' },
  { value: 'usdc_base', label: PAYOUT_METHOD_LABELS.usdc_base },
  { value: 'mercury_card', label: PAYOUT_METHOD_LABELS.mercury_card },
  { value: 'wire', label: PAYOUT_METHOD_LABELS.wire },
];

// arancino-92103: sort order for the payouts list. `created_desc` is the
// default (newest submitted first) and matches the prior implicit ordering.
// lievito-92103: `activity_desc` / `activity_asc` expose the by-city default
// (lastActivityAt) as an explicit picker entry, and also order the per-payout
// view by `updatedAt`. Useful for surfacing stale cities first.
const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Highest amount' },
  { value: 'amount_asc', label: 'Lowest amount' },
  { value: 'activity_desc', label: 'Most recently active' },
  { value: 'activity_asc', label: 'Least recently active' },
  // coppa-92106: Payments-ledger sort (forced in Payments view, available
  // here as a manual pick on the other views for completeness).
  { value: 'paid_at_desc', label: 'Most recently paid' },
  { value: 'paid_at_asc', label: 'Oldest payment first' },
  // stracci-58471: column-header sorts for the by-city table, also reachable by
  // clicking the Event / Approved / Paid / Outstanding column headers.
  { value: 'name_asc', label: 'Event name (A–Z)' },
  { value: 'name_desc', label: 'Event name (Z–A)' },
  { value: 'approved_desc', label: 'Most approved' },
  { value: 'approved_asc', label: 'Least approved' },
  { value: 'paid_desc', label: 'Most paid' },
  { value: 'paid_asc', label: 'Least paid' },
  { value: 'outstanding_desc', label: 'Most outstanding' },
  { value: 'outstanding_asc', label: 'Least outstanding' },
];
// tortellini: exported so activeFilterChips.ts can label the non-default sort
// chip from the same source (chip list + count can't drift).
export const SORT_LABEL: Record<SortValue, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<SortValue, string>,
);

const VIEW_MODE_TABS: Array<{ value: ViewMode; label: string }> = [
  { value: 'by-city', label: 'By city' },
  { value: 'by-payment', label: 'By payment' },
  { value: 'payments', label: 'Payments' },
];

/**
 * Sticky filter bar at the top of the admin payouts dashboard. All updates are
 * pushed via `onChange` so the parent can refire `listAdminPayouts(filters)`.
 *
 * Cursor is intentionally NOT a prop here — when filters change the parent
 * should reset cursor to undefined.
 *
 * tortellini: restructured into a single cohesive card —
 *   1. View-mode segmented control + row count + Saved Views (header row),
 *   2. Search + ⚙ Filters (N) popover + Sort,
 *   3. Status pills (hidden when showStatusTabs === false),
 *   4. Active-filter chips (one removable chip per non-default filter).
 * Advanced controls (Method, Regions, Tags, Country, Party ID, dates, the five
 * visibility toggles) live behind the ⚙ Filters popover. The old mobile-only
 * `expanded` collapse (regina-89172) is superseded by this panel on all
 * viewports.
 */
export const PayoutsFilterBar: React.FC<PayoutsFilterBarProps> = ({
  filters,
  onChange,
  onReset,
  viewMode,
  onViewModeChange,
  rowLabel,
  savedViewsSlot,
  availableTags,
  availableCountries,
  showTriStateFilters,
  showHideClosedToggle,
  showHideScamsToggle,
  showHideUsToggle,
  showTbdToggle,
  showReceiptsToggle,
  showRegionsFilter,
  showStatusTabs = true,
}) => {
  // tortellini: chips are the single source of truth for "what's active" — the
  // (N) badge is just their count. View-specific chips are gated by the same
  // `show*` flags that gate their controls, so By-payment / Payments views
  // don't surface non-actionable By-city-only chips.
  const chips = getActiveFilterChips(filters, {
    showTriStateFilters,
    showRegionsFilter,
    showStatusTabs,
    showHideClosedToggle,
    showHideScamsToggle,
    showHideUsToggle,
    showTbdToggle,
    showReceiptsToggle,
  });
  const activeCount = chips.length;

  const update = (patch: Partial<AdminPayoutFilters>) => {
    onChange({ ...filters, ...patch, cursor: undefined });
  };

  // pancetta-92103: regions multi-select state — dropdown panel open/close +
  // click-outside-to-close behavior (matches the project's modal/dropdown
  // pattern). The selected-regions live in `filters.regions`; this widget
  // only owns the open/close UI state.
  const [regionsOpen, setRegionsOpen] = useState(false);
  const regionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!regionsOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!regionsRef.current) return;
      if (!regionsRef.current.contains(e.target as Node)) {
        setRegionsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [regionsOpen]);

  // tortellini: Filters popover open/close — modeled on the regionsOpen
  // click-outside pattern above.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!filtersRef.current) return;
      if (!filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [filtersOpen]);

  const selectedRegionPortals = useMemo<string[]>(
    () => (Array.isArray(filters.regionPortals) ? filters.regionPortals : []),
    [filters.regionPortals],
  );
  const regionsButtonLabel = useMemo(() => {
    if (selectedRegionPortals.length === 0) return 'All regions';
    if (selectedRegionPortals.length === 1) {
      const slug = selectedRegionPortals[0] as PaymentsRegionPortal;
      return PAYMENTS_REGION_LABELS[slug] ?? slug;
    }
    return `${selectedRegionPortals.length} regions`;
  }, [selectedRegionPortals]);

  function toggleRegionPortal(slug: PaymentsRegionPortal) {
    const current = selectedRegionPortals;
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    // Empty array = no filter (treat same as undefined so the URL/query stays
    // clean and no empty-selection chip is emitted).
    update({ regionPortals: next.length > 0 ? next : undefined });
  }

  // tortellini: render the Visibility group only when at least one of its
  // toggles is enabled (i.e. by-city view).
  const showVisibilityGroup =
    !!showHideClosedToggle ||
    !!showHideScamsToggle ||
    !!showHideUsToggle ||
    !!showTbdToggle ||
    !!showReceiptsToggle;

  return (
    <div className="sticky top-0 z-20 bg-theme-surface/95 backdrop-blur-sm border border-theme-stroke rounded-xl p-4 mb-4 shadow-sm">
      {/* Row 1 — view-mode segmented control + row count + Saved Views.
          etruria-92103 / coppa-92106: by-city default; the third "Payments"
          tab shows the actual payments ledger. tortellini moved this UP from a
          standalone row below the bar (it governs which filters appear). */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div
          role="tablist"
          aria-label="Payments view mode"
          className="inline-flex rounded-lg overflow-hidden border border-theme-stroke bg-theme-surface"
        >
          {VIEW_MODE_TABS.map((tab) => {
            const active = viewMode === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onViewModeChange(tab.value)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'text-theme-text-muted hover:bg-theme-surface-hover'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {rowLabel && (
            <span className="text-sm font-medium text-theme-text-muted">{rowLabel}</span>
          )}
          {/* montanara-58497: per-account saved filter views (passed via slot). */}
          {savedViewsSlot}
        </div>
      </div>

      {/* Row 2 — unified search (grows) + ⚙ Filters (N) popover + Sort. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* salame-83472: unified search — host email|name OR party name. */}
        <div className="flex-1 min-w-[200px]">
          <IconInput
            icon={Search}
            type="search"
            placeholder="Search hosts and parties"
            value={filters.search || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ search: e.target.value })}
          />
        </div>

        {/* tortellini: ⚙ Filters (N) popover trigger + opaque panel. */}
        <div className="relative" ref={filtersRef}>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="h-11 inline-flex items-center gap-2 px-3 rounded-lg border border-theme-stroke bg-theme-surface-hover text-sm font-medium text-theme-text hover:bg-theme-stroke"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={14} />
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
            <ChevronDown size={14} className="text-theme-text-muted" />
          </button>

          {filtersOpen && (
            <div
              role="dialog"
              aria-label="Filters"
              className="
                bg-theme-header border border-theme-stroke rounded-lg shadow-xl z-50
                max-sm:fixed max-sm:inset-x-2 max-sm:bottom-2 max-sm:top-auto
                sm:absolute sm:right-0 sm:mt-1 sm:w-[360px] sm:max-w-[90vw]
                p-4 max-h-[80vh] overflow-y-auto
              "
            >
              {/* — Attributes — */}
              <div className="mb-4">
                <h4 className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Attributes</h4>
                <div className="flex flex-col gap-2">
                  {/* Method dropdown */}
                  <select
                    value={filters.payoutMethod ?? 'all'}
                    onChange={(e) => update({ payoutMethod: e.target.value as PayoutMethod | 'all' })}
                    className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
                    aria-label="Filter by payment method"
                  >
                    {METHOD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  {/* pancetta-92103: Regions multi-select — each region maps to
                      a fixed list of `parties.region` slugs (PAYMENTS_REGION_SCOPES);
                      the backend `?regions=` query filters `parties.region IN (...)`.
                      Hidden on regional sub-portals (hard-scoped by their
                      parent's `regionFilter` prop). */}
                  {showRegionsFilter && (
                    <div className="relative" ref={regionsRef}>
                      <button
                        type="button"
                        onClick={() => setRegionsOpen((v) => !v)}
                        className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text inline-flex items-center justify-between gap-2"
                        aria-haspopup="listbox"
                        aria-expanded={regionsOpen}
                        aria-label="Filter by region"
                      >
                        <span className="truncate">{regionsButtonLabel}</span>
                        <ChevronDown size={14} className="flex-shrink-0 text-theme-text-muted" />
                      </button>
                      {regionsOpen && (
                        <div
                          role="listbox"
                          className="absolute left-0 right-0 mt-1 z-50 rounded-lg border border-theme-stroke bg-theme-header shadow-lg py-2 min-w-[200px]"
                        >
                          {PAYMENTS_REGION_DISPLAY_ORDER.map((slug) => {
                            const checked = selectedRegionPortals.includes(slug);
                            const scopeCount = PAYMENTS_REGION_SCOPES[slug].length;
                            return (
                              <div key={slug} className="px-3 py-1.5 hover:bg-theme-surface-hover">
                                <Checkbox
                                  checked={checked}
                                  onChange={() => toggleRegionPortal(slug)}
                                  label={`${PAYMENTS_REGION_LABELS[slug]} (${scopeCount})`}
                                  labelClassName="text-sm text-theme-text"
                                  size={16}
                                />
                              </div>
                            );
                          })}
                          {selectedRegionPortals.length > 0 && (
                            <div className="border-t border-theme-stroke mt-1 pt-1 px-3">
                              <button
                                type="button"
                                onClick={() => update({ regionPortals: undefined })}
                                className="text-xs text-theme-text-muted hover:text-theme-text py-1"
                              >
                                Clear regions
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* cornetto-58510: by-city view uses tri-state Tag + Country
                      dropdowns (client-side filtering). Other views keep the
                      legacy single-select Tag dropdown (mascarpone-49102),
                      filtered server-side via Prisma `{ has: tag }`. */}
                  {showTriStateFilters ? (
                    <>
                      <TriStateFilterDropdown
                        label="Tags"
                        className="w-full"
                        items={availableTags}
                        includes={filters.tagIncludes ?? []}
                        excludes={filters.tagExcludes ?? []}
                        onChange={({ includes, excludes }) => update({ tagIncludes: includes, tagExcludes: excludes })}
                        // paccheri-58541: friendly label for the refund-due tag.
                        labelFor={(t) => (t === 'refund' ? 'Refund due' : t)}
                        searchPlaceholder="Search tags…"
                        noMatchesLabel="No tags"
                        clearLabel="Clear"
                        includeLabel="Include (must have)"
                        excludeLabel="Exclude (must not have)"
                      />
                      <TriStateFilterDropdown
                        label="Country"
                        className="w-full"
                        items={availableCountries}
                        includes={filters.countryIncludes ?? []}
                        excludes={filters.countryExcludes ?? []}
                        onChange={({ includes, excludes }) => update({ countryIncludes: includes, countryExcludes: excludes })}
                        searchPlaceholder="Search countries…"
                        noMatchesLabel="No countries"
                        clearLabel="Clear"
                        includeLabel="Include (must have)"
                        excludeLabel="Exclude (must not have)"
                      />
                    </>
                  ) : (
                    <select
                      value={filters.tag ?? 'all'}
                      onChange={(e) => update({ tag: e.target.value })}
                      className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
                      aria-label="Filter by tag"
                    >
                      <option value="all">All tags</option>
                      {availableTags.map((t) => (
                        <option key={t} value={t}>{t === 'refund' ? 'Refund due' : t}</option>
                      ))}
                    </select>
                  )}

                  {/* Party ID search — moved here from the top row (power field). */}
                  <IconInput
                    icon={Search}
                    type="search"
                    placeholder="Party ID"
                    value={filters.partyId || ''}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ partyId: e.target.value })}
                  />
                </div>
              </div>

              {/* — Date range — */}
              <div className="mb-4">
                <h4 className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Date range</h4>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-theme-text-muted">From</label>
                  <input
                    type="date"
                    value={filters.dateFrom || ''}
                    onChange={(e) => update({ dateFrom: e.target.value })}
                    className="h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
                    aria-label="Date from"
                  />
                  <label className="text-xs text-theme-text-muted">To</label>
                  <input
                    type="date"
                    value={filters.dateTo || ''}
                    onChange={(e) => update({ dateTo: e.target.value })}
                    className="h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
                    aria-label="Date to"
                  />
                </div>
              </div>

              {/* — Visibility (by-city only) — */}
              {showVisibilityGroup && (
                <div className="mb-4">
                  <h4 className="text-xs uppercase tracking-wide text-theme-text-muted mb-2">Visibility</h4>
                  <div className="flex flex-col gap-2">
                    {/* pinsa-92103: Hide closed cities (`paymentsClosedAt`). */}
                    {showHideClosedToggle && (
                      <Checkbox
                        checked={!!filters.hideClosed}
                        onChange={() => update({ hideClosed: !filters.hideClosed })}
                        label="Hide closed cities"
                        labelClassName="text-sm text-theme-text-secondary"
                        size={16}
                      />
                    )}
                    {/* stracchino-92108: Hide possible-scam-flagged cities. */}
                    {showHideScamsToggle && (
                      <Checkbox
                        checked={!!filters.hideScams}
                        onChange={() => update({ hideScams: !filters.hideScams })}
                        label="Hide possible scams"
                        labelClassName="text-sm text-theme-text-secondary"
                        size={16}
                      />
                    )}
                    {/* provatura-92107: Hide US cities (party.region === 'usa'). */}
                    {showHideUsToggle && (
                      <Checkbox
                        checked={!!filters.hideUsCities}
                        onChange={() => update({ hideUsCities: !filters.hideUsCities })}
                        label="Hide US cities"
                        labelClassName="text-sm text-theme-text-secondary"
                        size={16}
                      />
                    )}
                    {/* tigella-58512: Show approved `tbd` events that submitted
                        nothing yet (zero payouts + zero documents). */}
                    {showTbdToggle && (
                      <Checkbox
                        checked={!!filters.showTbdUnsubmitted}
                        onChange={() => update({ showTbdUnsubmitted: !filters.showTbdUnsubmitted })}
                        label="Show unsubmitted cities"
                        labelClassName="text-sm text-theme-text-secondary"
                        size={16}
                      />
                    )}
                    {/* farinata-58532: show only cities with ≥1 submitted receipt. */}
                    {showReceiptsToggle && (
                      <Checkbox
                        checked={!!filters.hasReceipts}
                        onChange={() => update({ hasReceipts: !filters.hasReceipts })}
                        label="Has submitted receipts"
                        labelClassName="text-sm text-theme-text-secondary"
                        size={16}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* — Footer — */}
              <div className="flex items-center justify-between gap-2 border-t border-theme-stroke pt-3">
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text px-3 py-2 rounded-lg hover:bg-theme-surface-hover"
                >
                  <X size={14} />
                  Reset filters
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="inline-flex items-center text-sm font-medium text-theme-text px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* arancino-92103: Sort dropdown — controls the row order of the
            payouts table. Default `created_desc` (newest submitted first).
            Hidden in the Payments-ledger view (sort forced server-side). */}
        {showStatusTabs && (
          <select
            value={filters.sort ?? 'created_desc'}
            onChange={(e) => update({ sort: e.target.value as SortValue })}
            className="h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
            aria-label="Sort payouts"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Row 3 — status tab strip. Hidden in the coppa-92106 Payments-ledger
          view, which forces status server-side. */}
      {showStatusTabs && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {STATUS_TABS.map((tab) => {
            const active = (filters.status ?? 'all') === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => update({ status: tab.value })}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#E52828] text-white'
                    : 'bg-theme-surface-hover text-theme-text-secondary hover:bg-theme-stroke'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Row 4 — active-filter chips. One removable chip per non-default
          filter (including the default-on visibility hides, for transparency).
          Clicking ✕ resets just that field; "Reset all" clears everything. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-theme-surface-hover text-xs text-theme-text"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => update(chip.patch)}
                className="text-theme-text-muted hover:text-theme-text"
                aria-label={`Remove filter ${chip.label}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text px-2 py-1"
          >
            <X size={12} />
            Reset all
          </button>
        </div>
      )}
    </div>
  );
};

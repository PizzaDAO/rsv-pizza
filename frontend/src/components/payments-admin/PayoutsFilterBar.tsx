import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import { IconInput } from '../IconInput';
import { Checkbox } from '../Checkbox';
import type { AdminPayoutFilters, PayoutMethod, PayoutPurpose, PayoutStatus } from '../../types';
import { PAYOUT_METHOD_LABELS } from '../payments-shared';
import {
  PAYMENTS_REGION_DISPLAY_ORDER,
  PAYMENTS_REGION_LABELS,
  PAYMENTS_REGION_SCOPES,
  type PaymentsRegionPortal,
} from '../../utils/regions';

interface PayoutsFilterBarProps {
  filters: AdminPayoutFilters;
  onChange: (next: AdminPayoutFilters) => void;
  onReset: () => void;
  availableCurrencies: string[];
  /**
   * mascarpone-49102: distinct event-tag values across the currently-loaded
   * payouts (flattened from each `party.eventTags` array). Mirrors the
   * `availableCurrencies` pattern — derived in `PaymentsAdminPage`. Sorted
   * ascending.
   */
  availableTags: string[];
  /**
   * pinsa-92103: when true, render the "Hide closed cities" checkbox.
   * Only meaningful on the by-city view (`paymentsClosedAt` lives at the
   * party level), so the parent controls visibility. Defaults to false.
   */
  showHideClosedToggle?: boolean;
  /**
   * pancetta-92103: when true, render the Regions multi-select dropdown
   * (admin /payments). Hidden on regional sub-portals (which are already
   * hard-scoped by their `regionFilter` prop). Defaults to false.
   */
  showRegionsFilter?: boolean;
}

const STATUS_TABS: Array<{ value: PayoutStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
  // ravioli-82931: surface soft-withdrawn rows in admin for transparency.
  { value: 'withdrawn', label: 'Withdrawn' },
  // provolone-92103: 'completed' rows are the close-out terminal state used
  // by Mark-Party-Paid's "mark pending complete" mode. Distinct from 'paid'
  // (a direct payment record) but treated like paid for cap math.
  { value: 'completed', label: 'Completed' },
];

const METHOD_OPTIONS: Array<{ value: PayoutMethod | 'all'; label: string }> = [
  { value: 'all', label: 'All methods' },
  { value: 'usdc_base', label: PAYOUT_METHOD_LABELS.usdc_base },
  { value: 'mercury_card', label: PAYOUT_METHOD_LABELS.mercury_card },
  { value: 'wire', label: PAYOUT_METHOD_LABELS.wire },
];

// salumi-89172: Purpose filter — event reimbursements vs shipping receipts.
const PURPOSE_OPTIONS: Array<{ value: PayoutPurpose | 'all'; label: string }> = [
  { value: 'all', label: 'All purposes' },
  { value: 'event', label: 'Event' },
  { value: 'shipping', label: 'Shipping' },
];

// arancino-92103: sort order for the payouts list. `created_desc` is the
// default (newest submitted first) and matches the prior implicit ordering.
// lievito-92103: `activity_desc` / `activity_asc` expose the by-city default
// (lastActivityAt) as an explicit picker entry, and also order the per-payout
// view by `updatedAt`. Useful for surfacing stale cities first.
type SortValue = NonNullable<AdminPayoutFilters['sort']>;
const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Highest amount' },
  { value: 'amount_asc', label: 'Lowest amount' },
  { value: 'activity_desc', label: 'Most recently active' },
  { value: 'activity_asc', label: 'Least recently active' },
];
const SORT_LABEL: Record<SortValue, string> = SORT_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.value]: opt.label }),
  {} as Record<SortValue, string>,
);

/**
 * regina-89172: count active (non-default) filter fields. Status tab strip is
 * NOT counted here — it's always visible above the collapsible section, so
 * counting it would double-render the signal. Cursor/limit are pagination
 * plumbing, not user-facing filters.
 */
function countActiveFilters(filters: AdminPayoutFilters): number {
  let n = 0;
  if (filters.search && filters.search.trim()) n += 1;
  if (filters.partyId && filters.partyId.trim()) n += 1;
  if (filters.payoutMethod && filters.payoutMethod !== 'all') n += 1;
  if (filters.currency && filters.currency !== 'all') n += 1;
  if (filters.country && filters.country !== 'all') n += 1;
  // pancetta-92103: regions multi-select counts as a single active filter
  // when at least one portal is selected (regardless of how many).
  if (Array.isArray(filters.regionPortals) && filters.regionPortals.length > 0) n += 1;
  if (filters.tag && filters.tag !== 'all') n += 1;
  if (filters.purpose && filters.purpose !== 'all') n += 1;
  if (filters.dateFrom) n += 1;
  if (filters.dateTo) n += 1;
  // arancino-92103: count sort as an active filter when it differs from
  // the default `created_desc` (newest first).
  if (filters.sort && filters.sort !== 'created_desc') n += 1;
  // pinsa-92103: count Hide closed cities so admins see they've hidden rows.
  if (filters.hideClosed) n += 1;
  return n;
}

/**
 * Sticky filter bar at the top of the admin payouts dashboard. All updates are
 * pushed via `onChange` so the parent can refire `listAdminPayouts(filters)`.
 *
 * Cursor is intentionally NOT a prop here — when filters change the parent
 * should reset cursor to undefined.
 *
 * regina-89172: on mobile (<640px) the filter controls collapse behind a
 * "Filters (N)" toggle button so the payouts table stays above the fold.
 * The status tab strip stays visible at all times. On `sm:` and up the
 * controls are always expanded (existing desktop behavior).
 */
export const PayoutsFilterBar: React.FC<PayoutsFilterBarProps> = ({
  filters,
  onChange,
  onReset,
  availableCurrencies,
  availableTags,
  showHideClosedToggle,
  showRegionsFilter,
}) => {
  const [expanded, setExpanded] = useState(false);
  const activeCount = countActiveFilters(filters);

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
    // clean and `countActiveFilters` doesn't count an empty selection).
    update({ regionPortals: next.length > 0 ? next : undefined });
  }

  return (
    <div className="sticky top-0 z-20 bg-theme-surface/95 backdrop-blur-sm border border-theme-stroke rounded-xl p-4 mb-4 shadow-sm">
      {/* Status tab strip — always visible (mobile + desktop). */}
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

      {/* regina-89172: mobile-only collapse toggle. Hidden on sm:+ via `sm:hidden`. */}
      <div className="sm:hidden mb-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-theme-stroke bg-theme-surface-hover text-sm font-medium text-theme-text"
          aria-expanded={expanded}
          aria-controls="payouts-filter-controls"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal size={14} />
            Filters{activeCount > 0 ? ` (${activeCount})` : ''}
          </span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Controls. Hidden on mobile when collapsed; force-visible on sm:+. */}
      <div
        id="payouts-filter-controls"
        className={`${expanded ? 'block' : 'hidden'} sm:block`}
      >
        <div className="grid grid-cols-1 md:grid-cols-9 gap-2 items-start">
          {/* salame-83472: unified search — host email|name OR party name. */}
          <div className="md:col-span-2">
            <IconInput
              icon={Search}
              type="search"
              placeholder="Search hosts and parties"
              value={filters.search || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ search: e.target.value })}
            />
          </div>

          {/* Party ID search */}
          <div>
            <IconInput
              icon={Search}
              type="search"
              placeholder="Party ID"
              value={filters.partyId || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ partyId: e.target.value })}
            />
          </div>

          {/* Method dropdown */}
          <div>
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
          </div>

          {/* Currency dropdown */}
          <div>
            <select
              value={filters.currency ?? 'all'}
              onChange={(e) => update({ currency: e.target.value })}
              className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
              aria-label="Filter by currency"
            >
              <option value="all">All currencies</option>
              {availableCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* pancetta-92103: Regions multi-select — replaces the prior
              bruschetta-58291 single-country dropdown. Each region maps to a
              fixed list of `parties.region` slugs (PAYMENTS_REGION_SCOPES);
              the backend `?regions=` query filters `parties.region IN (...)`.
              Selecting zero regions = no filter (same as the old "All
              countries"). Hidden on regional sub-portals which are already
              hard-scoped by their parent's `regionFilter` prop. */}
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
                  className="absolute left-0 right-0 mt-1 z-50 rounded-lg border border-theme-stroke bg-theme-surface shadow-lg py-2 min-w-[200px]"
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

          {/* mascarpone-49102: Tag dropdown — populated from event_tags
              flattened across the loaded payout set (parallels
              availableCurrencies/availableCountries). Backend filters
              `party.eventTags` via Prisma `{ has: tag }`. */}
          <div>
            <select
              value={filters.tag ?? 'all'}
              onChange={(e) => update({ tag: e.target.value })}
              className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
              aria-label="Filter by tag"
            >
              <option value="all">All tags</option>
              {availableTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* salumi-89172: Purpose dropdown — Event reimbursements vs
              Shipping coordinator receipts. Default 'all' shows both. */}
          <div>
            <select
              value={filters.purpose ?? 'all'}
              onChange={(e) => update({ purpose: e.target.value as PayoutPurpose | 'all' })}
              className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
              aria-label="Filter by purpose"
            >
              {PURPOSE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* arancino-92103: Sort dropdown — controls the row order of the
              payouts table. Default is `created_desc` (newest submitted
              first), matching the prior implicit backend ordering. */}
          <div>
            <select
              value={filters.sort ?? 'created_desc'}
              onChange={(e) => update({ sort: e.target.value as SortValue })}
              className="w-full h-11 rounded-lg border border-theme-stroke bg-theme-surface px-3 text-sm text-theme-text"
              aria-label="Sort payouts"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-end gap-2 mt-3">
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
            {/* arancino-92103: surface non-default sort as a small chip so
                admins notice the list is reordered. The dropdown above is
                the canonical control; this chip is a read-only summary. */}
            {filters.sort && filters.sort !== 'created_desc' && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#E52828]/10 text-[#E52828] text-xs font-medium">
                Sort: {SORT_LABEL[filters.sort]}
              </span>
            )}
            {/* pinsa-92103: Hide closed cities toggle. Only rendered on the
                by-city view (`paymentsClosedAt` is a party-level signal so
                the by-payment view has nothing to hide). Backend honors
                `hideClosed=true` on the /by-party endpoint. */}
            {showHideClosedToggle && (
              <Checkbox
                checked={!!filters.hideClosed}
                onChange={() => update({ hideClosed: !filters.hideClosed })}
                label="Hide closed cities"
                labelClassName="text-xs text-theme-text-secondary"
                size={14}
              />
            )}
          </div>
          <button
            type="button"
            onClick={onReset}
            className="md:ml-auto inline-flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text px-3 py-2 rounded-lg hover:bg-theme-surface-hover"
          >
            <X size={14} />
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
};

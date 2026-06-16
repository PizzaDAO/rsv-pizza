// tortellini: React-free helper that turns the active (non-default) fields of
// an `AdminPayoutFilters` into a flat list of removable chip descriptors. This
// is the single source of truth for "what filters are active": PayoutsFilterBar
// renders these chips AND derives the `(N)` badge from `chips.length`, so the
// row and the badge can never drift.
import type { AdminPayoutFilters, PayoutMethod } from '../../types';
import { PAYOUT_METHOD_LABELS } from '../payments-shared';
import { PAYMENTS_REGION_LABELS, type PaymentsRegionPortal } from '../../utils/regions';
import { SORT_LABEL } from './PayoutsFilterBar';
import type { SortValue } from './paymentsFilterOptions';

export interface ActiveFilterChip {
  /** Stable key for React list rendering. */
  key: string;
  /** Human-readable chip label. */
  label: string;
  /** Partial patch that resets just this field to its default when removed. */
  patch: Partial<AdminPayoutFilters>;
}

/**
 * tortellini: which filter controls are actually rendered for the current view
 * (mirrors the `show*` capability flags on `PayoutsFilterBar`). A chip is only
 * emitted for a filter whose control is visible — otherwise a By-city-only
 * filter (e.g. "Hiding US") would show a non-actionable chip in the By-payment
 * / Payments views, where that filter has no effect. Any flag left `undefined`
 * is treated as applicable (`?? true`), so omitting `caps` yields every chip.
 */
export interface ActiveFilterChipCaps {
  showTriStateFilters?: boolean;
  showRegionsFilter?: boolean;
  showStatusTabs?: boolean;
  showHideClosedToggle?: boolean;
  showHideScamsToggle?: boolean;
  showHideUsToggle?: boolean;
  showTbdToggle?: boolean;
  showReceiptsToggle?: boolean;
}

/** paccheri-58541: friendly label for the refund-due tag. */
function tagLabel(t: string): string {
  return t === 'refund' ? 'Refund due' : t;
}

/**
 * Build the removable-chip list for the currently active filters. This is the
 * single source of truth for "what filters are active" — the `(N)` badge is
 * just `getActiveFilterChips(...).length`. Each chip's `patch` resets only that
 * field (or removes only that one value, for the multi-value tri-state / region
 * filters). View-specific chips are gated by `caps` so they only appear when
 * their control is actually rendered.
 */
export function getActiveFilterChips(
  filters: AdminPayoutFilters,
  caps: ActiveFilterChipCaps = {},
): ActiveFilterChip[] {
  const triState = caps.showTriStateFilters ?? true;
  const regions = caps.showRegionsFilter ?? true;
  const statusTabs = caps.showStatusTabs ?? true;
  const chips: ActiveFilterChip[] = [];

  // salame-83472: unified search.
  if (filters.search && filters.search.trim()) {
    chips.push({ key: 'search', label: `Search: "${filters.search}"`, patch: { search: '' } });
  }

  // Party ID search.
  if (filters.partyId && filters.partyId.trim()) {
    chips.push({ key: 'partyId', label: `Party: ${filters.partyId}`, patch: { partyId: '' } });
  }

  // Method.
  if (filters.payoutMethod && filters.payoutMethod !== 'all') {
    const m = filters.payoutMethod as PayoutMethod;
    chips.push({
      key: 'payoutMethod',
      label: `Method: ${PAYOUT_METHOD_LABELS[m] ?? m}`,
      patch: { payoutMethod: 'all' },
    });
  }

  // bruschetta-58291: single-select country (non-tri-state views).
  if (filters.country && filters.country !== 'all') {
    chips.push({ key: 'country', label: `Country: ${filters.country}`, patch: { country: 'all' } });
  }

  // mascarpone-49102: single-select tag (non-tri-state views only).
  if (!triState && filters.tag && filters.tag !== 'all') {
    chips.push({ key: 'tag', label: `Tag: ${tagLabel(filters.tag)}`, patch: { tag: 'all' } });
  }

  // cornetto-58510: tri-state tag + country include/exclude — one chip per
  // value. By-city view only (the tri-state controls only render there).
  if (triState) {
    for (const t of filters.tagIncludes ?? []) {
      chips.push({
        key: `tagInclude:${t}`,
        label: `Tag: ${tagLabel(t)}`,
        patch: { tagIncludes: (filters.tagIncludes ?? []).filter((x) => x !== t) },
      });
    }
    for (const t of filters.tagExcludes ?? []) {
      chips.push({
        key: `tagExclude:${t}`,
        label: `Tag ≠ ${tagLabel(t)}`,
        patch: { tagExcludes: (filters.tagExcludes ?? []).filter((x) => x !== t) },
      });
    }
    for (const c of filters.countryIncludes ?? []) {
      chips.push({
        key: `countryInclude:${c}`,
        label: `Country: ${c}`,
        patch: { countryIncludes: (filters.countryIncludes ?? []).filter((x) => x !== c) },
      });
    }
    for (const c of filters.countryExcludes ?? []) {
      chips.push({
        key: `countryExclude:${c}`,
        label: `Country ≠ ${c}`,
        patch: { countryExcludes: (filters.countryExcludes ?? []).filter((x) => x !== c) },
      });
    }
  }

  // pancetta-92103: region portals — one chip per selected portal. Empty array
  // collapses to undefined (matches toggleRegionPortal's "no filter" shape).
  // Hidden on regional sub-portals (Regions control isn't rendered there).
  if (regions && Array.isArray(filters.regionPortals) && filters.regionPortals.length > 0) {
    for (const slug of filters.regionPortals) {
      const next = filters.regionPortals.filter((s) => s !== slug);
      chips.push({
        key: `region:${slug}`,
        label: `Region: ${PAYMENTS_REGION_LABELS[slug as PaymentsRegionPortal] ?? slug}`,
        patch: { regionPortals: next.length > 0 ? next : undefined },
      });
    }
  }

  // Date range.
  if (filters.dateFrom) {
    chips.push({ key: 'dateFrom', label: `From ${filters.dateFrom}`, patch: { dateFrom: '' } });
  }
  if (filters.dateTo) {
    chips.push({ key: 'dateTo', label: `To ${filters.dateTo}`, patch: { dateTo: '' } });
  }

  // arancino-92103: non-default sort. Hidden in the Payments-ledger view
  // (sort forced server-side), so gate on the same flag as the Sort control.
  if (statusTabs && filters.sort && filters.sort !== 'created_desc') {
    chips.push({
      key: 'sort',
      label: `Sort: ${SORT_LABEL[filters.sort as SortValue]}`,
      patch: { sort: 'created_desc' },
    });
  }

  // Visibility toggles — surfaced as chips (incl. the default-on hides, for
  // transparency), but only when their control is rendered (by-city view).
  if ((caps.showHideClosedToggle ?? true) && filters.hideClosed) {
    chips.push({ key: 'hideClosed', label: 'Hiding closed', patch: { hideClosed: false } });
  }
  if ((caps.showHideScamsToggle ?? true) && filters.hideScams) {
    chips.push({ key: 'hideScams', label: 'Hiding scams', patch: { hideScams: false } });
  }
  if ((caps.showHideUsToggle ?? true) && filters.hideUsCities) {
    chips.push({ key: 'hideUsCities', label: 'Hiding US', patch: { hideUsCities: false } });
  }
  if ((caps.showTbdToggle ?? true) && filters.showTbdUnsubmitted) {
    chips.push({
      key: 'showTbdUnsubmitted',
      label: 'Incl. unsubmitted',
      patch: { showTbdUnsubmitted: false },
    });
  }
  if ((caps.showReceiptsToggle ?? true) && filters.hasReceipts) {
    chips.push({ key: 'hasReceipts', label: 'Has receipts', patch: { hasReceipts: false } });
  }

  return chips;
}
